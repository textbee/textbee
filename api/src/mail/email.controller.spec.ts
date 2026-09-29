import { Types } from 'mongoose'
import { EmailController } from './email.controller'
import { signLink } from './email-render'

describe('EmailController', () => {
  const secret = 'link-secret'
  const env = { ...process.env }
  const userId = new Types.ObjectId()
  const token = () => signLink(secret, 'unsubscribe', String(userId), 0)

  const response = () => {
    const res: any = {}
    res.status = jest.fn(() => res)
    res.set = jest.fn(() => res)
    res.send = jest.fn(() => res)
    return res
  }

  let userModel: { updateOne: jest.Mock }
  let sesEvents: { handle: jest.Mock }
  let controller: EmailController

  beforeEach(() => {
    process.env = { ...env, EMAIL_LINK_SECRET: secret }
    userModel = { updateOne: jest.fn().mockResolvedValue({}) }
    sesEvents = { handle: jest.fn().mockResolvedValue('ok') }
    controller = new EmailController(userModel as any, sesEvents as any)
    jest.spyOn((controller as any).logger, 'log').mockImplementation(() => undefined)
  })
  afterAll(() => {
    process.env = env
  })

  it('asks before unsubscribing on GET and changes nothing', () => {
    const res = response()

    controller.unsubscribePage(token(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    const html = res.send.mock.calls[0][0]
    expect(html).toContain('Unsubscribe from textbee product emails?')
    expect(html).toContain('method="post"')
    expect(html).toContain('billing still arrive')
    expect(userModel.updateOne).not.toHaveBeenCalled()
  })

  it('turns product emails off on POST, including one-click', async () => {
    const res = response()

    await controller.unsubscribe(token(), { 'List-Unsubscribe': 'One-Click' }, res)

    const [filter, update] = userModel.updateOne.mock.calls[0]
    expect(filter).toEqual({ _id: userId })
    expect(update.$set.emailPreferences.productEmails).toBe(false)
    expect(update.$set.emailPreferences.changedAt).toBeInstanceOf(Date)
    expect(res.send.mock.calls[0][0]).toContain('Subscribe again')
    expect(res.send.mock.calls[0][0]).toContain('action="resubscribe?t=')
  })

  it('turns product emails back on', async () => {
    const res = response()

    await controller.resubscribe(token(), {}, res)

    expect(userModel.updateOne.mock.calls[0][1].$set.emailPreferences.productEmails).toBe(true)
    expect(res.status).toHaveBeenCalledWith(200)
  })

  it.each([
    ['tampered', () => token().slice(0, -3) + 'abc'],
    ['for another purpose', () => signLink(secret, 'card', String(userId), 0)],
    ['not an account id', () => signLink(secret, 'unsubscribe', 'abc', 0)],
    ['missing', () => undefined],
  ])('shows a 400 page for a %s token', async (_l, make) => {
    const res = response()

    await controller.unsubscribe(make(), {}, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.send.mock.calls[0][0]).toContain('support@textbee.dev')
    expect(userModel.updateOne).not.toHaveBeenCalled()
  })

  it('marks every page as uncacheable and keeps the token out of referrers', () => {
    const res = response()

    controller.unsubscribePage(token(), res)

    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }),
    )
  })

  it.each([
    ['ok', 200],
    ['invalid', 400],
    ['rejected', 403],
    ['error', 500],
  ])('answers an SES event that is %s with %i', async (result, status) => {
    sesEvents.handle.mockResolvedValue(result)
    const res = response()

    await controller.sesEvents('{}', res)

    expect(res.status).toHaveBeenCalledWith(status)
  })
})
