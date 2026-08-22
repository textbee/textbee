import { ISendMailOptions, MailerService } from '@nest-modules/mailer'
import { Injectable, Logger } from '@nestjs/common'

// Context every template gets via the shared email-layout partial.
const layoutContext = () => ({
  brandName: 'textbee.dev',
  year: new Date().getFullYear(),
})

/** Keeps recipient addresses out of the logs while staying traceable. */
const redactRecipient = (to: ISendMailOptions['to']): string => {
  const first = Array.isArray(to) ? to[0] : to
  const address = typeof first === 'string' ? first : first?.address
  if (!address) {
    return 'unknown recipient'
  }
  const [local, domain] = address.split('@')
  if (!domain) {
    return 'redacted'
  }
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
