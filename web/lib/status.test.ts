import { describe, expect, it } from 'vitest'
import { AlertTriangle, Check, CircleHelp, XCircle } from 'lucide-react'
import {
  subscriptionStatusIcon,
  subscriptionStatusTone,
  usageMeterColor,
} from './status'

// The billing card used to hardcode a check mark next to whatever the status
// text said, so a past_due or canceled subscriber was reassured with a tick at
// exactly the moment they needed a warning.
describe('subscriptionStatusIcon', () => {
  it('only shows a check for an active subscription', () => {
    expect(subscriptionStatusIcon('active')).toBe(Check)
  })

  it('warns rather than reassures when something is wrong', () => {
    expect(subscriptionStatusIcon('past_due')).toBe(AlertTriangle)
    expect(subscriptionStatusIcon('canceled')).toBe(XCircle)
  })

  it('does not claim health for an unknown or missing status', () => {
    expect(subscriptionStatusIcon(undefined)).toBe(CircleHelp)
    expect(subscriptionStatusIcon(null)).toBe(CircleHelp)
    expect(subscriptionStatusIcon('something_new')).toBe(CircleHelp)
  })
})

describe('subscriptionStatusTone', () => {
  it('keeps tone and icon agreeing about severity', () => {
    expect(subscriptionStatusTone('active').text).toContain('success')
    expect(subscriptionStatusTone('past_due').text).toContain('warning')
    expect(subscriptionStatusTone(undefined).text).toBe('text-muted-foreground')
  })
})

describe('usageMeterColor', () => {
  it('escalates with usage', () => {
    expect(usageMeterColor(0)).toBe('bg-success')
    expect(usageMeterColor(79)).toBe('bg-success')
    expect(usageMeterColor(80)).toBe('bg-warning')
    expect(usageMeterColor(100)).toBe('bg-destructive')
  })
})
