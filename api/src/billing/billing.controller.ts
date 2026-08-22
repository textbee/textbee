import { Controller, Post, Body, Get, UseGuards, Request } from '@nestjs/common'
import { BillingService } from './billing.service'
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

  // Provider to server callback with a signed raw body, not something a
  // developer calls, so it stays out of the docs.
  @ApiExcludeEndpoint()
  @Post('webhook/polar')
  async handlePolarWebhook(@Body() data: any, @Request() req: any) {
    const payload = await this.billingService.validatePolarWebhookPayload(
      data,
      req.headers,
    )

    // store the payload in the database
    await this.billingService.storePolarWebhookPayload(payload)

    // Handle Polar.sh webhook events
    switch (payload.type) {
      case 'subscription.created':
      case 'subscription.active':
      case 'subscription.updated':
        console.log('polar webhook event', payload.type)
        console.log(payload)
        await this.billingService.switchPlan({
          userId: (payload.data?.metadata?.userId ||
            payload.data?.customer?.externalId) as string,
          newPlanPolarProductId: payload.data?.product?.id,
          currentPeriodStart: payload.data?.currentPeriodStart,
          currentPeriodEnd: payload.data?.currentPeriodEnd,
          status: payload.data?.status,
          subscriptionStartDate: payload.data?.createdAt,
          subscriptionEndDate: payload.data?.canceledAt,
          amount: payload.data?.amount,
          currency: payload.data?.currency,
          recurringInterval: payload.data?.recurringInterval,
          polarSubscriptionId: payload.data?.id,
          polarCustomerId: payload.data?.customerId,
          cancelAtPeriodEnd: payload.data?.cancelAtPeriodEnd,
        })
        break

      // @ts-ignore
      case 'subscription.cancelled':
      // @ts-ignore
      case 'subscription.canceled':
        console.log('polar webhook event', payload.type)
        console.log(payload)
        // Cancellation is SCHEDULED here: access continues until period end.
        // Record the intent without downgrading; the actual downgrade happens
        // on "subscription.revoked".
        await this.billingService.cancelSubscription({
          userId: (payload.data?.metadata?.userId ||
            payload.data?.customer?.externalId) as string,
          polarProductId: payload.data?.product?.id,
          cancelAtPeriodEnd: payload.data?.cancelAtPeriodEnd,
          currentPeriodEnd: payload.data?.currentPeriodEnd,
          status: payload.data?.status,
        })
        break

      // @ts-ignore
      case 'subscription.revoked':
        console.log('polar webhook event', payload.type)
        console.log(payload)
        // Access should actually end now, so perform the real downgrade.
        await this.billingService.revokeSubscription({
          userId: (payload.data?.metadata?.userId ||
            payload.data?.customer?.externalId) as string,
          polarProductId: payload.data?.product?.id,
        })
        break

      case 'checkout.updated':
        // Polar already sends these; they were being dropped here, which is
        // why isCompleted was never written.
        await this.billingService.syncCheckoutSessionStatus({
          checkoutSessionId: payload.data?.id,
          status: payload.data?.status,
        })
        break

      default:
        console.log('Unhandled polar event type:', payload.type)
        break
    }
  }
}
