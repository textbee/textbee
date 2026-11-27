import { describe, expect, it } from 'vitest'
import { STEPS, computeStepStates, stepsFor } from './steps'

const byId = (id: string) => STEPS.find((s) => s.id === id)!

describe('onboarding steps', () => {
  it('verify_email is done only when the user has emailVerifiedAt', () => {
    expect(byId('verify_email').checkDone({}, undefined, null, [])).toBe(false)
    expect(
      byId('verify_email').checkDone(
        { emailVerifiedAt: '2026-01-01' },
        undefined,
        null,
        []
      )
    ).toBe(true)
  })

  it('download_app is done with a device or when skipped', () => {
    const step = byId('download_app')
    expect(step.checkDone({}, { totalDeviceCount: 0 }, null, [])).toBe(false)
    expect(step.checkDone({}, { totalDeviceCount: 1 }, null, [])).toBe(true)
    expect(step.checkDone({}, { totalDeviceCount: 0 }, null, ['download_app'])).toBe(
      true
    )
  })

  it('choose_plan is done on a paid plan or when skipped', () => {
    const step = byId('choose_plan')
    expect(step.checkDone({}, undefined, { plan: { name: 'Free' } }, [])).toBe(false)
    expect(step.checkDone({}, undefined, { plan: { name: 'Pro' } }, [])).toBe(true)
    expect(step.checkDone({}, undefined, null, ['choose_plan'])).toBe(true)
  })

  it('api_key / register_device / first_message follow the stats counters', () => {
    expect(byId('api_key').checkDone({}, { totalApiKeyCount: 1 }, null, [])).toBe(true)
    expect(
      byId('register_device').checkDone({}, { totalDeviceCount: 1 }, null, [])
    ).toBe(true)
    expect(
      byId('first_message').checkDone({}, { totalSentSMSCount: 1 }, null, [])
    ).toBe(true)
  })

  it('computeStepStates marks a fully-set-up paid user as all done', () => {
    const states = computeStepStates(
      { emailVerifiedAt: '2026-01-01' },
      { totalApiKeyCount: 2, totalDeviceCount: 1, totalSentSMSCount: 10 },
      { plan: { name: 'Pro' } },
      []
    )
    expect(states.every((s) => s.isDone)).toBe(true)
  })

  it('computeStepStates marks a brand-new user as nothing done', () => {
    const states = computeStepStates({}, {}, null, [])
    expect(states.some((s) => s.isDone)).toBe(false)
  })

  it('keeps the API key steps while phone sign-in is off', () => {
    expect(stepsFor(false)).toBe(STEPS)
    expect(computeStepStates({}, {}, null, []).map((s) => s.label)).toEqual([
      'Verify your email',
      'Download the Android app',
      'Generate an API key',
      'Register your device',
      'Choose your plan',
      'Send your first message',
    ])
  })

  it('puts the phone first and the key for own code second while sign-in is on', () => {
    const steps = computeStepStates({}, {}, null, [], true)
    expect(steps.map((s) => s.label)).toEqual([
      'Verify your email',
      'Download the Android app',
      'Connect your phone',
      'Create an API key for your code',
      'Choose your plan',
      'Send your first message',
    ])
    expect(steps.map((s) => s.id)).toEqual([
      'verify_email',
      'download_app',
      'register_device',
      'api_key',
      'choose_plan',
      'first_message',
    ])
  })

  it('marks the phone done by its device and the key done by a hand-made key', () => {
    const byIdOn = (id: string) => stepsFor(true).find((s) => s.id === id)!
    // A user who only signed in on a phone has a device and no key for their code
    expect(
      byIdOn('register_device').checkDone({}, { totalDeviceCount: 1, totalApiKeyCount: 0 }, null, [])
    ).toBe(true)
    expect(
      byIdOn('api_key').checkDone({}, { totalDeviceCount: 1, totalApiKeyCount: 0 }, null, [])
    ).toBe(false)
  })
})
