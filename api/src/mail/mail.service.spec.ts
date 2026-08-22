import { MailService } from './mail.service'

const build = () => {
  const mailerService: any = { sendMail: jest.fn().mockResolvedValue(undefined) }
  return { service: new MailService(mailerService), mailerService }
}

describe('MailService', () => {
  beforeEach(() => jest.clearAllMocks())

  it('adds the shared layout context to every templated email', async () => {
    const { service, mailerService } = build()

    await service.sendEmailFromTemplate({
      to: 'user@example.com',
      subject: 'Password reset',
      template: 'password-reset-request',
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
      template: 'password-reset-request',
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
      template: 'password-reset-request',
    })

    expect(mailerService.sendMail.mock.calls[0][0].context).toMatchObject({
      brandName: 'textbee.dev',
    })
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
        template: 'password-reset-request',
        context: {},
      }),
    ).resolves.toBeUndefined()

    const message = logger.mock.calls[0][0] as string
    expect(message).toContain('password-reset-request')
    expect(message).toContain('so***@example.com')
    expect(message).not.toContain('someone@example.com')
  })
})
