import { createSign, generateKeyPairSync } from 'crypto'
import { isSnsUrl, SesEventsService, snsStringToSign } from './ses-events.service'

describe('SesEventsService', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const certPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const CERT_URL = 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc.pem'
  const TOPIC = 'arn:aws:sns:us-east-1:123456789012:ses-events'
  const env = { ...process.env }

  const signed = (msg: Record<string, any>, version: '1' | '2' = '2'): any => {
    const full = { SignatureVersion: version, SigningCertURL: CERT_URL, TopicArn: TOPIC, ...msg }
    const signer = createSign(version === '1' ? 'RSA-SHA1' : 'RSA-SHA256')
    signer.update(snsStringToSign(full))
    return { ...full, Signature: signer.sign(privateKey, 'base64') }
  }

  const notification = (event: Record<string, any>, version: '1' | '2' = '2') =>
    signed(
      {
        Type: 'Notification',
        MessageId: 'm1',
        Message: JSON.stringify(event),
        Timestamp: new Date().toISOString(),
      },
      version,
    )

  let model: { updateOne: jest.Mock }
  let service: SesEventsService
  let fetchText: jest.SpyInstance

  beforeEach(() => {
    process.env = { ...env, SES_EVENTS_TOPIC_ARN: TOPIC }
    model = { updateOne: jest.fn().mockResolvedValue({}) }
    service = new SesEventsService(model as any)
    fetchText = jest.spyOn(service, 'fetchText').mockResolvedValue(certPem)
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined)
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined)
  })
  afterAll(() => {
    process.env = env
  })

  const bounce = {
    eventType: 'Bounce',
    bounce: {
      bounceType: 'Permanent',
      bounceSubType: 'General',
      timestamp: '2026-09-27T09:59:00.000Z',
      bouncedRecipients: [{ emailAddress: 'Ada <ADA@example.com>' }, { emailAddress: 'b@example.com' }],
    },
  }

  it.each(['1', '2'] as const)('suppresses a permanent bounce signed with version %s', async (v) => {
    await expect(service.handle(JSON.stringify(notification(bounce, v)))).resolves.toBe('ok')

    expect(model.updateOne).toHaveBeenCalledTimes(2)
    const [filter, update, options] = model.updateOne.mock.calls[0]
    expect(filter).toEqual({ email: 'ada@example.com' })
    expect(update.$set).toMatchObject({ reason: 'bounce', source: 'ses', detail: 'General' })
    expect(update.$set.at).toEqual(new Date('2026-09-27T09:59:00.000Z'))
    expect(options).toEqual({ upsert: true })
  })

  it('suppresses a complaint in the notification format', async () => {
    await service.handle(
      JSON.stringify(
        notification({
          notificationType: 'Complaint',
          complaint: { complainedRecipients: [{ emailAddress: 'c@example.com' }] },
        }),
      ),
    )

    expect(model.updateOne.mock.calls[0][0]).toEqual({ email: 'c@example.com' })
    expect(model.updateOne.mock.calls[0][1].$set.reason).toBe('complaint')
  })

  it.each([
    ['a transient bounce', { eventType: 'Bounce', bounce: { bounceType: 'Transient', bouncedRecipients: [{ emailAddress: 'a@example.com' }] } }],
    ['a delivery', { eventType: 'Delivery', delivery: {} }],
    ['an unknown shape', { hello: 'world' }],
  ])('ignores %s', async (_l, event) => {
    await expect(service.handle(JSON.stringify(notification(event)))).resolves.toBe('ok')
    expect(model.updateOne).not.toHaveBeenCalled()
  })

  it('rejects a message whose content was changed after signing', async () => {
    const msg = notification(bounce)
    msg.Message = msg.Message.replace('b@example.com', 'x@example.com')

    await expect(service.handle(JSON.stringify(msg))).resolves.toBe('rejected')
    expect(model.updateOne).not.toHaveBeenCalled()
  })

  it('rejects a certificate outside the SNS host', async () => {
    const msg = { ...notification(bounce), SigningCertURL: 'https://evil.example.com/cert.pem' }

    await expect(service.handle(JSON.stringify(msg))).resolves.toBe('rejected')
    expect(fetchText).not.toHaveBeenCalled()
  })

  it('rejects an unknown signature version', async () => {
    const msg = { ...notification(bounce), SignatureVersion: '3' }

    await expect(service.handle(JSON.stringify(msg))).resolves.toBe('rejected')
  })

  const confirmation = () =>
    signed({
      Type: 'SubscriptionConfirmation',
      MessageId: 'm2',
      Token: 'tok',
      Message: 'confirm',
      SubscribeURL: 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=tok',
      Timestamp: new Date().toISOString(),
    })

  it('refuses everything while no topic is configured', async () => {
    delete process.env.SES_EVENTS_TOPIC_ARN

    await expect(service.handle(JSON.stringify(confirmation()))).resolves.toBe('rejected')
    await expect(service.handle(JSON.stringify(notification(bounce)))).resolves.toBe('rejected')
    expect(fetchText).not.toHaveBeenCalled()
    expect(model.updateOne).not.toHaveBeenCalled()
  })

  it('refuses a subscription confirmation for another topic', async () => {
    const msg = signed({ ...confirmation(), TopicArn: `${TOPIC}-other` })

    await expect(service.handle(JSON.stringify(msg))).resolves.toBe('rejected')
    expect(fetchText).not.toHaveBeenCalled()
  })

  it('refuses a message older than one hour', async () => {
    const msg = signed({
      Type: 'Notification',
      MessageId: 'm3',
      Message: JSON.stringify(bounce),
      Timestamp: new Date(Date.now() - 61 * 60 * 1000).toISOString(),
    })

    await expect(service.handle(JSON.stringify(msg))).resolves.toBe('rejected')
    expect(model.updateOne).not.toHaveBeenCalled()
  })

  it('keeps at most 20 signing certificates', async () => {
    for (let i = 0; i < 25; i++) {
      const url = `https://sns.us-east-1.amazonaws.com/SimpleNotificationService-c${i}.pem`
      const msg = signed({
        Type: 'Notification',
        MessageId: `m${i}`,
        Message: JSON.stringify(bounce),
        Timestamp: new Date().toISOString(),
        SigningCertURL: url,
      })
      await service.handle(JSON.stringify(msg))
    }

    expect((service as any).certs.size).toBe(20)
  })

  it('rejects another topic when one is configured', async () => {
    process.env.SES_EVENTS_TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:other'

    await expect(service.handle(JSON.stringify(notification(bounce)))).resolves.toBe('rejected')
  })

  it('caches the signing certificate', async () => {
    await service.handle(JSON.stringify(notification(bounce)))
    await service.handle(JSON.stringify(notification(bounce)))

    expect(fetchText).toHaveBeenCalledTimes(1)
  })

  it('confirms a subscription for the configured topic through the SNS host', async () => {
    const confirm = confirmation()

    await expect(service.handle(JSON.stringify(confirm))).resolves.toBe('ok')
    expect(fetchText).toHaveBeenLastCalledWith(confirm.SubscribeURL)
  })

  it('reports a failed suppression write so the message is retried', async () => {
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined)
    model.updateOne.mockRejectedValue(new Error('db down'))

    await expect(service.handle(JSON.stringify(notification(bounce)))).resolves.toBe('error')
  })

  it('answers invalid input without throwing', async () => {
    await expect(service.handle('not json')).resolves.toBe('invalid')
    await expect(service.handle('{}')).resolves.toBe('invalid')
    await expect(service.handle(undefined)).resolves.toBe('invalid')
  })

  it('accepts only https SNS hosts', () => {
    expect(isSnsUrl('https://sns.eu-west-1.amazonaws.com/x.pem')).toBe(true)
    expect(isSnsUrl('http://sns.eu-west-1.amazonaws.com/x.pem')).toBe(false)
    expect(isSnsUrl('https://sns.eu-west-1.amazonaws.com.evil.com/x.pem')).toBe(false)
    expect(isSnsUrl('https://evil.com/sns.us-east-1.amazonaws.com')).toBe(false)
  })

  it('accepts signing certificates only from the SNS certificate path', () => {
    const ok = 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-0a1b2c.pem'
    expect(SesEventsService.isSnsCertUrl(ok)).toBe(true)
    for (const bad of [
      'https://sns.us-east-1.amazonaws.com/other.pem',
      'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-0a1b.pem?x=1',
      'https://sns.us-east-1.amazonaws.com:8443/SimpleNotificationService-0a1b.pem',
      'https://user@sns.us-east-1.amazonaws.com/SimpleNotificationService-0a1b.pem',
      'http://sns.us-east-1.amazonaws.com/SimpleNotificationService-0a1b.pem',
      'https://sns.us-east-1.amazonaws.com.evil.example/SimpleNotificationService-0a1b.pem',
    ]) {
      expect(SesEventsService.isSnsCertUrl(bad)).toBe(false)
    }
  })
})
