import { ISendMailOptions, MailerService } from '@nest-modules/mailer'
import { Injectable, Logger } from '@nestjs/common'

// Context every template gets via the shared email-layout partial.
const layoutContext = () => ({
  brandName: 'textbee.dev',
  year: new Date().getFullYear(),
})

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

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name)

  constructor(private readonly mailerService: MailerService) {}

  async sendEmail({ to, subject, html, from }) {
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
    try {
      await this.mailerService.sendMail(sendMailOptions)
    } catch (e) {
      this.logger.error(
        `Failed to send email to ${redactRecipient(to)}: ${e?.message}`,
      )
    }
  }

  async sendEmailFromTemplate({ to, cc, subject, template, context, from }: ISendMailOptions) {
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

    try {
      await this.mailerService.sendMail(sendMailOptions)
    } catch (e) {
      this.logger.error(
        `Failed to send "${template}" email to ${redactRecipient(to)}: ${e?.message}`,
      )
    }
  }
}
