// Pure onboarding step definitions and completion logic for the Get Started
// card. Kept free of React so the checkDone rules are unit-testable.

export type StatsShape = {
  totalApiKeyCount?: number
  totalDeviceCount?: number
  totalSentSMSCount?: number
}

export type UserShape = {
  email?: string
  emailVerifiedAt?: string | Date | null
  createdAt?: string | Date
  onboarding?: {
    completedAt?: string | Date | null
    currentStepId?: string
    skippedStepIds?: string[]
  }
}

export type SubShape = { plan?: { name?: string } } | null

export type StepDef = {
  id: string
  label: string
  description: string
  // Shown instead of `description` when the step is already done and the user
  // has reopened it, so the copy does not tell them to do what they have done.
  doneDescription?: string
  optional: boolean
  // Shown as a small chip; sets expectations and reduces abandonment.
  timeEstimate: string
  checkDone: (
    user: UserShape | undefined,
    stats: StatsShape | undefined,
    sub: SubShape,
    skipped: string[]
  ) => boolean
}

export const STEPS: StepDef[] = [
  {
    id: 'verify_email',
    label: 'Verify your email',
    description: 'Required before you can send SMS.',
    optional: false,
    timeEstimate: '~1 min',
    checkDone: (user) => !!user?.emailVerifiedAt,
  },
  {
    id: 'download_app',
    label: 'Download the Android app',
    description: 'Install textbee on the Android phone that will send your SMS.',
    doneDescription: 'Installed. Download it again if you are setting up another phone.',
    optional: true,
    timeEstimate: '~1 min',
    checkDone: (_u, stats, _s, skipped) =>
      (stats?.totalDeviceCount ?? 0) > 0 || skipped.includes('download_app'),
  },
  {
    id: 'api_key',
    label: 'Generate an API key',
    description: 'Your key connects the app and authenticates API calls.',
    doneDescription:
      'You already have a key. Generate another if you need to replace it or set up a second device.',
    optional: false,
    timeEstimate: '~10 sec',
    checkDone: (_u, stats) => (stats?.totalApiKeyCount ?? 0) > 0,
  },
  {
    id: 'register_device',
    label: 'Register your device',
    description:
      'Turn your phone into your SMS gateway: scan the QR code below with the textbee app, then allow the SMS permission when the app asks.',
    doneDescription: 'Device registered. Register another the same way.',
    optional: false,
    timeEstimate: '~1 min',
    checkDone: (_u, stats) => (stats?.totalDeviceCount ?? 0) > 0,
  },
  {
    id: 'choose_plan',
    label: 'Choose your plan',
    description: 'Pick the plan that fits your usage.',
    doneDescription: 'Your plan is set. Change it any time.',
    optional: true,
    timeEstimate: '~30 sec',
    checkDone: (_u, _stats, sub, skipped) =>
      (sub?.plan?.name && sub.plan.name.toLowerCase() !== 'free') ||
      skipped.includes('choose_plan'),
  },
  {
    id: 'first_message',
    label: 'Send your first message',
    description: 'The moment it all works: send an SMS from the dashboard.',
    doneDescription: 'You have sent your first message. Send another any time.',
    optional: false,
    timeEstimate: '~30 sec',
    checkDone: (_u, stats) => (stats?.totalSentSMSCount ?? 0) > 0,
  },
]

export type StepState = StepDef & { isDone: boolean }

export function computeStepStates(
  user: UserShape | undefined,
  stats: StatsShape | undefined,
  sub: SubShape,
  skipped: string[]
): StepState[] {
  return STEPS.map((s) => ({
    ...s,
    isDone: s.checkDone(user, stats, sub, skipped),
  }))
}
