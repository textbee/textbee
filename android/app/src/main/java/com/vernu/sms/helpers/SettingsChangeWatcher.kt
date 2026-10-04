package com.vernu.sms.helpers

import android.app.Activity
import android.app.Application
import android.os.Bundle
import java.util.concurrent.Executors

/** Catches changes made in system settings or permission dialogs when the user returns to the app. */
class SettingsChangeWatcher : Application.ActivityLifecycleCallbacks {
    private val executor = Executors.newSingleThreadExecutor()

    override fun onActivityResumed(activity: Activity) {
        val appContext = activity.applicationContext
        executor.execute {
            try {
                HeartbeatManager.triggerHeartbeatIfSettingsChanged(appContext)
            } catch (e: Exception) {
                android.util.Log.w("SettingsChangeWatcher", "Settings check failed: ${e.message}")
            }
        }
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
    override fun onActivityStarted(activity: Activity) {}
    override fun onActivityPaused(activity: Activity) {}
    override fun onActivityStopped(activity: Activity) {}
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
    override fun onActivityDestroyed(activity: Activity) {}
}
