import { Controller, Post, Body, Get, UseGuards, Request } from '@nestjs/common'
import { BillingService } from './billing.service'
import { AuthGuard } from 'src/auth/guards/auth.guard'
import { ApiTags, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger'
import {
  ChangePlanInputDTO,
  ChangePlanResponseDTO,
  CheckoutInputDTO,
  CheckoutResponseDTO,
  PlansResponseDTO,
} from './billing.dto'
import { BillingNotificationsService } from './billing-notifications.service'

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(
    private billingService: BillingService,
    private billingNotifications: BillingNotificationsService,
  ) {}

  @Get('plans')
  async getPlans(): Promise<PlansResponseDTO> {
    return this.billingService.getPlans()
  }

  @Get('current-subscription')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiSecurity('x-api-key')
  async getCurrentSubscription(@Request() req: any) {
    return this.billingService.getCurrentSubscription(req.user)
  }

  @Get('notifications')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiSecurity('x-api-key')
  async listNotifications(@Request() req: any) {
    return this.billingNotifications.listForUser(req.user._id)
  }

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

  @Post('webhook/polar')
  async handlePolarWebhook(@Body() data: any, @Request() req: any) {
    const payload = await this.billingService.validatePolarWebhookPayload(
      data,
      req.headers,
    )

    // store the payload in the database
    await this.billingService.storePolarWebhookPayload(payload)

    // Every subscription event has to name one of our users. Passing an
    // unresolved id through would reach `new Types.ObjectId(undefined)`, which
    // mints a fresh random id rather than throwing, writing a subscription row
    // against a user that does not exist.
    if (payload.type?.startsWith('subscription.')) {
      if (!this.billingService.resolvePolarUserId(payload.data)) {
        console.error(
          `polar webhook ${payload.type} carries no resolvable user, skipping`,
          { subscriptionId: payload.data?.id },
        )
        return
      }
    }

    // Handle Polar.sh webhook events
    switch (payload.type) {
      case 'subscription.created':
      case 'subscription.active':
      case 'subscription.updated':
        console.log('polar webhook event', payload.type)
        console.log(payload)
        await this.billingService.switchPlan({
          userId: this.billingService.resolvePolarUserId(payload.data),
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
        // Cancellation is SCHEDULED here — access continues until period end.
        // Record the intent without downgrading; the actual downgrade happens
        // on "subscription.revoked".
        await this.billingService.cancelSubscription({
          userId: this.billingService.resolvePolarUserId(payload.data),
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
        // Access should actually end now — perform the real downgrade.
        await this.billingService.revokeSubscription({
          userId: this.billingService.resolvePolarUserId(payload.data),
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
