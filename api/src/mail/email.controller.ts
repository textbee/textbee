import { Body, Controller, Get, Logger, Post, Query, Res } from '@nestjs/common'
import { ApiExcludeController } from '@nestjs/swagger'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Response } from 'express'
import { verifyLink } from './email-render'
import { emailLinkSecret } from './email-links'
import {
  invalidLinkPage,
  resubscribedPage,
  unsubscribeConfirmPage,
  unsubscribedPage,
} from './email-pages'
import { SesEventsService } from './ses-events.service'
import { User, UserDocument } from '../users/schemas/user.schema'

const sendPage = (res: Response, status: number, html: string) =>
  res
    .status(status)
    .set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    })
    .send(html)

// Links from emails and the mail provider callback, not part of the developer API.
@ApiExcludeController()
@Controller('email')
export class EmailController {
  private readonly logger = new Logger(EmailController.name)

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly sesEventsService: SesEventsService,
  ) {}

  private userIdFrom(token: unknown): Types.ObjectId | null {
    const secret = emailLinkSecret()
    const id = secret
      ? verifyLink(secret, token, 'unsubscribe', Math.floor(Date.now() / 1000))
      : null
    return id && /^[0-9a-f]{24}$/.test(id) ? new Types.ObjectId(id) : null
  }

  private async setProductEmails(userId: Types.ObjectId, productEmails: boolean) {
    await this.userModel.updateOne(
      { _id: userId },
      { $set: { emailPreferences: { productEmails, changedAt: new Date() } } },
    )
    this.logger.log(`Product emails ${productEmails ? 'on' : 'off'} for user ${userId}`)
  }

  // Asks first: link scanners open links, so a GET never changes anything.
  @Get('unsubscribe')
  unsubscribePage(@Query('t') t: string, @Res() res: Response) {
    if (!this.userIdFrom(t)) return sendPage(res, 400, invalidLinkPage())
    return sendPage(res, 200, unsubscribeConfirmPage(t))
  }

  // Also serves one-click unsubscribe from mail clients.
  @Post('unsubscribe')
  async unsubscribe(@Query('t') t: string, @Body() body: any, @Res() res: Response) {
    const token = t ?? body?.t
    const userId = this.userIdFrom(token)
    if (!userId) return sendPage(res, 400, invalidLinkPage())
    await this.setProductEmails(userId, false)
    return sendPage(res, 200, unsubscribedPage(token))
  }

  @Post('resubscribe')
  async resubscribe(@Query('t') t: string, @Body() body: any, @Res() res: Response) {
    const userId = this.userIdFrom(t ?? body?.t)
    if (!userId) return sendPage(res, 400, invalidLinkPage())
    await this.setProductEmails(userId, true)
    return sendPage(res, 200, resubscribedPage())
  }

  @Post('ses-events')
  async sesEvents(@Body() body: unknown, @Res() res: Response) {
    const result = await this.sesEventsService.handle(body)
    const status = { ok: 200, invalid: 400, rejected: 403, error: 500 }[result]
    return res.status(status).send()
  }
}
