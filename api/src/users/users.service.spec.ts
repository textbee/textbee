import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { UsersService } from './users.service'
import * as mongoose from 'mongoose'
import { User, UserSchema } from './schemas/user.schema'
import { describeClient } from '../common/user-agent'

const WINDOWS_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

describe('UsersService - signup attribution', () => {
  let service: UsersService
  const saved: any[] = []

  // A constructor-shaped mock, because create() does `new this.userModel(...)`.
  function UserModel(this: any, doc: any) {
    Object.assign(this, doc)
    this.save = jest.fn().mockResolvedValue(this)
    saved.push(this)
  }
  ;(UserModel as any).findOne = jest.fn()
  ;(UserModel as any).updateOne = jest.fn()

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: UserModel },
      ],
    }).compile()

    service = module.get<UsersService>(UsersService)
    saved.length = 0
    jest.clearAllMocks()
    ;(UserModel as any).findOne.mockResolvedValue(null)
  })

  it('records the normalised source and device at signup', async () => {
    await service.create({
      name: 'Ada',
      email: 'ada@example.com',
      attribution: { first: { source: 'meta', campaign: 'c1' } },
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)',
    })

    expect(saved[0]).toMatchObject({
      signupSource: 'meta',
      signupDevice: 'android',
      attribution: { first: { source: 'meta', campaign: 'c1' } },
    })
  })

  it('records the region the signup came from', async () => {
    await service.create({
      name: 'Ada',
      email: 'ada@example.com',
      country: 'DE',
    })

    expect(saved[0].signupCountry).toBe('DE')
  })

  it('leaves the region unset when the edge did not report one', async () => {
    await service.create({ name: 'Ada', email: 'ada@example.com' })

    expect(saved[0].signupCountry).toBeUndefined()
  })

  it('falls back to direct rather than leaving the source blank', async () => {
    await service.create({ name: 'Ada', email: 'ada@example.com' })

    expect(saved[0].signupSource).toBe('direct')
    expect(saved[0].signupDevice).toBe('unknown')
  })

  it('defaults the marketing opt in to false', async () => {
    await service.create({ name: 'Ada', email: 'ada@example.com' })
    expect(saved[0].marketingOptIn).toBe(false)

    await service.create({
      name: 'Ada',
      email: 'ada@example.com',
      marketingOptIn: true,
    })
    expect(saved[1].marketingOptIn).toBe(true)
  })

  it('records the browser and platform at signup in both client slots', async () => {
    await service.create({
      name: 'Ada',
      email: 'ada@example.com',
      userAgent: WINDOWS_CHROME,
    })

    expect(saved[0].signupDevice).toBe('desktop')
    expect(saved[0].client.signup).toMatchObject({
      device: 'desktop',
      os: 'windows',
      browser: 'chrome',
      userAgent: WINDOWS_CHROME,
      at: expect.any(Date),
    })
    expect(saved[0].client.last).toEqual(saved[0].client.signup)
  })

  it('records the device class but no client for a caller that is not a browser', async () => {
    await service.create({
      name: 'Ada',
      email: 'ada@example.com',
      userAgent: 'curl/8.4.0',
    })

    expect(saved[0].signupDevice).toBe('other')
    expect(saved[0].client).toBeUndefined()
  })
})

describe('UsersService - markMilestone', () => {
  let service: UsersService
  const userModel = { updateOne: jest.fn() }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: userModel },
      ],
    }).compile()

    service = module.get<UsersService>(UsersService)
    jest.clearAllMocks()
  })

  it('only writes when the milestone is not already set', async () => {
    userModel.updateOne.mockResolvedValue({ modifiedCount: 1 })

    await service.markMilestone('user-1', 'firstSmsAt')

    expect(userModel.updateOne).toHaveBeenCalledWith(
      { _id: 'user-1', 'milestones.firstSmsAt': { $exists: false } },
      { $set: { 'milestones.firstSmsAt': expect.any(Date) } },
    )
  })

  it('reports true once and false afterwards, so callers fire one event', async () => {
    userModel.updateOne.mockResolvedValueOnce({ modifiedCount: 1 })
    expect(await service.markMilestone('user-1', 'firstPaidAt')).toBe(true)

    userModel.updateOne.mockResolvedValueOnce({ modifiedCount: 0 })
    expect(await service.markMilestone('user-1', 'firstPaidAt')).toBe(false)
  })
})

describe('UsersService - markEmailVerified', () => {
  let service: UsersService
  const userModel = { updateOne: jest.fn() }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: userModel },
      ],
    }).compile()

    service = module.get<UsersService>(UsersService)
    jest.clearAllMocks()
  })

  it('writes only while the account holds the address and is unverified', async () => {
    userModel.updateOne.mockResolvedValue({ matchedCount: 1 })

    await expect(
      service.markEmailVerified('user-1', 'ada@example.com'),
    ).resolves.toBe(true)
    expect(userModel.updateOne).toHaveBeenCalledWith(
      { _id: 'user-1', email: 'ada@example.com', emailVerifiedAt: null },
      { $set: { emailVerifiedAt: expect.any(Date) } },
    )
  })

  it('reports false when the address changed or the account is verified', async () => {
    userModel.updateOne.mockResolvedValue({ matchedCount: 0 })

    await expect(
      service.markEmailVerified('user-1', 'ada@example.com'),
    ).resolves.toBe(false)
  })
})

describe('UsersService - touchClient', () => {
  let service: UsersService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: {} },
      ],
    }).compile()

    service = module.get<UsersService>(UsersService)
  })

  it('records the browser on the last slot only', () => {
    const user: any = { set: jest.fn() }

    service.touchClient(user, MAC_CHROME)

    expect(user.set).toHaveBeenCalledTimes(1)
    expect(user.set).toHaveBeenCalledWith(
      'client.last',
      expect.objectContaining({
        os: 'macos',
        browser: 'chrome',
        userAgent: MAC_CHROME,
      }),
    )
  })

  it('leaves the account alone for a caller that is not a browser', () => {
    const user: any = { set: jest.fn() }

    service.touchClient(user, 'curl/8.4.0')
    service.touchClient(user, undefined)

    expect(user.set).not.toHaveBeenCalled()
  })
})

describe('UsersService - client on a real document', () => {
  const UserModel = mongoose.model('UsersServiceClientSpec', UserSchema)
  const service = new UsersService(UserModel as any)

  it('casts the signup client into both slots', () => {
    const client = describeClient(MAC_CHROME)
    const doc = new UserModel({
      email: 'ada@example.com',
      client: { signup: client, last: client },
    })

    expect(doc.validateSync()).toBeFalsy()
    const stored = doc.toObject().client
    expect(stored.signup).toMatchObject({
      os: 'macos',
      browser: 'chrome',
      at: client.at,
    })
    expect(stored.last).toMatchObject({
      os: 'macos',
      browser: 'chrome',
      at: client.at,
    })
  })

  it('adds the last client to an account created without one', () => {
    const doc = new UserModel({ email: 'old@example.com' })
    expect(doc.toObject().client).toBeUndefined()

    service.touchClient(doc as any, WINDOWS_CHROME)

    const stored = doc.toObject().client
    expect(stored.last).toMatchObject({
      os: 'windows',
      browser: 'chrome',
      userAgent: WINDOWS_CHROME,
    })
    expect(stored.signup).toBeUndefined()
  })
})
