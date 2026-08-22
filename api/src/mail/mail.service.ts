import { ISendMailOptions, MailerService } from '@nest-modules/mailer'
import { Injectable, Logger } from '@nestjs/common'

// Context every template gets via the shared email-layout partial.
const layoutContext = () => ({
  brandName: 'textbee.dev',
  year: new Date().getFullYear(),
})

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
      this.logger.error(`Failed to send email to ${to}`, e?.stack || e)
    }
  }

  async sendEmailFromTemplate({ to, cc, subject, template, context, from }: ISendMailOptions) {
    const sendMailOptions: ISendMailOptions = {
      to,
      cc,
      subject,
      template,
      context: { ...layoutContext(), ...context },
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
        `Failed to send "${template}" email to ${to}`,
        e?.stack || e,
      )
    }
  }
}
