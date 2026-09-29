import { OnQueueFailed, Process, Processor } from '@nestjs/bull'
import { InjectModel } from '@nestjs/mongoose'
import { Job } from 'bull'
import { Model, Types } from 'mongoose'
import { MailService } from '../../mail/mail.service'
import {
  formatCount,
  formatDate,
  pluralize,
  sanitizeUserText,
  TemplateVars,
} from '../../mail/email-render'
import { billingUrl, scaleUpgradeUrl, upgradeUrl } from '../../mail/email-links'
import {
  SentEmail,
  SentEmailDocument,
} from '../../mail/schemas/sent-email.schema'
import { User, UserDocument } from '../../users/schemas/user.schema'
import { SMS, SMSDocument } from '../../gateway/schemas/sms.schema'
import { Device, DeviceDocument } from '../../gateway/schemas/device.schema'
import { Plan, PlanDocument } from '../schemas/plan.schema'
import {
  BillingNotification,
  BillingNotificationDocument,
} from '../schemas/billing-notification.schema'
import { monthlyWindowStart } from '../../notifications/rules/usage-window'
import { localMidnight, planLabel, USAGE_EMAIL_LIMITS } from '../usage-emails'

type BillingNotificationJob = Job<{
  notificationId: Types.ObjectId
  userId: Types.ObjectId
  type: string
  title: string
  message: string
  meta: Record<string, any>
  createdAt: Date
  sendEmail?: boolean
  emailKey?: string
}>

const LABEL_30_DAYS = 'Messages in the last 30 days'
const LABEL_TODAY = 'Messages used today'

const left = (limit: number, used: number) =>
  formatCount(Math.max(0, Number(limit) - Number(used)))

// Plan prices are stored in cents; a missing price leaves its value unset so the send fails visibly.
const money = (cents: unknown): string | undefined =>
  typeof cents === 'number' && cents > 0 ? `$${(cents / 100).toFixed(2)}` : undefined

const priceVars = (prefix: string, plan: { monthlyPrice?: number; yearlyPrice?: number }) => ({
  [`${prefix}Price`]: money(plan.monthlyPrice),
  [`${prefix}YearlyPrice`]: money(plan.yearlyPrice),
  [`${prefix}YearlyMonthly`]: money(
    typeof plan.yearlyPrice === 'number' ? Math.round(plan.yearlyPrice / 12) : undefined,
  ),
})

@Processor('billing-notifications')
export class BillingNotificationsProcessor {
  constructor(
    private readonly mailService: MailService,
    @InjectModel(BillingNotification.name)
    private readonly notificationModel: Model<BillingNotificationDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(SentEmail.name)
    private readonly sentEmailModel: Model<SentEmailDocument>,
    @InjectModel(Plan.name)
    private readonly planModel: Model<PlanDocument>,
    @InjectModel(SMS.name)
    private readonly smsModel: Model<SMSDocument>,
    @InjectModel(Device.name)
    private readonly deviceModel: Model<DeviceDocument>,
  ) {}

  @Process({ name: 'send', concurrency: 1 })
  async handleSend(job: BillingNotificationJob) {
    const { emailKey, userId, notificationId, type } = job.data ?? {}
    // Jobs queued before templates carry no key and are dropped.
    if (!job.data?.sendEmail || !emailKey || !USAGE_EMAIL_LIMITS[emailKey]) {
      return
    }

    const now = new Date()
    const cappedFrom = await this.cappedFrom(userId, emailKey, now)
    if (cappedFrom) {
      await this.recordAttempt(notificationId, emailKey, 'skipped', cappedFrom)
      return
    }

    const vars = await this.buildVars(emailKey, userId, job.data.meta ?? {}, now)
    const result = await this.mailService.sendTemplated({
      key: emailKey,
      userId,
      vars,
      meta: { billingNotificationId: notificationId, notificationType: type },
    })
    await this.recordAttempt(notificationId, emailKey, result, now)
  }

  private async recordAttempt(
    notificationId: Types.ObjectId,
    emailKey: string,
    result: 'sent' | 'skipped' | 'failed',
    at: Date,
  ) {
    const update: Record<string, any> = {
      $set: { lastEmailKey: emailKey, lastEmailAttemptAt: at, lastEmailResult: result },
    }
    if (result === 'sent') {
      update.$set.lastEmailSentAt = at
      update.$inc = { sentEmailCount: 1 }
    }
    await this.notificationModel.updateOne({ _id: notificationId }, update)
  }

  /** When this template is capped, the time its gate should count from; otherwise null. */
  async cappedFrom(
    userId: Types.ObjectId | string,
    key: string,
    now: Date,
  ): Promise<Date | null> {
    const { windowMs, maxInWindow } = USAGE_EMAIL_LIMITS[key]
    const filter = (ms: number) => ({
      user: new Types.ObjectId(String(userId)),
      type: key,
      status: 'sent',
      sentAt: { $gte: new Date(now.getTime() - ms) },
    })
    const last = await this.sentEmailModel
      .findOne(filter(windowMs))
      .sort({ sentAt: -1 })
      .select('sentAt')
      .lean()
    if (last?.sentAt) return new Date(last.sentAt)
    if (
      maxInWindow &&
      (await this.sentEmailModel.countDocuments(filter(maxInWindow.windowMs))) >=
        maxInWindow.count
    ) {
      return now
    }
    return null
  }

  async buildVars(
    key: string,
    userId: Types.ObjectId | string,
    meta: Record<string, any>,
    now: Date,
  ): Promise<TemplateVars> {
    const user = new Types.ObjectId(String(userId))
    const vars: TemplateVars = {
      billingUrl: billingUrl(),
      upgradeUrl: upgradeUrl(),
      scaleUpgradeUrl: scaleUpgradeUrl(),
      headroomPercent: '10%',
      planName: planLabel(meta.planName),
    }

    if (key.startsWith('U1') || key.startsWith('U2')) {
      Object.assign(vars, {
        used: formatCount(meta.processedSmsLastMonth),
        limit: formatCount(meta.monthlyLimit),
        left: left(meta.monthlyLimit, meta.processedSmsLastMonth),
        usageLabel: LABEL_30_DAYS,
      })
    }
    if (key === 'U3' || key === 'U4') {
      const account = await this.userModel.findById(user).select('signupCountry').lean()
      Object.assign(vars, {
        used: formatCount(meta.processedSmsToday),
        limit: formatCount(meta.dailyLimit),
        left: left(meta.dailyLimit, meta.processedSmsToday),
        usageLabel: LABEL_TODAY,
        localMidnight: localMidnight(account?.signupCountry, now),
      })
    }
    if (key === 'U5') {
      // One template, two versions: batch size, or a batch larger than the room left.
      const daily = meta.roomWindow === 'daily'
      const roomCase = meta.roomWindow === 'daily' || meta.roomWindow === 'monthly'
      Object.assign(vars, {
        attempted: formatCount(meta.attempted),
        bulkLimit: roomCase ? '' : formatCount(meta.bulkSendLimit),
        roomLeft: roomCase ? pluralize(Number(meta.roomLeft), 'message', 'messages') : '',
        roomWindow: roomCase ? (daily ? 'left today' : 'left in your 30-day allowance') : '',
        roomResetNote: roomCase
          ? daily
            ? 'midnight UTC'
            : 'older messages leave the 30-day count'
          : '',
      })
    }
    if (key === 'U6_paid') vars.deviceLimit = formatCount(meta.deviceLimit)

    if (key.startsWith('U2')) vars.resetDate = await this.resetDate(user, now)
    if (key === 'U6') vars.deviceName = await this.deviceName(user)
    if (['U1', 'U2', 'U2_paid', 'U3', 'U4', 'U6'].includes(key)) {
      const plans = await this.planModel.find({ name: { $in: ['pro', 'scale'] } }).lean()
      const pro = plans.find((p) => p.name === 'pro')
      const scale = plans.find((p) => p.name === 'scale')
      // A missing plan leaves its values unset, so the send fails visibly.
      if (pro) {
        vars.proMonthlyLimit = formatCount(pro.monthlyLimit)
        vars.proDeviceLimit = formatCount(pro.deviceLimit ?? -1)
        Object.assign(vars, priceVars('pro', pro))
      }
      if (scale) {
        vars.scaleMonthlyLimit = formatCount(scale.monthlyLimit)
        vars.scaleDeviceLimit = formatCount(scale.deviceLimit ?? -1)
        Object.assign(vars, priceVars('scale', scale))
      }
    }
    return vars
  }

  // The oldest message in the window leaves the count one window length after it arrived.
  private async resetDate(user: Types.ObjectId, now: Date): Promise<string> {
    const start = monthlyWindowStart(now)
    const oldest = await this.smsModel
      .findOne({ user, createdAt: { $gte: start } })
      .sort({ createdAt: 1 })
      .select('createdAt')
      .lean()
    const from = (oldest as any)?.createdAt ? new Date((oldest as any).createdAt) : now
    return formatDate(new Date(from.getTime() + (now.getTime() - start.getTime())), now)
  }

  private async deviceName(user: Types.ObjectId): Promise<string> {
    const device = await this.deviceModel
      .findOne({ user, enabled: true })
      .sort({ createdAt: 1 })
      .select('name brand model')
      .lean()
    const raw = device?.name || [device?.brand, device?.model].filter(Boolean).join(' ')
    return sanitizeUserText(raw) || 'your phone'
  }

  @OnQueueFailed()
  onFailed(job: BillingNotificationJob, err: Error) {
    console.error('billing notification email failed', {
      notificationId: job?.data?.notificationId,
      type: job?.data?.type,
      error: err?.message,
    })
  }
}
