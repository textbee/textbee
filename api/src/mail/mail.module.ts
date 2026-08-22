import { HandlebarsAdapter, MailerModule } from '@nest-modules/mailer'
import { Module } from '@nestjs/common'
import { join } from 'path'
import { mailTransportConfig } from './mail.config'
import { MailService } from './mail.service'

@Module({
  imports: [
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
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
