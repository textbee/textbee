import { HttpException, HttpStatus, Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { User, UserDocument } from './schemas/user.schema'
import { Model, Types } from 'mongoose'
import { UpdateOnboardingDTO } from '../auth/auth.dto'
import {
  ONBOARDING_OPTIONAL_STEP_IDS,
  ONBOARDING_STEP_ORDER,
} from './onboarding.constants'
import { AttributionInput, normalizeSignupSource } from './attribution'
import { classifyDevice, describeClient } from '../common/user-agent'
import { ClientLocation } from '../common/client-address'

export type UserMilestoneField =
  | 'firstDeviceAt'
  | 'firstApiKeyAt'
  | 'firstSmsAt'
  | 'firstPaidAt'

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  async findOne(params) {
    return await this.userModel.findOne(params)
  }

  // Only for flows that verify a password. Never return this to a client.
  async findOneWithPassword(params) {
    return await this.userModel.findOne(params).select('+password')
  }

  async findAll() {
    return await this.userModel.find()
  }

  async create({
    name,
    email,
    password,
    phone,
    marketingOptIn,
    attribution,
    userAgent,
    country,
    location,
  }: {
    name: string
    email: string
    password?: string
    phone?: string
    marketingOptIn?: boolean
    attribution?: AttributionInput
    userAgent?: string
    country?: string
    location?: ClientLocation
  }) {
    if (await this.findOne({ email })) {
      throw new HttpException(
        {
          error: 'user exists with the same email',
        },
        HttpStatus.BAD_REQUEST,
      )
    }

    const client = describeClient(userAgent)
    const newUser = new this.userModel({
      name,
      email,
      password,
      phone,
      marketingOptIn: marketingOptIn ?? false,
      attribution,
      signupSource: normalizeSignupSource(attribution),
      signupDevice: classifyDevice(userAgent),
      signupCountry: country,
      ...(location && {
        signupLocation: { ...(country && { country }), ...location },
      }),
      ...(client && { client: { signup: client, last: client } }),
    })
    return await newUser.save()
  }

  /**
   * Stamps a milestone the first time it happens and never again. The
   * $exists filter does that in one write, so callers can fire a conversion
   * event on the returned true without reading the user first, and a repeated
   * call (every app launch re-registers a device) is a no-op.
   */
  async markMilestone(
    userId: string | Types.ObjectId,
    field: UserMilestoneField,
  ): Promise<boolean> {
    const path = `milestones.${field}`
    const result = await this.userModel.updateOne(
      { _id: userId, [path]: { $exists: false } },
      { $set: { [path]: new Date() } },
    )
    return result.modifiedCount === 1
  }

  /** Marks the account verified only while it still holds `email`. */
  async markEmailVerified(
    userId: string | Types.ObjectId,
    email: string,
  ): Promise<boolean> {
    const result = await this.userModel.updateOne(
      { _id: userId, email, emailVerifiedAt: null },
      { $set: { emailVerifiedAt: new Date() } },
    )
    return result.matchedCount === 1
  }

  touchClient(user: UserDocument, userAgent?: string): void {
    const client = describeClient(userAgent)
    if (client) user.set('client.last', client)
  }

  async updateProfile(
    input: { name: string; phone: string },
    user: UserDocument,
  ) {
    const userToUpdate = await this.findOne({ _id: user._id })
    if (!userToUpdate) {
      throw new HttpException({ error: 'User not found' }, HttpStatus.NOT_FOUND)
    }

    if (input.name) {
      userToUpdate.name = input.name
    }
    if (input.phone) {
      userToUpdate.phone = input.phone
    }

    return await userToUpdate.save()
  }

  async updateOnboarding(input: UpdateOnboardingDTO, user: UserDocument) {
    const u = await this.findOne({ _id: user._id })
    if (!u) {
      throw new HttpException({ error: 'User not found' }, HttpStatus.NOT_FOUND)
    }

    if (!u.onboarding) {
      u.onboarding = {
        currentStepId: 'verify_email',
        skippedStepIds: [],
      }
    }
    if (!u.onboarding.skippedStepIds) {
      u.onboarding.skippedStepIds = []
    }

    if (input.skipStepId) {
      if (
        !ONBOARDING_OPTIONAL_STEP_IDS.includes(
          input.skipStepId as (typeof ONBOARDING_OPTIONAL_STEP_IDS)[number],
        )
      ) {
        throw new HttpException(
          { error: 'Step is not optional' },
          HttpStatus.BAD_REQUEST,
        )
      }
      if (!u.onboarding.skippedStepIds.includes(input.skipStepId)) {
        u.onboarding.skippedStepIds.push(input.skipStepId)
      }
      const idx = ONBOARDING_STEP_ORDER.indexOf(
        input.skipStepId as (typeof ONBOARDING_STEP_ORDER)[number],
      )
      if (idx >= 0 && idx < ONBOARDING_STEP_ORDER.length - 1) {
        u.onboarding.currentStepId = ONBOARDING_STEP_ORDER[idx + 1]
      }
    }

    if (input.currentStepId) {
      u.onboarding.currentStepId = input.currentStepId
    }

    if (input.complete === true && !u.onboarding.completedAt) {
      u.onboarding.completedAt = new Date()
    }

    u.markModified('onboarding')
    return await u.save()
  }

}
