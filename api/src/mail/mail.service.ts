import { ISendMailOptions, MailerService } from '@nest-modules/mailer'
import { Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { layoutContext, renderTemplate } from './render-template'
import { SentEmail, SentEmailDocument } from './schemas/sent-email.schema'
import { User, UserDocument } from '../users/schemas/user.schema'
import {
  EmailSuppression,
  EmailSuppressionDocument,
} from './schemas/email-suppression.schema'
import { EmailTemplatesService } from './email-templates.service'
import { safeFirstName, TemplateVars } from './email-render'
import { EmailCategory, SkipReason, skipReason } from './email-eligibility'
import { unsubscribeUrl } from './email-links'

export interface MailLogOptions {
  userId?: Types.ObjectId | string
  category: string
  type?: string
  meta?: Record<string, any>
  redactContextKeys?: string[]
}

type SendResult = { sentAt: Date; info?: any; error?: string }

export interface TemplatedEmail {
  key: string
  userId: Types.ObjectId | string
  /** Defaults to the user's address. */
  to?: string
  vars?: TemplateVars
  meta?: Record<string, any>
  /** Variables kept out of the stored copy, such as one-time links. */
  redactVars?: string[]
}

export type TemplatedResult = 'sent' | 'failed' | 'skipped'

const REDACTED = '[redacted]'

/** One bare address, so a display name cannot leak through the mask. */
const BARE_ADDRESS = /^[^\s<>@,"]+@[^\s<>@,"]+$/

/** Keeps recipient addresses out of the logs while staying traceable. */
const redactRecipient = (to: ISendMailOptions['to']): string => {
  if (Array.isArray(to)) {
    return to.length === 1 ? redactRecipient(to[0]) : 'redacted'
  }
  const address = typeof to === 'string' ? to : to?.address
  if (!address) {
    return 'unknown recipient'
  }
  const trimmed = address.trim()
  if (!BARE_ADDRESS.test(trimmed)) {
    return 'redacted'
  }
  const [local, domain] = trimmed.split('@')
  return `${local.slice(0, 2)}***@${domain}`
}

const toAddressList = (value: ISendMailOptions['to']): string[] => {
  if (!value) return []
  const list = Array.isArray(value) ? value : [value]
  return list
    .flatMap((entry) =>
      typeof entry === 'string' ? entry.split(',') : [entry?.address],
    )
    .map((address) => address?.trim())
    .filter(Boolean)
    .map((address) => address.match(/<([^<>]+)>\s*$/)?.[1] ?? address)
}

const parseProviderMessageId = (response: unknown): string | undefined =>
  typeof response === 'string'
    ? response.match(/^250\s+Ok\s+<?([^\s<>]+)>?/i)?.[1]
    : undefined

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name)

  constructor(
    private readonly mailerService: MailerService,
    @InjectModel(SentEmail.name)
    private readonly sentEmailModel: Model<SentEmailDocument>,
    private readonly emailTemplates: EmailTemplatesService,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(EmailSuppression.name)
    private readonly suppressionModel: Model<EmailSuppressionDocument>,
  ) {}

  private senderAddresses(sender: string): { from?: string; replyTo?: string } {
    if (sender === 'notifications') {
      const defaults = this.emailTemplates.sender('notifications')
      return {
        from: process.env.MAIL_FROM_NOTIFICATIONS || defaults?.from,
        replyTo: process.env.MAIL_REPLY_TO_NOTIFICATIONS || defaults?.replyTo,
      }
    }
    return { replyTo: process.env.MAIL_REPLY_TO || undefined }
  }

  /** Sends one bundled template after the eligibility and suppression checks. */
  async sendTemplated({
    key,
    userId,
    to,
    vars = {},
    meta = {},
    redactVars = [],
  }: TemplatedEmail): Promise<TemplatedResult> {
    const template = this.emailTemplates.getDefault(key)
    if (!template) throw new Error(`Unknown email template: ${key}`)
    const category = template.stream as EmailCategory
    const log = { userId, category, type: key, meta }

    const user = await this.userModel.findById(userId).lean()
    const address = (to ?? user?.email)?.trim()
    const suppressed = address
      ? !!(await this.suppressionModel.exists({ email: address.toLowerCase() }))
      : false
    const reason = skipReason(user, suppressed)
    if (reason) {
      await this.saveSkip(address, reason, log)
      return 'skipped'
    }

    const fullVars: TemplateVars = {
      firstName: safeFirstName(user.name),
      ...vars,
      year: new Date().getUTCFullYear(),
      unsubscribeUrl: unsubscribeUrl(String(userId)),
    }

    let resolved: Awaited<ReturnType<EmailTemplatesService['render']>>
    try {
      resolved = await this.emailTemplates.render(key, fullVars)
    } catch (e) {
      this.logger.error(`Failed to render "${key}" email: ${e?.message}`)
      await this.saveResult(
        { to: address, subject: undefined },
        { sentAt: new Date(), error: `render: ${e?.message ?? e}` },
        { ...log, meta: { ...meta, templateVersion: 0 } },
        () => null,
      )
      return 'failed'
    }
    if (!resolved.enabled) {
      await this.saveSkip(address, 'disabled', log)
      return 'skipped'
    }

    const { subject, html, text } = resolved.document
    const headers: Record<string, string> = {
      'X-SES-MESSAGE-TAGS': `template=${key}`,
    }
    if (process.env.SES_CONFIGURATION_SET_NOTICES) {
      headers['X-SES-CONFIGURATION-SET'] = process.env.SES_CONFIGURATION_SET_NOTICES
    }
    if (template.listUnsubscribeHeader) {
      headers['List-Unsubscribe'] = `<${fullVars.unsubscribeUrl}>`
      headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'
    }

    const { from, replyTo } = this.senderAddresses(template.sender)
    const options: ISendMailOptions = { to: address, subject, html, text, headers }
    if (from) options.from = from
    if (replyTo) options.replyTo = replyTo

    const result: SendResult = { sentAt: new Date() }
    try {
      result.info = await this.mailerService.sendMail(options)
    } catch (e) {
      result.error = e?.message ?? String(e)
      this.logger.error(
        `Failed to send "${key}" email to ${redactRecipient(address)}: ${e?.message}`,
      )
    }

    const hidden: TemplateVars = { unsubscribeUrl: REDACTED }
    for (const name of redactVars) hidden[name] = REDACTED
    const version = resolved.version
    await this.saveResult(
      options,
      result,
      { ...log, meta: { ...meta, templateVersion: version } },
      () => null,
      async () =>
        (await this.emailTemplates.render(key, { ...fullVars, ...hidden }))
          .document?.html ?? null,
    )
    return result.error === undefined ? 'sent' : 'failed'
  }

  private async saveSkip(
    address: string | undefined,
    reason: SkipReason,
    log: MailLogOptions,
  ) {
    try {
      await this.sentEmailModel.create({
        source: 'api',
        category: log.category,
        type: log.type,
        user: log.userId,
        to: address ? [address] : [],
        status: 'skipped',
        error: reason,
        meta: log.meta ?? {},
        sentAt: new Date(),
      })
    } catch (e) {
      this.logger.error(`Failed to save email result: ${e?.message}`)
    }
  }

  async sendEmail({ to, subject, html, from }, log?: MailLogOptions) {
    const sendMailOptions: ISendMailOptions = {
      to,
      subject,
      html,
    }

    if (from) {
      sendMailOptions['from'] = from
    }

    if (process.env.MAIL_REPLY_TO) {
      sendMailOptions['replyTo'] = process.env.MAIL_REPLY_TO
    }
    const result: SendResult = { sentAt: new Date() }
    try {
      result.info = await this.mailerService.sendMail(sendMailOptions)
    } catch (e) {
      result.error = e?.message ?? String(e)
      this.logger.error(
        `Failed to send email to ${redactRecipient(to)}: ${e?.message}`,
      )
    }

    await this.saveResult(sendMailOptions, result, log, () => html ?? null)
  }

  async sendEmailFromTemplate(
    { to, cc, subject, template, context, from }: ISendMailOptions,
    log?: MailLogOptions,
  ) {
    const sendMailOptions: ISendMailOptions = {
      to,
      cc,
      subject,
      template,
      context: { ...context, ...layoutContext() },
    }

    if (from) {
      sendMailOptions['from'] = from
    }

    if (process.env.MAIL_REPLY_TO) {
      sendMailOptions['replyTo'] = process.env.MAIL_REPLY_TO
    }

    const result: SendResult = { sentAt: new Date() }
    try {
      result.info = await this.mailerService.sendMail(sendMailOptions)
    } catch (e) {
      result.error = e?.message ?? String(e)
      this.logger.error(
        `Failed to send "${template}" email to ${redactRecipient(to)}: ${e?.message}`,
      )
    }

    await this.saveResult(sendMailOptions, result, log, () => {
      const redacted: Record<string, any> = { ...context }
      for (const key of log?.redactContextKeys ?? []) {
        redacted[key] = '[redacted]'
      }
      return renderTemplate(template, redacted)
    })
  }

  private async saveResult(
    options: ISendMailOptions,
    { sentAt, info, error }: SendResult,
    log: MailLogOptions | undefined,
    renderHtml: () => string | null,
    renderHtmlAsync?: () => Promise<string | null>,
  ) {
    try {
      let html: string | null = null
      try {
        html = renderHtmlAsync ? await renderHtmlAsync() : renderHtml()
      } catch (e) {
        this.logger.warn(`Failed to render stored email body: ${e?.message}`)
      }

      const response =
        typeof info?.response === 'string' ? info.response : undefined
      const from = options.from ?? process.env.MAIL_FROM
      const replyTo = options.replyTo

      await this.sentEmailModel.create({
        source: 'api',
        category: log?.category,
        type: log?.type ?? options.template,
        user: log?.userId,
        to: toAddressList(options.to),
        cc: toAddressList(options.cc),
        from: from ? toAddressList(from as any)[0] : undefined,
        replyTo: replyTo ? toAddressList(replyTo as any)[0] : undefined,
        subject: options.subject,
        html,
        status: error === undefined ? 'sent' : 'failed',
        error,
        providerMessageId: parseProviderMessageId(response),
        providerResponse: response,
        meta: log?.meta ?? {},
        sentAt,
      })
    } catch (e) {
      this.logger.error(`Failed to save email result: ${e?.message}`)
    }
  }
}
