import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Request,
  Query,
  Res,
} from '@nestjs/common'
import { Response } from 'express'
import { BillingService, PolarSubscriptionSync, toDate } from './billing.service'
import { AuthGuard } from 'src/auth/guards/auth.guard'
import {
  ApiTags,
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
} from '@nestjs/swagger'
import {
  BillingNotificationDTO,
  ChangePlanInputDTO,
  ChangePlanResponseDTO,
  CheckoutInputDTO,
  CheckoutResponseDTO,
  CurrentSubscriptionResponseDTO,
  PlanDTO,
  PlansResponseDTO,
} from './billing.dto'
import { BillingNotificationsService } from './billing-notifications.service'

const UNAUTHORIZED_RESPONSE = {
  status: 401,
  description: 'Missing, invalid, or revoked API key.',
} as const

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(
    private billingService: BillingService,
    private billingNotifications: BillingNotificationsService,
  ) {}

  @ApiOperation({
    summary: 'List the available plans',
    description: 'Public plan catalogue with prices. No credentials needed.',
  })
  @ApiResponse({
    status: 200,
    description: 'Plans that can be subscribed to.',
    type: [PlanDTO],
  })
  @Get('plans')
  async getPlans(): Promise<PlansResponseDTO> {
    return this.billingService.getPlans()
  }

  @ApiOperation({
    summary: 'Get your plan and usage',
    description:
      'The plan in force plus how much of its limits the account has used. Accounts without a paid plan get the free one.',
  })
  @ApiResponse({
    status: 200,
    description: 'Current plan and usage.',
    type: CurrentSubscriptionResponseDTO,
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @Get('current-subscription')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiSecurity('x-api-key')
  async getCurrentSubscription(@Request() req: any) {
    return this.billingService.getCurrentSubscription(req.user)
  }

  @ApiOperation({
    summary: 'List billing notifications',
    description:
      'Alerts raised for the account, newest first, such as a limit being reached or an email needing verification.',
  })
  @ApiResponse({
    status: 200,
    description: 'Up to 50 notifications.',
    type: [BillingNotificationDTO],
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @Get('notifications')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiSecurity('x-api-key')
  async listNotifications(@Request() req: any) {
    return this.billingNotifications.listForUser(req.user._id)
  }

  @ApiOperation({
    summary: 'Start a checkout',
    description:
      'Returns a Polar checkout URL for the chosen plan. An account that already pays gets a plan change preview instead, which you confirm through POST /billing/change-plan.',
  })
  @ApiResponse({
    status: 201,
    description: 'A checkout URL, or a plan change to confirm.',
    type: CheckoutResponseDTO,
  })
  @ApiResponse({
    status: 400,
    description: 'Unknown plan, or the plan cannot be subscribed to.',
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @Post('checkout')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiSecurity('x-api-key')
  async getCheckoutUrl(
    @Body() payload: CheckoutInputDTO,
    @Request() req: any,
  ): Promise<CheckoutResponseDTO> {
    return this.billingService.getCheckoutUrl({
      user: req.user,
      payload,
      req,
    })
  }

  @ApiOperation({
    summary: 'Switch to another plan',
    description:
      'Applies a plan change for an account that already has a paid subscription. Polar handles the proration.',
  })
  @ApiResponse({
    status: 201,
    description: 'The plan was switched.',
    type: ChangePlanResponseDTO,
  })
  @ApiResponse({
    status: 400,
    description: 'Unknown plan, or there is no subscription to change.',
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @Post('change-plan')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiSecurity('x-api-key')
  async changePlan(
    @Body() payload: ChangePlanInputDTO,
    @Request() req: any,
  ): Promise<ChangePlanResponseDTO> {
    return this.billingService.changePlan({
      user: req.user,
      payload,
    })
  }

  // Signed links from billing emails, reached through the web app.
  @ApiExcludeEndpoint()
  @Get('card')
  async cardUpdate(@Query('t') t: string, @Res() res: Response) {
    const url = await this.billingService.cardUpdateRedirect(t)
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
    return res.redirect(302, url)
  }

  @ApiExcludeEndpoint()
  @Get('checkout/resume')
  async checkoutResume(@Query('t') t: string, @Res() res: Response) {
    const url = await this.billingService.checkoutResumeRedirect(t)
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
    return res.redirect(302, url)
  }

  // Provider to server callback with a signed raw body, not something a
  // developer calls, so it stays out of the docs.
  @ApiExcludeEndpoint()
  @Post('webhook/polar')
  async handlePolarWebhook(@Body() data: any, @Request() req: any) {
    const payload = await this.billingService.validatePolarWebhookPayload(
      data,
      req.headers,
    )
    if (!payload) return

    // store the payload in the database
    await this.billingService.storePolarWebhookPayload(payload)

    const eventAt = new Date((payload as any).timestamp ?? Date.now())
    const event: any = payload.data
    const pastDue = () =>
      this.billingService.syncPastDue({
        polarSubscriptionId: event?.id,
        status: event?.status,
        pastDueAt: event?.past_due_at,
        eventAt: event?.modified_at ? new Date(event.modified_at) : eventAt,
      })

    // Every subscription event carries the full subscription, so each one is
    // applied the same way; switchPlan decides whether it is still current.
    const sync = (extra: Partial<PolarSubscriptionSync> = {}) =>
      this.billingService.switchPlan({
        userId: (event?.metadata?.userId ||
          event?.customer?.external_id) as string,
        newPlanPolarProductId: event?.product?.id ?? event?.product_id,
        currentPeriodStart: toDate(event?.current_period_start),
        currentPeriodEnd: toDate(event?.current_period_end),
        status: event?.status,
        subscriptionStartDate: toDate(event?.started_at ?? event?.created_at),
        endsAt: toDate(event?.ends_at),
        endedAt: toDate(event?.ended_at),
        // Polar's own change time; the delivery time when a payload lacks it.
        modifiedAt:
          toDate(event?.modified_at) ??
          ((payload as any).timestamp ? new Date((payload as any).timestamp) : undefined),
        amount: event?.amount,
        currency: event?.currency,
        recurringInterval: event?.recurring_interval,
        polarSubscriptionId: event?.id,
        polarCustomerId: event?.customer_id,
        cancelAtPeriodEnd: event?.cancel_at_period_end,
        ...extra,
      })

    // Handle Polar.sh webhook events
    switch (payload.type) {
      case 'subscription.created':
      case 'subscription.active':
      case 'subscription.updated':
      case 'subscription.uncanceled':
        console.log('polar webhook event', payload.type)
        console.log(payload)
        await sync()
        await pastDue()
        break

      case 'subscription.past_due':
        await pastDue()
        break

      // @ts-ignore
      case 'subscription.cancelled':
      // @ts-ignore
      case 'subscription.canceled':
        console.log('polar webhook event', payload.type)
        console.log(payload)
        // Usually a cancellation scheduled for the period end, which keeps
        // access; an immediate one carries an ended status and ends it here.
        const applied = await sync()
        if (applied?.ignored) break
        await this.billingService.recordChurnCause({
          polarSubscriptionId: event?.id,
          churnCause: await this.billingService.churnCause({
            polarSubscriptionId: event?.id,
            status: event?.status,
            cancelAtPeriodEnd: event?.cancel_at_period_end,
            endsAt: event?.ends_at ?? event?.ended_at,
            eventAt,
          }),
        })
        break

      // @ts-ignore
      case 'subscription.revoked':
        console.log('polar webhook event', payload.type)
        console.log(payload)
        // Access ends now, whatever status the payload carries.
        await sync({ revoked: true })
        break

      case 'checkout.updated':
        // Polar already sends these; they were being dropped here, which is
        // why isCompleted was never written.
        await this.billingService.syncCheckoutSessionStatus({
          checkoutSessionId: event?.id,
          status: event?.status,
        })
        break

      default:
        console.log('Unhandled polar event type:', payload.type)
        break
    }
  }
}
