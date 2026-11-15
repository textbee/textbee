package com.vernu.sms.helpers

import android.content.Context
import android.os.Build
import android.os.Bundle
import android.util.Log
import com.google.firebase.analytics.FirebaseAnalytics
import com.google.firebase.crashlytics.FirebaseCrashlytics
import com.vernu.sms.AppConstants
import com.vernu.sms.BuildConfig

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

    // Screen views are the only analytics event the app logs
    @JvmStatic
    fun screen(context: Context, name: String) = safely {
        val params = Bundle().apply {
            putString(FirebaseAnalytics.Param.SCREEN_NAME, name)
            putString(FirebaseAnalytics.Param.SCREEN_CLASS, name)
        }
        FirebaseAnalytics.getInstance(context).logEvent(FirebaseAnalytics.Event.SCREEN_VIEW, params)
    }

    fun onForeground(context: Context) {
        val app = context.applicationContext
        Thread { identify(app) }.start()
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
