package com.vernu.sms.helpers

import android.content.Context
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.vernu.sms.AppConstants

// A whole-number setting with the app's own default and allowed range
class IntSetting(val default: Int, val min: Int, val max: Int) {
    fun clamp(value: Int): Int = value.coerceIn(min, max)
}

// One reply's config, read key by key. A key with a wrong type counts as missing.
data class ParsedConfig(
    // Null keeps the stored value
    val recoveryPollEnabled: Boolean? = null,
    val directUploadEnabled: Boolean? = null,
    val updateNotificationsEnabled: Boolean? = null,
    val latestVersionCode: Int? = null,
    val latestVersionName: String? = null,
    // Missing means off
    val pullEnabled: Boolean = false,
    val partReportsEnabled: Boolean = false,
    // Missing means the built-in default
    val periodicJobMinutes: Int = DeviceConfig.PERIODIC_JOB_MINUTES.default,
    val deviceLogMaxEntries: Int = DeviceConfig.DEVICE_LOG_MAX_ENTRIES.default,
    val analyticsEnabled: Boolean = DeviceConfig.ANALYTICS_DEFAULT,
    val claimMinGapSeconds: Int = DeviceConfig.CLAIM_MIN_GAP_SECONDS.default,
    val directUploadRetryDelaySeconds: Int = DeviceConfig.DIRECT_UPLOAD_RETRY_DELAY_SECONDS.default,
    val sendingMarkerYoungMinutes: Int = DeviceConfig.SENDING_MARKER_YOUNG_MINUTES.default,
    // Missing means no notice
    val notice: AppNotice? = null,
)

// Settings the server sends on every heartbeat and claim reply. Until the first reply arrives
// every switch reads as off, so a fresh install behaves like the old app.
object DeviceConfig {
    val PERIODIC_JOB_MINUTES = IntSetting(30, 15, 240)
    val DEVICE_LOG_MAX_ENTRIES = IntSetting(10_000, 500, 20_000)
    val CLAIM_MIN_GAP_SECONDS = IntSetting(30, 10, 300)
    val DIRECT_UPLOAD_RETRY_DELAY_SECONDS = IntSetting(30, 30, 3600)
    val SENDING_MARKER_YOUNG_MINUTES = IntSetting(5, 3, 60)
    const val ANALYTICS_DEFAULT = true
    const val PART_REPORTS_DEFAULT = false

    // Last value given to Firebase in this process, guarded by analyticsLock
    private val analyticsLock = Any()
    private var appliedAnalytics: Boolean? = null

    // Reads the config of a heartbeat or claim reply and stores it
    fun read(context: Context, config: JsonElement?) {
        val parsed = parse(config)
        save(context, parsed)
        DeviceLog.useMaxEntries(parsed.deviceLogMaxEntries)
        synchronized(analyticsLock) {
            if (parsed.analyticsEnabled != appliedAnalytics) {
                Diagnostics.setAnalyticsEnabled(context, parsed.analyticsEnabled)
                appliedAnalytics = parsed.analyticsEnabled
            }
        }
    }

    // No config, or one that is not an object, reads as an empty object
    fun parse(config: JsonElement?): ParsedConfig {
        val obj = config?.takeIf { it.isJsonObject }?.asJsonObject ?: JsonObject()
        val tuning = obj.get("tuning")?.takeIf { it.isJsonObject }?.asJsonObject ?: JsonObject()
        return ParsedConfig(
            recoveryPollEnabled = boolOf(obj, "recoveryPollEnabled"),
            directUploadEnabled = boolOf(obj, "directUploadEnabled"),
            updateNotificationsEnabled = boolOf(obj, "updateNotificationsEnabled"),
            latestVersionCode = intOf(obj, "latestVersionCode"),
            latestVersionName = stringOf(obj, "latestVersionName"),
            pullEnabled = boolOf(obj, "pullEnabled") ?: false,
            partReportsEnabled = boolOf(obj, "partReportsEnabled") ?: PART_REPORTS_DEFAULT,
            periodicJobMinutes = clampedIntOf(obj, "periodicJobMinutes", PERIODIC_JOB_MINUTES),
            deviceLogMaxEntries = clampedIntOf(obj, "deviceLogMaxEntries", DEVICE_LOG_MAX_ENTRIES),
            analyticsEnabled = boolOf(obj, "analyticsEnabled") ?: ANALYTICS_DEFAULT,
            claimMinGapSeconds = clampedIntOf(tuning, "claimMinGapSeconds", CLAIM_MIN_GAP_SECONDS),
            directUploadRetryDelaySeconds = clampedIntOf(tuning, "directUploadRetryDelaySeconds", DIRECT_UPLOAD_RETRY_DELAY_SECONDS),
            sendingMarkerYoungMinutes = clampedIntOf(tuning, "sendingMarkerYoungMinutes", SENDING_MARKER_YOUNG_MINUTES),
            notice = Notices.parse(obj.get("notice")),
        )
    }

    fun boolOf(obj: JsonObject, key: String): Boolean? {
        val value = obj.get(key)
        return if (value != null && value.isJsonPrimitive && value.asJsonPrimitive.isBoolean) value.asBoolean else null
    }

    fun stringOf(obj: JsonObject, key: String): String? {
        val value = obj.get(key)
        return if (value != null && value.isJsonPrimitive && value.asJsonPrimitive.isString) value.asString else null
    }

    // Only a JSON number that is whole and fits an Int
    fun intOf(obj: JsonObject, key: String): Int? {
        val value = obj.get(key)
        if (value == null || !value.isJsonPrimitive || !value.asJsonPrimitive.isNumber) return null
        return try {
            // Throws for a fraction or a value outside the Int range
            value.asBigDecimal.intValueExact()
        } catch (e: ArithmeticException) {
            null
        } catch (e: NumberFormatException) {
            null
        }
    }

    private fun clampedIntOf(obj: JsonObject, key: String, setting: IntSetting): Int =
        intOf(obj, key)?.let { setting.clamp(it) } ?: setting.default

    private fun save(context: Context, config: ParsedConfig) {
        config.recoveryPollEnabled?.let {
            SharedPreferenceHelper.setSharedPreferenceBoolean(
                context, AppConstants.SHARED_PREFS_CONFIG_RECOVERY_POLL_KEY, it
            )
        }
        setPullEnabled(context, config.pullEnabled)
        SharedPreferenceHelper.setSharedPreferenceBoolean(
            context, AppConstants.SHARED_PREFS_CONFIG_PART_REPORTS_KEY, config.partReportsEnabled
        )
        config.directUploadEnabled?.let {
            SharedPreferenceHelper.setSharedPreferenceBoolean(
                context, AppConstants.SHARED_PREFS_CONFIG_DIRECT_UPLOAD_KEY, it
            )
        }
        config.updateNotificationsEnabled?.let {
            SharedPreferenceHelper.setSharedPreferenceBoolean(
                context, AppConstants.SHARED_PREFS_CONFIG_UPDATE_NOTIFICATIONS_KEY, it
            )
        }
        config.latestVersionCode?.let {
            SharedPreferenceHelper.setSharedPreferenceInt(
                context, AppConstants.SHARED_PREFS_CONFIG_LATEST_VERSION_CODE_KEY, it
            )
        }
        config.latestVersionName?.let {
            SharedPreferenceHelper.setSharedPreferenceString(
                context, AppConstants.SHARED_PREFS_CONFIG_LATEST_VERSION_NAME_KEY, it
            )
        }
        SharedPreferenceHelper.setSharedPreferenceInt(
            context, AppConstants.SHARED_PREFS_CONFIG_PERIODIC_JOB_MINUTES_KEY, config.periodicJobMinutes
        )
        SharedPreferenceHelper.setSharedPreferenceInt(
            context, AppConstants.SHARED_PREFS_CONFIG_DEVICE_LOG_MAX_ENTRIES_KEY, config.deviceLogMaxEntries
        )
        SharedPreferenceHelper.setSharedPreferenceInt(
            context, AppConstants.SHARED_PREFS_CONFIG_CLAIM_MIN_GAP_SECONDS_KEY, config.claimMinGapSeconds
        )
        SharedPreferenceHelper.setSharedPreferenceInt(
            context, AppConstants.SHARED_PREFS_CONFIG_DIRECT_UPLOAD_RETRY_DELAY_SECONDS_KEY, config.directUploadRetryDelaySeconds
        )
        SharedPreferenceHelper.setSharedPreferenceInt(
            context, AppConstants.SHARED_PREFS_CONFIG_SENDING_MARKER_YOUNG_MINUTES_KEY, config.sendingMarkerYoungMinutes
        )
        Notices.save(context, config.notice)
    }

    fun recoveryPollEnabled(context: Context): Boolean =
        SharedPreferenceHelper.getSharedPreferenceBoolean(
            context, AppConstants.SHARED_PREFS_CONFIG_RECOVERY_POLL_KEY, false
        )

    // On: messages are claimed with PullClient and RecoveryPoll stays idle
    fun pullEnabled(context: Context): Boolean =
        SharedPreferenceHelper.getSharedPreferenceBoolean(
            context, AppConstants.SHARED_PREFS_CONFIG_PULL_KEY, false
        )

    fun setPullEnabled(context: Context, enabled: Boolean) =
        SharedPreferenceHelper.setSharedPreferenceBoolean(
            context, AppConstants.SHARED_PREFS_CONFIG_PULL_KEY, enabled
        )

    fun directUploadEnabled(context: Context): Boolean =
        SharedPreferenceHelper.getSharedPreferenceBoolean(
            context, AppConstants.SHARED_PREFS_CONFIG_DIRECT_UPLOAD_KEY, false
        )

    fun partReportsEnabled(context: Context): Boolean =
        SharedPreferenceHelper.getSharedPreferenceBoolean(
            context, AppConstants.SHARED_PREFS_CONFIG_PART_REPORTS_KEY, PART_REPORTS_DEFAULT
        )

    fun updateNotificationsEnabled(context: Context): Boolean =
        SharedPreferenceHelper.getSharedPreferenceBoolean(
            context, AppConstants.SHARED_PREFS_CONFIG_UPDATE_NOTIFICATIONS_KEY, false
        )

    fun latestVersionCode(context: Context): Int =
        SharedPreferenceHelper.getSharedPreferenceInt(
            context, AppConstants.SHARED_PREFS_CONFIG_LATEST_VERSION_CODE_KEY, 0
        )

    fun latestVersionName(context: Context): String? =
        SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_CONFIG_LATEST_VERSION_NAME_KEY, null
        )

    fun periodicJobMinutes(context: Context): Int =
        storedInt(context, AppConstants.SHARED_PREFS_CONFIG_PERIODIC_JOB_MINUTES_KEY, PERIODIC_JOB_MINUTES)

    fun deviceLogMaxEntries(context: Context): Int =
        storedInt(context, AppConstants.SHARED_PREFS_CONFIG_DEVICE_LOG_MAX_ENTRIES_KEY, DEVICE_LOG_MAX_ENTRIES)

    fun claimMinGapSeconds(context: Context): Int =
        storedInt(context, AppConstants.SHARED_PREFS_CONFIG_CLAIM_MIN_GAP_SECONDS_KEY, CLAIM_MIN_GAP_SECONDS)

    fun directUploadRetryDelaySeconds(context: Context): Int =
        storedInt(context, AppConstants.SHARED_PREFS_CONFIG_DIRECT_UPLOAD_RETRY_DELAY_SECONDS_KEY, DIRECT_UPLOAD_RETRY_DELAY_SECONDS)

    fun sendingMarkerYoungMinutes(context: Context): Int =
        storedInt(context, AppConstants.SHARED_PREFS_CONFIG_SENDING_MARKER_YOUNG_MINUTES_KEY, SENDING_MARKER_YOUNG_MINUTES)

    private fun storedInt(context: Context, key: String, setting: IntSetting): Int =
        setting.clamp(SharedPreferenceHelper.getSharedPreferenceInt(context, key, setting.default))
}
