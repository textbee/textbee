import { placeholders } from './email-render'
import {
  EMAIL_DEFAULTS,
  EmailTemplatesService,
} from './email-templates.service'

const T3_VARS = { firstName: 'Ada', year: '2026', unsubscribeUrl: 'https://x.test/u' }

const build = (rows: any[] = []) => {
  const lean = jest.fn().mockResolvedValue(rows)
  const model: any = { find: jest.fn(() => ({ lean })) }
  const service = new EmailTemplatesService(model)
  const warn = jest
    .spyOn((service as any).logger, 'warn')
    .mockImplementation(() => undefined)
  return { service, model, warn }
}

describe('EmailTemplatesService', () => {
  it('renders the default copy when there is no override', async () => {
    const { service } = build()

    const r = await service.render('T3', T3_VARS)

    expect(r.enabled).toBe(true)
    expect(r.version).toBe(0)
    expect(r.document.subject).toBe('Your textbee password was changed')
    expect(r.document.text).toContain('Hi Ada,')
    expect(r.document.text).toContain('This is a notice about your textbee account.')
  })

  it('uses override fields that are present and keeps the rest', async () => {
    const { service } = build([
      { key: 'T3', subject: 'Password updated, {{firstName}}', version: 4 },
    ])

    const r = await service.render('T3', T3_VARS)

    expect(r.version).toBe(4)
    expect(r.document.subject).toBe('Password updated, Ada')
    expect(r.document.text).toContain('The password on your textbee account was changed.')
  })

  it('falls back to the default when an override uses an unknown placeholder', async () => {
    const { service, warn } = build([
      { key: 'T3', body: 'Hi {{nickname}}', version: 2 },
    ])

    const r = await service.render('T3', T3_VARS)

    expect(r.version).toBe(0)
    expect(r.document.text).toContain('Hi Ada,')
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('email_template_override_failed key=T3'),
    )
  })

  it('falls back to the default when an override needs a missing value', async () => {
    const { service, warn } = build([
      { key: 'T2', body: 'Code {{otp}} for {{resetUrl}}', version: 3 },
    ])

    const r = await service.render('T2', {
      ...T3_VARS,
      linkTtl: '20 minutes',
      resetUrl: 'https://app.test/r',
      otp: null,
    })
      .catch((e) => e)

    // The default needs the same value, so the error surfaces after the fallback.
    expect(r).toBeInstanceOf(Error)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('missing otp'))
  })

  it('uses the default copy when only the override needs the missing value', async () => {
    const { service, warn } = build([
      { key: 'U5', body: 'Batch of {{attempted}} over {{bulkLimit}}.', version: 3 },
    ])

    const r = await service.render('U5', {
      ...T3_VARS,
      upgradeUrl: 'https://app.test/u',
      attempted: '5',
      bulkLimit: null,
      roomLeft: '1 message',
      roomWindow: 'left today',
      roomResetNote: 'midnight UTC',
      billingUrl: 'https://app.test/b',
    })

    expect(r.version).toBe(0)
    expect(r.document.text).toContain('1 message left today')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('missing bulkLimit'))
  })

  it('does not treat a usage bar override as an unknown placeholder', async () => {
    const { service, warn } = build([
      { key: 'U1', body: 'Numbers:\n\n{{usageBar}}', version: 5 },
    ])

    const r = await service.render('U1', {
      ...T3_VARS,
      used: '241',
      limit: '300',
      left: '59',
      usageLabel: 'Messages in the last 30 days',
      billingUrl: 'https://app.test/b',
    })

    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining('email_template_override_failed'),
    )
    expect(r.version).toBe(5)
    expect(r.document.text).toContain('Messages in the last 30 days: 241 of 300')
  })

  it('skips rendering a disabled template', async () => {
    const { service } = build([{ key: 'V2', enabled: false, version: 2 }])

    const r = await service.render('V2', { linkTtl: '24 hours', verificationUrl: 'u' })

    expect(r.enabled).toBe(false)
    expect(r.document).toBeUndefined()
  })

  it.each(['T1', 'T2', 'T3', 'T4'])('keeps %s on when a row disables it, with a warning', async (key) => {
    const { service, warn } = build([{ key, enabled: false, version: 2 }])
    const vars = {
      ...T3_VARS,
      linkTtl: '20 minutes',
      verificationUrl: 'https://app.test/v',
      resetUrl: 'https://app.test/r',
      otp: '123456',
      deviceName: 'Pixel 8',
      connectedAt: '26 Nov 2026, 12:10 UTC',
      requestedFrom: 'Unknown place',
      action: 'added as a new device',
      keyName: 'Device sign-in: Pixel 8',
      apiKeysUrl: 'https://app.test/dashboard',
      changePasswordUrl: 'https://app.test/dashboard/account/change-password',
    }

    const r = await service.render(key, vars)

    expect(r.enabled).toBe(true)
    expect(r.document.subject).toBeTruthy()
    expect(warn).toHaveBeenCalledWith(`email_template_disable_ignored key=${key}`)
  })

  it('applies a footer override and ignores one with a foreign placeholder', async () => {
    const good = build([{ key: 'footer_notice', body: 'Footer {{year}}', version: 2 }])
    expect((await good.service.render('T3', T3_VARS)).document.text).toContain(
      'Footer 2026',
    )

    const bad = build([{ key: 'footer_notice', body: 'Footer {{firstName}}', version: 2 }])
    const r = await bad.service.render('T3', T3_VARS)
    expect(r.document.text).toContain('This is a notice about your textbee account.')
    expect(bad.warn).toHaveBeenCalled()
  })

  it('renders the base copy when the row has one', async () => {
    const { service } = build([
      {
        key: 'T3',
        baseSubject: 'Base subject for {{firstName}}',
        basePreheader: 'Base preheader',
        baseBody: 'Base body',
        version: 0,
      },
      { key: 'footer_notice', baseBody: 'Base footer {{year}}', version: 0 },
    ])

    const r = await service.render('T3', T3_VARS)

    expect(r.version).toBe(0)
    expect(r.document.subject).toBe('Base subject for Ada')
    expect(r.document.text).toContain('Base body')
    expect(r.document.text).toContain('Base footer 2026')
  })

  it('fills fields an edit leaves out from the base copy', async () => {
    const { service } = build([
      {
        key: 'T3',
        subject: 'Edited subject',
        baseSubject: 'Base subject',
        basePreheader: 'Base preheader',
        baseBody: 'Base body',
        version: 3,
      },
    ])

    const r = await service.render('T3', T3_VARS)

    expect(r.version).toBe(3)
    expect(r.document.subject).toBe('Edited subject')
    expect(r.document.text).toContain('Base body')
  })

  it('uses the base copy when the edit does not render', async () => {
    const { service, warn } = build([
      {
        key: 'T3',
        body: 'Hi {{nickname}}',
        baseSubject: 'Base subject',
        basePreheader: '',
        baseBody: 'Base body',
        version: 2,
      },
    ])

    const r = await service.render('T3', T3_VARS)

    expect(r.version).toBe(0)
    expect(r.document.text).toContain('Base body')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('edit placeholder nickname'))
  })

  it('uses the bundled copy when the base copy does not render', async () => {
    const { service, warn } = build([
      { key: 'T3', baseSubject: 'S', basePreheader: '', baseBody: 'Hi {{nickname}}', version: 0 },
    ])

    const r = await service.render('T3', T3_VARS)

    expect(r.document.subject).toBe('Your textbee password was changed')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('base placeholder nickname'))
  })

  it('prefers a footer edit over the base footer', async () => {
    const { service } = build([
      { key: 'footer_notice', body: 'Edited footer', baseBody: 'Base footer', version: 2 },
    ])

    const r = await service.render('T3', T3_VARS)

    expect(r.document.text).toContain('Edited footer')
    expect(r.document.text).not.toContain('Base footer')
  })

  it('warns once per key when the base copy is missing', async () => {
    const { service, warn } = build([
      { key: 'T3', baseSubject: 'S', baseBody: 'No preheader', version: 0 },
    ])

    const r = await service.render('T3', T3_VARS)
    await service.render('T3', T3_VARS)

    expect(r.document.subject).toBe('Your textbee password was changed')
    expect(warn.mock.calls.filter(([m]) => m === 'email_template_base_missing key=T3')).toHaveLength(1)
  })

  it('reads the overrides once per cache window', async () => {
    const { service, model } = build()

    await service.render('T3', T3_VARS)
    await service.render('T3', T3_VARS)

    expect(model.find).toHaveBeenCalledTimes(1)
  })

  it('renders every bundled template with its example values', () => {
    const { service } = build()
    return Promise.all(
      EMAIL_DEFAULTS.templates.map(async (t) => {
        const r = await service.render(t.key, { ...t.variables, year: '2026', unsubscribeUrl: 'u' })
        const out = `${r.document.subject}${r.document.text}${r.document.html}`
        expect([t.key, /{{|undefined|NaN/.test(out)]).toEqual([t.key, false])
        const used = placeholders(`${t.subject}${t.preheader}${t.body}`)
        expect(used.filter((p) => !(p in t.variables))).toEqual([])
      }),
    )
  })
})

describe('U5 versions', () => {
  const base = {
    firstName: 'Ada',
    year: '2026',
    unsubscribeUrl: 'u',
    billingUrl: 'https://app.test/b',
    upgradeUrl: 'https://app.test/u',
    attempted: '5',
  }

  it('renders the room version without the batch size text', async () => {
    const { service } = build()

    const r = await service.render('U5', {
      ...base,
      bulkLimit: '',
      roomLeft: '1 message',
      roomWindow: 'left today',
      roomResetNote: 'midnight UTC',
    })

    expect(r.document.subject).toBe('Your batch was not sent')
    expect(r.document.text).toContain('1 message left today')
    expect(r.document.text).toContain('You can send it after midnight UTC.')
    expect(r.document.text).not.toContain('per batch')
  })

  it('renders the batch size version without the room text', async () => {
    const { service } = build()

    const r = await service.render('U5', {
      ...base,
      attempted: '120',
      bulkLimit: '50',
      roomLeft: '',
      roomWindow: '',
      roomResetNote: '',
    })

    expect(r.document.text).toContain('allows up to 50 per batch')
    expect(r.document.text).not.toContain('left today')
  })
})
