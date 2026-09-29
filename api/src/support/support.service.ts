import {
  Injectable,
  ConflictException,
  NotFoundException,
  HttpException,
  HttpStatus,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { isValidObjectId, Model, Types } from 'mongoose'
import {
  SupportMessage,
  SupportMessageDocument,
} from './schemas/support-message.schema'
import { User, UserDocument } from '../users/schemas/user.schema'
import {
  CreateSupportMessageDto,
  SupportCategory,
} from './dto/create-support-message.dto'
import { MailService } from '../mail/mail.service'
import { firstName } from '../mail/first-name'

@Injectable()
export class SupportService {
  constructor(
    @InjectModel(SupportMessage.name)
    private supportMessageModel: Model<SupportMessageDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private readonly mailService: MailService,
  ) {}

  async createSupportMessage(
    createSupportMessageDto: CreateSupportMessageDto,
  ): Promise<{ message: string }> {
    const { turnstileToken, ...sanitizedDto } = createSupportMessageDto
    try {
      // Check rate limit: max 3 requests per 24 hours.
      // Keyed on the authenticated user, not the self-reported email.
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const recentRequestsCount = await this.supportMessageModel.countDocuments({
        user: sanitizedDto.user,
        createdAt: { $gte: twentyFourHoursAgo },
      })

      if (recentRequestsCount >= 3) {
        throw new HttpException(
          'Too many support requests. Please try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        )
      }

      // Create and save the support message
      const createdMessage = new this.supportMessageModel(sanitizedDto)
      const savedMessage = await createdMessage.save()

      // Determine if the user is registered
      let user = null
      if (
        sanitizedDto.user &&
        isValidObjectId(sanitizedDto.user)
      ) {
        user = await this.userModel.findById(sanitizedDto.user)
      }

      // Send confirmation email to user
      await this.mailService.sendEmailFromTemplate({
        from: 'support@textbee.dev',
        to: createSupportMessageDto.email,
        cc: process.env.ADMIN_EMAIL,
        subject: `Support Request Submitted: ${createSupportMessageDto.category}-${savedMessage._id}`,
        template: 'customer-support-confirmation',
        context: {
          name: firstName(createSupportMessageDto.name),
          email: sanitizedDto.email,
          phone: sanitizedDto.phone || 'Not provided',
          category: sanitizedDto.category,
          message: sanitizedDto.message,
          appLogoUrl:
            process.env.APP_LOGO_URL || 'https://textbee.dev/logo.png',
          currentYear: new Date().getFullYear(),
        },
      }, {
        userId: user?._id,
        category: 'support',
        meta: { supportMessageId: savedMessage._id },
      })

      return { message: 'Support request submitted successfully' }
    } catch (error) {
      console.error('Error creating support message:', error)
      throw error
    }
  }

  // Method for account deletion requests
  async requestAccountDeletion(
    createSupportMessageDto: CreateSupportMessageDto,
  ): Promise<{ message: string }> {
    const { turnstileToken, ...sanitizedDto } = createSupportMessageDto
    try {
      // Check if user exists
      if (
        !sanitizedDto.user ||
        !isValidObjectId(sanitizedDto.user)
      ) {
        throw new NotFoundException('User not found')
      }

      const userId = new Types.ObjectId(sanitizedDto.user.toString())
      const user = await this.userModel.findById(userId)

      if (!user) {
        throw new NotFoundException('User not found')
      }

      // Check if user has already requested deletion
      const existingRequest = await this.supportMessageModel.findOne({
        user: userId,
        category: SupportCategory.ACCOUNT_DELETION,
      })

      if (existingRequest) {
        throw new ConflictException(
          'Account deletion has already been requested',
        )
      }

      // Create and save the support message
      const createdMessage = new this.supportMessageModel(
        sanitizedDto,
      )
      const savedMessage = await createdMessage.save()

      // Update user's account deletion requested timestamp
      await this.userModel.updateOne(
        { _id: userId },
        {
          accountDeletionRequestedAt: new Date(),
          accountDeletionReason: sanitizedDto.message || null,
        },
      )

      // Send confirmation email
      await this.mailService.sendEmailFromTemplate({
        from: 'support@textbee.dev',
        to: user.email,
        cc: process.env.ADMIN_EMAIL,
        subject: `Account Deletion Request: ${savedMessage._id}`,
        template: 'account-deletion-request',
        context: {
          name: firstName(user.name),
          email: user.email,
          message: sanitizedDto.message || 'No reason provided',
          appLogoUrl:
            process.env.APP_LOGO_URL || 'https://textbee.dev/logo.png',
          currentYear: new Date().getFullYear(),
        },
      }, {
        userId: user._id,
        category: 'support',
        meta: { supportMessageId: savedMessage._id },
      })

      return { message: 'Account deletion request submitted successfully' }
    } catch (error) {
      console.error('Error requesting account deletion:', error)
      throw error
    }
  }
}
