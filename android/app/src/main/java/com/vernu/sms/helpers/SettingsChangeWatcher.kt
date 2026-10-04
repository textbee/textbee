package com.vernu.sms.helpers

import android.app.Activity
import android.app.Application
import android.os.Bundle

/** Catches changes made in system settings or permission dialogs when the user returns to the app. */
class SettingsChangeWatcher : Application.ActivityLifecycleCallbacks {
    override fun onActivityResumed(activity: Activity) {
        try {
            HeartbeatManager.triggerHeartbeatIfSettingsChanged(activity)
        } catch (e: Exception) {
            android.util.Log.w("SettingsChangeWatcher", "Settings check failed: ${e.message}")
        }
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
    override fun onActivityStarted(activity: Activity) {}
    override fun onActivityPaused(activity: Activity) {}
    override fun onActivityStopped(activity: Activity) {}
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
    override fun onActivityDestroyed(activity: Activity) {}
}
