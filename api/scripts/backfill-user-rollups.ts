/**
 * Fills in user.rollup and the milestones that predate it.
 *
 * This has to run once before notification targeting is trusted. Until an account
 * has a rollup, every condition touching stats.* resolves to unknown and fails
 * closed, so usage- and device-targeted notifications quietly reach nobody.
 * Milestones were added in September 2026 without a backfill, so every
 * milestones.* attribute currently reads false for older accounts, which would
 * exclude exactly the established accounts a campaign most wants.
 *
 *   pnpm backfill:rollups                 report what is missing, write nothing
 *   pnpm backfill:rollups --write         do it
 *   pnpm backfill:rollups --write --only-missing   skip accounts already computed
 *
 * Both passes are idempotent. Re-running is safe: the recompute derives
 * everything from source, and the milestone pass uses $min so a real earlier date
 * is never replaced by a later derived one.
 *
 * Deliberately does not boot AppModule. That would pull in Bull, so the script
 * would need Redis to count devices, and ScheduleModule, which registers the
 * cron jobs: a one-off script must not be able to fire the nightly sweep. Only
 * Mongoose and the collections the rollup reads are wired up here.
 */
// First, as in main.ts. This script deliberately avoids AppModule, which is also
// what loads the environment, so without this MONGO_URI is unset wherever it lives
// in api/.env and the script refuses to run before it can do anything.
import 'dotenv/config'
import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { MongooseModule } from '@nestjs/mongoose'
import { ApiKey, ApiKeySchema } from '../src/auth/schemas/api-key.schema'
import { Device, DeviceSchema } from '../src/gateway/schemas/device.schema'
import { SMS, SMSSchema } from '../src/gateway/schemas/sms.schema'
import {
  Subscription,
  SubscriptionSchema,
} from '../src/billing/schemas/subscription.schema'
import { User, UserSchema } from '../src/users/schemas/user.schema'
import { UserRollupService } from '../src/users/user-rollup.service'

@Module({
  imports: [
    MongooseModule.forRoot(process.env.MONGO_URI, { autoIndex: false }),
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Device.name, schema: DeviceSchema },
      { name: ApiKey.name, schema: ApiKeySchema },
      { name: SMS.name, schema: SMSSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
    ]),
  ],
  providers: [UserRollupService],
})
class BackfillModule {}

const WRITE = process.argv.includes('--write')
const ONLY_MISSING = process.argv.includes('--only-missing')

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set.')
    process.exit(1)
  }

  const app = await NestFactory.createApplicationContext(BackfillModule, {
    logger: ['error', 'warn'],
  })

  try {
    const rollups = app.get(UserRollupService)
    const missingBefore = await rollups.countMissing()

    console.log(`Accounts with no rollup yet: ${missingBefore}`)

    if (!WRITE) {
      console.log(
        '\nNothing written. Re-run with --write to backfill.\n' +
          'Until then, stats.* and usage-based targeting fail closed for the ' +
          'accounts counted above.',
      )
      return
    }

    // Milestones first. The rollup pass reads nothing from them, but a failure
    // partway should not leave the cheaper half undone.
    const startedMilestones = Date.now()
    const milestones = await rollups.backfillMilestones({ batchSize: 500 })
    console.log(
      `Milestones written for ${milestones} accounts in ${Date.now() - startedMilestones}ms`,
    )

    const startedRollups = Date.now()
    const processed = await rollups.recomputeAll({
      batchSize: 500,
      onlyMissing: ONLY_MISSING,
    })
    console.log(
      `Rollups computed for ${processed} accounts in ${Date.now() - startedRollups}ms`,
    )

    const missingAfter = await rollups.countMissing()
    console.log(`Accounts still with no rollup: ${missingAfter}`)

    if (missingAfter > 0) {
      // Worth shouting about: a non-zero count here means those accounts will
      // silently miss every usage-targeted notification.
      console.warn(
        `\n${missingAfter} accounts were not computed. Targeting on stats.* ` +
          'will fail closed for them. Re-run, and read the errors above before ' +
          'enabling anything usage-targeted.',
      )
      process.exitCode = 1
    }
  } finally {
    await app.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
