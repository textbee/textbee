import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import RelativeTime, {
  toCompactRelativeLabel,
  toExactLabel,
  toRelativeLabel,
} from './relative-time'

const NOW = new Date('2026-07-18T12:00:00.000Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('toRelativeLabel', () => {
  it('collapses anything under a minute to "Just now"', () => {
    expect(toRelativeLabel(ago(0), NOW)).toBe('Just now')
    expect(toRelativeLabel(ago(45 * SECOND), NOW)).toBe('Just now')
  })

  it('is strict, so it does not say "about"', () => {
    // formatDistanceToNow would render "about 3 minutes ago".
    expect(toRelativeLabel(ago(3 * MINUTE), NOW)).not.toContain('about')
  })
})

describe('toCompactRelativeLabel', () => {
  it('abbreviates the unit', () => {
    expect(toCompactRelativeLabel(ago(9 * HOUR), NOW)).toBe('9h ago')
    expect(toCompactRelativeLabel(ago(3 * MINUTE), NOW)).toBe('3m ago')
    expect(toCompactRelativeLabel(ago(2 * DAY), NOW)).toBe('2d ago')
    expect(toCompactRelativeLabel(ago(60 * DAY), NOW)).toBe('2mo ago')
  })

  it('collapses anything under a minute to "just now"', () => {
    expect(toCompactRelativeLabel(ago(30 * SECOND), NOW)).toBe('just now')
  })
})

// The pure helper takes an explicit `now`, but the component reads the real
// clock, so its inputs must be relative to the real clock too. Anchoring them
// to the fixed NOW above made these pass only on that one calendar day: a
// value 7 days before 2026-07-18 is 8 days before 2026-07-19.
const realAgo = (ms: number) => new Date(Date.now() - ms)

describe('RelativeTime', () => {
  it('renders a relative label for a past date', () => {
    render(<RelativeTime value={realAgo(7 * DAY)} />)
    expect(screen.getByText('7 days ago')).toBeInTheDocument()
  })

  it('exposes the machine-readable timestamp on a <time> element', () => {
    const value = realAgo(2 * DAY)
    const { container } = render(<RelativeTime value={value} />)
    const el = container.querySelector('time')
    expect(el).toBeInTheDocument()
    expect(el).toHaveAttribute('dateTime', value.toISOString())
  })

  it('is reachable by keyboard so the exact time is not hover-only', () => {
    const { container } = render(<RelativeTime value={realAgo(DAY)} />)
    expect(container.querySelector('time')).toHaveAttribute('tabindex', '0')
  })

  it('renders a short label without the dotted underline when compact', () => {
    const { container } = render(<RelativeTime value={realAgo(7 * DAY)} compact />)
    const el = container.querySelector('time')
    expect(el).toHaveTextContent('7d ago')
    expect(el).not.toHaveClass('underline')
  })

  it('renders the fallback for a null value', () => {
    render(<RelativeTime value={null} fallback='Never' />)
    expect(screen.getByText('Never')).toBeInTheDocument()
    expect(document.querySelector('time')).toBeNull()
  })

  it('renders the fallback for an unparseable value rather than "Invalid Date"', () => {
    render(<RelativeTime value='not-a-date' fallback='Unknown' />)
    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })

  it('formats the exact label with both date and time', () => {
    // Constructed from parts so the assertion does not depend on the TZ the
    // suite happens to run in.
    const date = new Date(2023, 4, 18, 13, 42)
    expect(toExactLabel(date)).toBe('May 18, 2023 at 1:42 PM')
  })
})
