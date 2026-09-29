import { MailService } from './mail.service'
import { EmailTemplatesService } from './email-templates.service'

const build = () => {
  const mailerService: any = { sendMail: jest.fn().mockResolvedValue(undefined) }
  const sentEmailModel: any = { create: jest.fn().mockResolvedValue({}) }
  return {
    service: new MailService(
      mailerService,
      sentEmailModel,
      undefined as any,
      undefined as any,
      undefined as any,
    ),
    mailerService,
    sentEmailModel,
  }
}

describe('MailService', () => {
  beforeEach(() => jest.clearAllMocks())

  it('adds the shared layout context to every templated email', async () => {
    const { service, mailerService } = build()

    await service.sendEmailFromTemplate({
      to: 'user@example.com',
      subject: 'Password reset',
      template: 'account-deletion-request',
      context: { name: 'Ada' },
    })

    const { context } = mailerService.sendMail.mock.calls[0][0]
    expect(context).toMatchObject({
      name: 'Ada',
      brandName: 'textbee.dev',
      year: new Date().getFullYear(),
    })
  })

  it('keeps the shared layout values authoritative', async () => {
    const { service, mailerService } = build()

    await service.sendEmailFromTemplate({
      to: 'user@example.com',
      subject: 'Password reset',
      template: 'account-deletion-request',
      context: { brandName: 'somewhere-else', year: 1999 },
    })

    const { context } = mailerService.sendMail.mock.calls[0][0]
    expect(context.brandName).toBe('textbee.dev')
    expect(context.year).toBe(new Date().getFullYear())
  })

  it('works when a caller passes no context at all', async () => {
    const { service, mailerService } = build()

    await service.sendEmailFromTemplate({
      to: 'user@example.com',
      subject: 'Password reset',
      template: 'account-deletion-request',
    })

    expect(mailerService.sendMail.mock.calls[0][0].context).toMatchObject({
      brandName: 'textbee.dev',
    })
  })

  const logRecipientFor = async (to: unknown) => {
    const { service, mailerService } = build()
    const logger = jest
      .spyOn((service as any).logger, 'error')
      .mockImplementation(() => undefined)
    mailerService.sendMail.mockRejectedValue(new Error('smtp down'))

    await service.sendEmailFromTemplate({
      to: to as any,
      subject: 'Password reset',
      template: 'account-deletion-request',
    })

    return logger.mock.calls[0][0] as string
  }

  it.each([
    ['Ada Lovelace <someone@example.com>'],
    [['a@example.com', 'b@example.com']],
    [{ name: 'Ada' }],
    [''],
  ])('redacts a recipient it cannot mask safely: %p', async (to) => {
    const message = await logRecipientFor(to)
    expect(message).toContain('account-deletion-request')
    expect(message).toMatch(/to (redacted|unknown recipient): smtp down$/)
  })

  it('masks a structured recipient by its address alone', async () => {
    const message = await logRecipientFor({
      name: 'Ada Lovelace',
      address: 'someone@example.com',
    })
    expect(message).toMatch(/to so\*\*\*@example\.com: smtp down$/)
    expect(message).not.toContain('Ada Lovelace')
  })

  it('masks a single-entry recipient list', async () => {
    const message = await logRecipientFor(['someone@example.com'])
    expect(message).toMatch(/to so\*\*\*@example\.com: smtp down$/)
  })

  it('swallows a send failure and logs a redacted recipient', async () => {
    const { service, mailerService } = build()
    const logger = jest
      .spyOn((service as any).logger, 'error')
      .mockImplementation(() => undefined)
    mailerService.sendMail.mockRejectedValue(new Error('smtp down'))

    await expect(
      service.sendEmailFromTemplate({
        to: 'someone@example.com',
        subject: 'Password reset',
        template: 'account-deletion-request',
        context: {},
      }),
    ).resolves.toBeUndefined()

    const message = logger.mock.calls[0][0] as string
    expect(message).toBe(
      'Failed to send "account-deletion-request" email to so***@example.com: smtp down',
    )
  })

  describe('delivery results', () => {
    const quiet = (service: MailService) => {
      jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined)
      jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined)
    }

    it('saves a sent result with the provider message id', async () => {
      const { service, mailerService, sentEmailModel } = build()
      mailerService.sendMail.mockResolvedValue({
        messageId: '<local@example.com>',
        response: '250 Ok 0100018abc-1234-5678-000000',
      })

      await service.sendEmailFromTemplate(
        {
          to: 'Ada <ada@example.com>',
          cc: 'admin@example.com',
          subject: 'Password reset',
          template: 'account-deletion-request',
          context: { name: 'Ada' },
        },
        { userId: 'u1', category: 'auth', meta: { a: 1 } },
      )

      const doc = sentEmailModel.create.mock.calls[0][0]
      expect(doc).toMatchObject({
        source: 'api',
        category: 'auth',
        type: 'account-deletion-request',
        user: 'u1',
        to: ['ada@example.com'],
        cc: ['admin@example.com'],
        subject: 'Password reset',
        status: 'sent',
        providerMessageId: '0100018abc-1234-5678-000000',
        providerResponse: '250 Ok 0100018abc-1234-5678-000000',
        meta: { a: 1 },
      })
      expect(doc.error).toBeUndefined()
      expect(doc.sentAt).toBeInstanceOf(Date)
      expect(doc.html).toContain('Ada')
    })

    it('saves a failed result and does not throw', async () => {
      const { service, mailerService, sentEmailModel } = build()
      quiet(service)
      mailerService.sendMail.mockRejectedValue(new Error('smtp down'))

      await expect(
        service.sendEmailFromTemplate(
          {
            to: 'ada@example.com',
            subject: 'Password reset',
            template: 'account-deletion-request',
            context: { name: 'Ada' },
          },
          { category: 'auth' },
        ),
      ).resolves.toBeUndefined()

      expect(sentEmailModel.create.mock.calls[0][0]).toMatchObject({
        status: 'failed',
        error: 'smtp down',
      })
      expect(
        sentEmailModel.create.mock.calls[0][0].providerMessageId,
      ).toBeUndefined()
    })

    it('keeps redacted values out of the saved body but sends them', async () => {
      const { service, mailerService, sentEmailModel } = build()
      const message = 'private reason 482913'

      await service.sendEmailFromTemplate(
        {
          to: 'ada@example.com',
          subject: 'Account deletion',
          template: 'account-deletion-request',
          context: { name: 'Ada', email: 'ada@example.com', message },
        },
        { category: 'support', redactContextKeys: ['message'] },
      )

      expect(mailerService.sendMail.mock.calls[0][0].context).toMatchObject({
        message,
      })
      const { html } = sentEmailModel.create.mock.calls[0][0]
      expect(html).toContain('[redacted]')
      expect(html).not.toContain('482913')
    })

    it('saves a null body when rendering fails', async () => {
      const { service, sentEmailModel } = build()
      quiet(service)

      await service.sendEmailFromTemplate(
        { to: 'ada@example.com', subject: 'x', template: 'no-such-template' },
        { category: 'auth' },
      )

      expect(sentEmailModel.create.mock.calls[0][0]).toMatchObject({
        status: 'sent',
        html: null,
      })
    })

    it('does not throw when saving the result fails', async () => {
      const { service, mailerService, sentEmailModel } = build()
      quiet(service)
      sentEmailModel.create.mockRejectedValue(new Error('db down'))

      await expect(
        service.sendEmailFromTemplate(
          {
            to: 'ada@example.com',
            subject: 'Password reset',
            template: 'account-deletion-request',
            context: { name: 'Ada' },
          },
          { category: 'auth' },
        ),
      ).resolves.toBeUndefined()
      expect(mailerService.sendMail).toHaveBeenCalledTimes(1)
    })

    it('saves results for plain html sends', async () => {
      const { service, mailerService, sentEmailModel } = build()
      mailerService.sendMail.mockResolvedValue({ response: '250 Ok abc-1' })

      await service.sendEmail(
        { to: 'ada@example.com', subject: 'Hi', html: '<p>Hi</p>', from: undefined },
        { category: 'other', type: 'plain' },
      )

      expect(sentEmailModel.create.mock.calls[0][0]).toMatchObject({
        type: 'plain',
        html: '<p>Hi</p>',
        status: 'sent',
        providerMessageId: 'abc-1',
      })
    })
  })
})

describe('MailService.sendTemplated', () => {
  const userId = '507f1f77bcf86cd799439011'
  const env = { ...process.env }

  const setup = ({
    user = { _id: userId, email: 'ada@example.com', name: 'ADA LOVELACE' } as any,
    suppressed = false,
    overrides = [] as any[],
  } = {}) => {
    const mailerService: any = {
      sendMail: jest.fn().mockResolvedValue({ response: '250 Ok abc-1' }),
    }
    const sentEmailModel: any = { create: jest.fn().mockResolvedValue({}) }
    const lean = jest.fn().mockResolvedValue(user)
    const userModel: any = { findById: jest.fn(() => ({ lean })) }
    const suppressionModel: any = {
      exists: jest.fn().mockResolvedValue(suppressed ? { _id: 'x' } : null),
    }
    const templates = new EmailTemplatesService({
      find: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(overrides) })),
    } as any)
    jest.spyOn((templates as any).logger, 'warn').mockImplementation(() => undefined)
    const service = new MailService(
      mailerService,
      sentEmailModel,
      templates,
      userModel,
      suppressionModel,
    )
    return { service, mailerService, sentEmailModel, suppressionModel }
  }

  const sendT2 = (service: MailService) =>
    service.sendTemplated({
      key: 'T2',
      userId,
      vars: {
        resetUrl: 'https://app.test/reset?otp=482913',
        otp: '482913',
        linkTtl: '20 minutes',
      },
      redactVars: ['resetUrl', 'otp'],
    })

  beforeEach(() => {
    process.env = { ...env }
    delete process.env.SES_CONFIGURATION_SET_NOTICES
    delete process.env.MAIL_FROM_NOTIFICATIONS
    delete process.env.MAIL_REPLY_TO_NOTIFICATIONS
  })
  afterAll(() => {
    process.env = env
  })

  it('sends html and text from the notifications sender with the tag header', async () => {
    const { service, mailerService, sentEmailModel } = setup()

    await expect(sendT2(service)).resolves.toBe('sent')

    const mail = mailerService.sendMail.mock.calls[0][0]
    expect(mail).toMatchObject({
      to: 'ada@example.com',
      from: 'textbee <notifications@textbee.dev>',
      replyTo: 'support@textbee.dev',
      subject: 'Reset your textbee password',
      headers: { 'X-SES-MESSAGE-TAGS': 'template=T2' },
    })
    expect(mail.headers['X-SES-CONFIGURATION-SET']).toBeUndefined()
    expect(mail.headers['List-Unsubscribe']).toBeUndefined()
    expect(mail.text).toContain('Hi Ada,')
    expect(mail.text).toContain('482913')
    expect(mail.html).toContain('<!DOCTYPE html>')

    const doc = sentEmailModel.create.mock.calls[0][0]
    expect(doc).toMatchObject({
      category: 'account',
      type: 'T2',
      status: 'sent',
      meta: { templateVersion: 0 },
    })
    expect(doc.html).toContain('[redacted]')
    expect(doc.html).not.toContain('482913')
  })

  it('uses the env sender and configuration set when present', async () => {
    process.env.MAIL_FROM_NOTIFICATIONS = 'test <n@example.com>'
    process.env.SES_CONFIGURATION_SET_NOTICES = 'notices'
    const { service, mailerService } = setup()

    await sendT2(service)

    const mail = mailerService.sendMail.mock.calls[0][0]
    expect(mail.from).toBe('test <n@example.com>')
    expect(mail.headers['X-SES-CONFIGURATION-SET']).toBe('notices')
  })

  it('records the override version it used', async () => {
    const { service, sentEmailModel } = setup({
      overrides: [{ key: 'T2', subject: 'Reset it', version: 3 }],
    })

    await sendT2(service)

    expect(sentEmailModel.create.mock.calls[0][0]).toMatchObject({
      subject: 'Reset it',
      meta: { templateVersion: 3 },
    })
  })

  it.each([
    ['a suppressed address', { suppressed: true }, 'suppressed'],
    [
      'a banned account',
      { user: { _id: userId, email: 'a@example.com', isBanned: true } },
      'not_eligible',
    ],
    [
      'an account pending deletion',
      { user: { _id: userId, email: 'a@example.com', accountDeletionRequestedAt: new Date() } },
      'not_eligible',
    ],
    ['a missing account', { user: null }, 'not_eligible'],
  ])('skips %s and logs why', async (_label, opts: any, reason) => {
    const { service, mailerService, sentEmailModel } = setup(opts)

    await expect(sendT2(service)).resolves.toBe('skipped')

    expect(mailerService.sendMail).not.toHaveBeenCalled()
    expect(sentEmailModel.create.mock.calls[0][0]).toMatchObject({
      status: 'skipped',
      error: reason,
      type: 'T2',
    })
  })

  it('skips a disabled template and logs why', async () => {
    const { service, mailerService, sentEmailModel } = setup({
      overrides: [{ key: 'V2', enabled: false, version: 2 }],
    })

    await expect(
      service.sendTemplated({
        key: 'V2',
        userId,
        vars: { verificationUrl: 'https://app.test/v', linkTtl: '24 hours' },
      }),
    ).resolves.toBe('skipped')

    expect(mailerService.sendMail).not.toHaveBeenCalled()
    expect(sentEmailModel.create.mock.calls[0][0]).toMatchObject({
      status: 'skipped',
      error: 'disabled',
      type: 'V2',
    })
  })

  it('still sends a password reset that a row disables, but not to a suppressed address', async () => {
    const overrides = [{ key: 'T2', enabled: false, version: 2 }]
    const on = setup({ overrides })
    await expect(sendT2(on.service)).resolves.toBe('sent')

    const suppressed = setup({ overrides, suppressed: true })
    await expect(sendT2(suppressed.service)).resolves.toBe('skipped')
    expect(suppressed.mailerService.sendMail).not.toHaveBeenCalled()
  })

  it('checks suppression by the lowercase address', async () => {
    const { service, suppressionModel } = setup({
      user: { _id: userId, email: 'Ada@Example.com' },
    })

    await sendT2(service)

    expect(suppressionModel.exists).toHaveBeenCalledWith({ email: 'ada@example.com' })
  })

  it('ignores the product email preference for account notices', async () => {
    const { service } = setup({
      user: {
        _id: userId,
        email: 'a@example.com',
        emailPreferences: { productEmails: false },
      },
    })

    await expect(sendT2(service)).resolves.toBe('sent')
  })

  it('logs a failed send without throwing', async () => {
    const { service, mailerService, sentEmailModel } = setup()
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined)
    mailerService.sendMail.mockRejectedValue(new Error('smtp down'))

    await expect(sendT2(service)).resolves.toBe('failed')
    expect(sentEmailModel.create.mock.calls[0][0]).toMatchObject({
      status: 'failed',
      error: 'smtp down',
    })
  })
})
