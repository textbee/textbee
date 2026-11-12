package com.vernu.sms.helpers

import android.Manifest
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.util.Log
import com.google.firebase.analytics.FirebaseAnalytics
import com.google.firebase.crashlytics.FirebaseCrashlytics
import com.vernu.sms.AppConstants
import com.vernu.sms.BuildConfig
import com.vernu.sms.TextbeeUtils

object Diagnostics {
    private const val TAG = "Diagnostics"

    @JvmStatic
    fun init(context: Context) {
        safely {
            val crashlytics = FirebaseCrashlytics.getInstance()
            crashlytics.setCustomKey("device_model", Build.MODEL)
            crashlytics.setCustomKey("app_version", BuildConfig.VERSION_NAME)
            crashlytics.setCustomKey("app_version_code", BuildConfig.VERSION_CODE)
        }
        identify(context)
        safely {
            FirebaseAnalytics.getInstance(context).setUserProperty("environment", BuildConfig.ENVIRONMENT)
        }
    }

    @JvmStatic
    fun identify(context: Context) = safely {
        val deviceId = SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_DEVICE_ID_KEY, ""
        ).orEmpty()
        val crashlytics = FirebaseCrashlytics.getInstance()
        crashlytics.setUserId(deviceId)
        crashlytics.setCustomKey("device_id", deviceId.ifEmpty { "not_registered" })
    }

    @JvmStatic
    fun setAnalyticsEnabled(context: Context, enabled: Boolean) = safely {
        FirebaseAnalytics.getInstance(context).setAnalyticsCollectionEnabled(enabled)
    }

    @JvmStatic
    fun breadcrumb(event: String, smsId: String? = null) = safely {
        FirebaseCrashlytics.getInstance().log(if (smsId == null) event else "$event [$smsId]")
    }

    @JvmStatic
    @JvmOverloads
    fun event(context: Context, name: String, params: Map<String, Any?> = emptyMap()) = safely {
        val bundle = Bundle()
        for ((key, value) in params) {
            when (value) {
                null -> {}
                is Int -> bundle.putLong(key, value.toLong())
                is Long -> bundle.putLong(key, value)
                else -> bundle.putString(key, value.toString())
            }
        }
        FirebaseAnalytics.getInstance(context).logEvent(name, bundle)
    }

    @JvmStatic
    fun screen(context: Context, name: String) = event(
        context,
        FirebaseAnalytics.Event.SCREEN_VIEW,
        mapOf(
            FirebaseAnalytics.Param.SCREEN_NAME to name,
            FirebaseAnalytics.Param.SCREEN_CLASS to name
        )
    )

    fun grantedPermissions(context: Context, permissions: Array<String>): Set<String> =
        permissions.filter { TextbeeUtils.isPermissionGranted(context, it) }.toSet()

    fun permissionResults(context: Context, results: Map<String, Boolean>, alreadyGranted: Set<String> = emptySet()) {
        for ((permission, granted) in results) {
            if (granted && permission in alreadyGranted) continue
            event(
                context,
                if (granted) "permission_granted" else "permission_denied",
                mapOf("permission" to permission.substringAfterLast('.').lowercase())
            )
        }
    }

    fun receiveToggled(context: Context, enabled: Boolean) {
        event(context, "receive_toggle_changed", mapOf("enabled" to enabled))
        refreshProperties(context)
    }

    fun onForeground(context: Context) {
        val app = context.applicationContext
        Thread {
            identify(app)
            checkBatteryExemption(app)
            refreshProperties(app)
        }.start()
    }

    fun refreshProperties(context: Context) = safely {
        val analytics = FirebaseAnalytics.getInstance(context)
        val simCount = if (TextbeeUtils.isPermissionGranted(context, Manifest.permission.READ_PHONE_STATE)) {
            TextbeeUtils.getAvailableSimSlots(context).size.toString()
        } else {
            "unknown"
        }
        analytics.setUserProperty("sim_count", simCount)
        analytics.setUserProperty(
            "receive_enabled",
            SharedPreferenceHelper.getSharedPreferenceBoolean(
                context, AppConstants.SHARED_PREFS_RECEIVE_SMS_ENABLED_KEY, false
            ).toString()
        )
    }

    fun checkBatteryExemption(context: Context) = safely {
        val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        if (power != null) {
            val current = if (power.isIgnoringBatteryOptimizations(context.packageName)) 1 else 0
            val last = SharedPreferenceHelper.getSharedPreferenceInt(
                context, AppConstants.SHARED_PREFS_LAST_BATTERY_EXEMPT_KEY, -1
            )
            if (current != last) {
                SharedPreferenceHelper.setSharedPreferenceInt(
                    context, AppConstants.SHARED_PREFS_LAST_BATTERY_EXEMPT_KEY, current
                )
                if (current == 1 && last == 0) event(context, "battery_optimization_exempted")
            }
            FirebaseAnalytics.getInstance(context)
                .setUserProperty("battery_exempt", (current == 1).toString())
        }
    }

    private inline fun safely(block: () -> Unit) {
        try {
            block()
        } catch (t: Throwable) {
            try {
                Log.w(TAG, "Skipped: ${t.javaClass.simpleName}")
            } catch (ignored: Throwable) {
            }
        }
    }
}
