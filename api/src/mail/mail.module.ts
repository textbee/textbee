import { HandlebarsAdapter, MailerModule } from '@nest-modules/mailer'
import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { join } from 'path'
import { mailTransportConfig } from './mail.config'
import { MailService } from './mail.service'
import { SentEmail, SentEmailSchema } from './schemas/sent-email.schema'
import {
  EmailTemplate,
  EmailTemplateSchema,
} from './schemas/email-template.schema'
import { EmailTemplatesService } from './email-templates.service'
import {
  EmailSuppression,
  EmailSuppressionSchema,
} from './schemas/email-suppression.schema'
import { User, UserSchema } from '../users/schemas/user.schema'
import { EmailController } from './email.controller'
import { SesEventsService } from './ses-events.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SentEmail.name, schema: SentEmailSchema },
      { name: EmailTemplate.name, schema: EmailTemplateSchema },
      { name: EmailSuppression.name, schema: EmailSuppressionSchema },
      { name: User.name, schema: UserSchema },
    ]),
    MailerModule.forRoot({
      transport: mailTransportConfig,
      defaults: {
        from: `${process.env.MAIL_FROM}`,
      },
      template: {
        dir: join(__dirname, 'templates'),
        adapter: new HandlebarsAdapter(),
        options: {
          strict: true,
        },
      },
      // Top level, not under `template`: the adapter reads partials from
      // MailerOptions.options, and every template is a block inside the shared
      // email-layout partial.
      options: {
        partials: {
          dir: join(__dirname, 'templates', 'partials'),
          options: { strict: true },
        },
      },
    } as any),
  ],
  controllers: [EmailController],
  providers: [MailService, EmailTemplatesService, SesEventsService],
  exports: [MailService, EmailTemplatesService],
})
export class MailModule {}
