# Android Kotlin/Compose Migration

## Overview

textbee Android is mid-migration from a Java/XML legacy codebase to Kotlin + Jetpack Compose. The new UI runs in parallel with the legacy UI — users can switch between them via Settings. The SplashActivity routes to the appropriate UI on launch.

---

## What's Done

### Theme
| File | Notes |
|---|---|
| `ui/theme/Color.kt` | Brand orange (`#C4620A`), full light/dark palette |
| `ui/theme/Theme.kt` | `TextbeeTheme` wrapper, `dynamicColor = false` to preserve brand color |
| `ui/theme/Type.kt` | Material3 typography scale |

### Infrastructure
| File | Notes |
|---|---|
| `ApiManagerKt.kt` | Kotlin singleton Retrofit client, mirrors `ApiManager.java` |
| `services/GatewayApiServiceKt.kt` | Kotlin suspend-function Retrofit interface (all new UI endpoints) |
| `dtos/GatewayStatsResponse.kt` | Nullable stats DTO |
| `dtos/SubscriptionResponse.kt` | Plan, usage, renewal DTO |
| `dtos/UserProfileResponse.kt` | `name`, `email` from `/auth/who-am-i` |
| `dtos/MessagesResponse.kt` | `SmsMessage`, `PaginationMeta`, `SendSmsRequest` |

### UI — Onboarding
| File | Notes |
|---|---|
| `ui/onboarding/OnboardingActivity.kt` | Compose NavHost shell |
| `ui/onboarding/OnboardingViewModel.kt` | Registration state + API calls |
| `ui/onboarding/screens/WelcomeScreen.kt` | Get Started / I have a Device ID |
| `ui/onboarding/screens/CredentialsScreen.kt` | QR scan + manual API key entry |
| `ui/onboarding/screens/DeviceSetupScreen.kt` | Register or reconnect device |
| `ui/onboarding/screens/PermissionsScreen.kt` | SMS + phone state permissions |
| `ui/onboarding/screens/SetupCompleteScreen.kt` | Success + navigate to dashboard |
| `ui/onboarding/screens/OnboardingComponents.kt` | Shared step indicator, etc. |

### UI — Main App
| File | Notes |
|---|---|
| `ui/splash/SplashActivity.kt` | Routes to legacy/onboarding/main based on SharedPrefs |
| `ui/main/NewMainActivity.kt` | Bottom nav (Dashboard / Messages / Settings) + compose + filters routes |
| `ui/dashboard/DashboardScreen.kt` | Device card, stats, subscription, quick actions |
| `ui/dashboard/DashboardViewModel.kt` | Stats, subscription, user profile, gateway toggle |
| `ui/messages/MessagesScreen.kt` | Filter chips, message list, detail dialog, FAB |
| `ui/messages/MessagesViewModel.kt` | Paginated message fetch, filter state |
| `ui/messages/ComposeScreen.kt` | Multi-recipient input, message field, send with snackbar feedback |
| `ui/messages/ComposeViewModel.kt` | Send SMS, error body parsing, success/error state |
| `ui/settings/SettingsScreen.kt` | Account, Gateway, SMS, Legal, System, UI sections |
| `ui/settings/SettingsViewModel.kt` | Device name save, gateway toggle, SIM picker |

### UI — Settings (Phase 3) ✅
| File | Notes |
|---|---|
| `ui/settings/SMSFilterScreen.kt` | Full Compose SMS filter screen: enable switch, allow/block mode chips, rule list with FAB, add/edit dialog |
| `ui/settings/SMSFilterViewModel.kt` | `AndroidViewModel` — loads/saves `FilterConfig` via StateFlow; deep-copies config on each mutation |

`SMSFilterActivity.java` is still present for the legacy UI. The new UI navigates to the `"filters"` composable route inside `NewMainActivity`; bottom bar is hidden on both `"compose"` and `"filters"` routes.

### Data Layer — Kotlin Stubs (Phase 4) ✅

**Room DB (block-commented — feature not yet enabled):**
| File | Notes |
|---|---|
| `database/local/Sms.kt` | Replaces `SMS.java`; `@Entity` data class inside `/* */` block comment |
| `database/local/SmsDao.kt` | Replaces `SMSDao.java`; `@Dao` interface with suspend funs, block-commented |
| `database/local/AppDatabase.kt` | Replaces `AppDatabase.java`; singleton with companion object, block-commented |
| `database/local/DateConverter.kt` | Replaces `DateConverter.java`; `object` with `@TypeConverter`, block-commented |

**DTOs (all Java originals deleted):**
| File | Notes |
|---|---|
| `dtos/RegisterDeviceInputDTO.kt` | `class` with `var`; `@get:JvmName("isEnabled")` so Java/Kotlin callers get `isEnabled()` not `getEnabled()` |
| `dtos/RegisterDeviceResponseDTO.kt` | Regular `class` with `@JvmField var` — `MainActivity.java` accesses `.data`/`.error` as direct fields |
| `dtos/SMSDTO.kt` | Regular `class`; `message: String = ""` to avoid null default |
| `dtos/HeartbeatInputDTO.kt` | `var isCharging: Boolean?` (nullable) — generates `getIsCharging()`/`setIsCharging()` matching Java non-standard getter name |
| `dtos/HeartbeatResponseDTO.kt` | `@JvmField var` on all properties — `HeartbeatHelper` accesses fields directly (`.fcmTokenUpdated`) |
| `dtos/SimInfoDTO.kt` | `subscriptionId: Int = 0` (was primitive in Java) |
| `dtos/SimInfoCollectionDTO.kt` | `sims: MutableList<SimInfoDTO>? = null` |
| `dtos/SMSForwardResponseDTO.kt` | Empty class body |

### Helpers & Models (Phase 5) ✅

All helpers are Kotlin `object` with `@JvmStatic` on every public method — at the time of porting, Java workers/receivers called them; those callers were ported in Phase 6.

| File | Notes |
|---|---|
| `helpers/SharedPreferenceHelper.kt` | Replaces `SharedPreferenceHelper.java`; `PREF_FILE = "PREF"`, 7 methods |
| `helpers/SMSFilterHelper.kt` | Replaces `SMSFilterHelper.java`; nested `FilterMode` enum + `FilterConfig` class; Gson-compatible field names |
| `helpers/SMSHelper.kt` | Replaces `SMSHelper.java`; `FLAG_MUTABLE` on API >= S; private PendingIntent helpers |
| `helpers/HeartbeatHelper.kt` | Replaces `HeartbeatHelper.java`; `CountDownLatch` FCM token wait, `@Suppress("DEPRECATION")` for legacy network API |
| `helpers/HeartbeatManager.kt` | Replaces `HeartbeatManager.java`; `PeriodicWorkRequest.Builder(HeartbeatWorker::class.java, ...)` |
| `models/SMSFilterRule.kt` | Replaces `SMSFilterRule.java`; `@JvmOverloads constructor` for Java callers; nested `MatchType` + `FilterTarget` enums |
| `models/SMSPayload.kt` | Replaces `SMSPayload.java`; keeps legacy `receivers` + `smsBody` fields |

---

## What's Left (Java / Legacy)

### Core App
| File | Priority | Notes |
|---|---|---|
| `AppConstants.java` | Low | Constants only — convert when touching other things |
| `SMSGatewayApplication.java` | Low | Application class, minimal logic |
| `TextbeeUtils.java` | Medium | Heavily used utility; convert once helpers are stable |
| `ApiManager.java` | Low | Still used by legacy UI; delete after legacy removal |

### Helpers
| File | Priority | Notes |
|---|---|---|
| `helpers/VersionTracker.java` | Low | Update check logic — left for later |

### Services
| File | Priority | Notes |
|---|---|---|
| `services/GatewayApiService.java` | High | Java Retrofit interface — delete after legacy UI removed |

---

## Migration Roadmap

### Phase 3 — SMS Filter Screen ✅ Complete
Ported `SMSFilterActivity.java` to `SMSFilterScreen.kt` (Compose). Integrated as a nested `"filters"` route inside `NewMainActivity`. Legacy `SMSFilterActivity.java` unchanged — still reachable from legacy UI.

---

### Phase 4 — Data Layer ✅ Complete
All DTOs ported to Kotlin; Java originals deleted. Room DB ported to Kotlin stubs with all logic still inside `/* */` block comments (feature remains disabled).

---

### Phase 5 — Helpers & Utilities ✅ Complete
All helpers and models ported to Kotlin `object`s with `@JvmStatic`. Java originals deleted. Java callers (workers, receivers — Phase 6) continue to work unchanged via `@JvmStatic` interop.

---

### Phase 6 — Background Services & Receivers ✅ Complete
All workers, receivers, and services ported to Kotlin; Java originals deleted.

| File | Notes |
|---|---|
| `receivers/BootCompletedReceiver.kt` | Restarts sticky notification + schedules heartbeat on boot |
| `receivers/SMSBroadcastReceiver.kt` | Deduplication fingerprint cache; Kotlin property access on `SMSDTO` |
| `receivers/SMSStatusReceiver.kt` | `setFailed()` private helper avoids `errorMessage` property shadowing |
| `workers/HeartbeatWorker.kt` | Simple `Worker` subclass; delegates to `HeartbeatHelper` |
| `workers/SmsSendWorker.kt` | SIM resolution priority chain; `Thread.sleep` rate limiting |
| `workers/SMSReceivedWorker.kt` | Fingerprint-based unique work name for deduplication |
| `workers/SMSStatusUpdateWorker.kt` | Exponential backoff, max 5 retries |
| `services/StickyNotificationService.kt` | Broad `Exception` catch replaces API-31-only `ForegroundServiceStartNotAllowedException` |
| `services/FCMService.kt` | Handles `heartbeat_check` type + SMS payload dispatch |

**Sticky notification fix**: Added service restart to `DashboardViewModel.loadLocalState()` — on every app launch, if gateway + sticky notification are enabled, the service is restarted. This matches legacy `MainActivity` behaviour and fixes the notification disappearing after Android kills the service on newer OS versions.

---

### Phase 7 - Legacy UI Removal ✅ Complete
Done in 2.10: the classic screen, its filter screen and their layouts are deleted. `.activities.MainActivity` is now an alias of `SplashActivity`, so old shortcuts still open the app.

---

## Key Constraints to Keep in Mind

- **`dynamicColor = false`** in `Theme.kt` — Material You overrides the brand orange on Android 12+; must stay false
- **`primaryContainer` avoided** in TopAppBar/nav — causes orange-on-orange in dark mode; use `surface` for bars, `surfaceVariant` for nav indicator
- **Java/Kotlin interop** — Only `ApiManager.java`, `TextbeeUtils.java`, legacy activities, and `GatewayApiService.java` remain Java; all others are Kotlin
- **WorkManager workers** — kept as `Worker` subclass (not `CoroutineWorker`) to avoid adding `work-runtime-ktx`; straightforward conversion candidate in a future cleanup
- **Sticky notification on Android 12+** — `ForegroundServiceStartNotAllowedException` is caught broadly; `DashboardViewModel` restarts service on every launch to compensate for OS killing it in the background
- **Room DB** — all DB logic remains commented out; do not uncomment until the feature is explicitly re-enabled
- **`@JvmField`** on `HeartbeatResponseDTO` — `HeartbeatHelper.kt` accesses `.fcmTokenUpdated`/`.name` as fields; `@JvmField` keeps direct field access instead of generating getters
- **`@JvmField`** on `RegisterDeviceResponseDTO` — `MainActivity.java` (legacy, still Java) accesses `.data`/`.error` as direct fields; remove once Phase 7 deletes the legacy activity
- **`@JvmOverloads`** on `SMSFilterRule` — generates no-arg and partial constructors needed by Gson deserialization of persisted filter config JSON
- **`@get:JvmName("isEnabled")`** on `RegisterDeviceInputDTO.enabled` and `@get:JvmName("isCaseSensitive")`on `SMSFilterRule.caseSensitive` — renames generated getter to match Java boolean convention; `MainActivity.java` and `SMSFilterActivity.java` use `isEnabled()`/`isCaseSensitive()`
