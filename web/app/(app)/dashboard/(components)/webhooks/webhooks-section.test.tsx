import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders, screen } from '@/test/render'
import WebhooksSection from './webhooks-section'

const useSubscription = vi.fn()
const useBillingPlans = vi.fn()
const getWebhooks = vi.fn()

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  useSubscription: () => useSubscription(),
  useBillingPlans: () => useBillingPlans(),
}))
vi.mock('@/lib/httpBrowserClient', () => ({
  default: { get: () => getWebhooks() },
}))
vi.mock('./webhook-card', () => ({ WebhookCard: () => <div>webhook</div> }))
vi.mock('./webhook-docs', () => ({ WebhookDocs: () => null }))
vi.mock('./create-webhook-dialog', () => ({ CreateWebhookDialog: () => null }))
vi.mock('./edit-webhook-dialog', () => ({ EditWebhookDialog: () => null }))

const withWebhooks = (count: number) =>
  getWebhooks.mockResolvedValue({
    data: {
      data: Array.from({ length: count }, (_, i) => ({ _id: `w${i}` })),
    },
  })

const onPlan = (name: string, webhookLimit: number | undefined) =>
  useSubscription.mockReturnValue({
    data: { plan: { name }, usage: { webhookLimit } },
  })

const createButton = () => screen.getByRole('button', { name: /create webhook/i })

beforeEach(() => {
  vi.clearAllMocks()
  useBillingPlans.mockReturnValue({
    data: [
      { name: 'free', webhookLimit: 5 },
      { name: 'pro', webhookLimit: 10 },
    ],
  })
})

describe('WebhooksSection limit', () => {
  it('shows usage against the plan limit', async () => {
    withWebhooks(2)
    onPlan('free', 5)
    renderWithProviders(<WebhooksSection />)

    expect(await screen.findByText('2 of 5 webhooks used')).toBeInTheDocument()
    expect(createButton()).toBeEnabled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows an unlimited plan without a limit', async () => {
    withWebhooks(12)
    onPlan('scale', -1)
    renderWithProviders(<WebhooksSection />)

    expect(await screen.findByText('12 webhooks, unlimited')).toBeInTheDocument()
    expect(createButton()).toBeEnabled()
  })

  it('disables create at the limit and offers Pro to a free account', async () => {
    withWebhooks(5)
    onPlan('free', 5)
    renderWithProviders(<WebhooksSection />)

    expect(await screen.findByText('5 of 5 webhooks used')).toBeInTheDocument()
    expect(createButton()).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Upgrade to Pro for 10 webhooks.',
    )
  })

  it('points a paid account near the limit to support', async () => {
    withWebhooks(9)
    onPlan('pro', 10)
    renderWithProviders(<WebhooksSection />)

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Need more? Contact support@textbee.dev.',
    )
    expect(createButton()).toBeEnabled()
  })

  it('points a free account to support when Pro has no higher limit', async () => {
    useBillingPlans.mockReturnValue({ data: [{ name: 'pro' }] })
    withWebhooks(5)
    onPlan('free', 5)
    renderWithProviders(<WebhooksSection />)

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Need more? Contact support@textbee.dev.',
    )
  })
})
