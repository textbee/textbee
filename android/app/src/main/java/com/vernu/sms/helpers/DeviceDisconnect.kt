package com.vernu.sms.helpers

import android.content.Context
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessaging
import com.vernu.sms.ApiManagerKt
import com.vernu.sms.AppConstants
import com.vernu.sms.TextbeeUtils
import com.vernu.sms.workers.SmsSendWorker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

// Removes this phone's connection; user settings, the log and the resend guards stay
object DeviceDisconnect {
    private const val TAG = "DeviceDisconnect"

    // Every server config value, including keys of earlier builds
    private const val CONFIG_PREFIX = "CONFIG_"

    // Cleared first and committed, so the send guards hold if the process dies halfway
    val REGISTRATION_KEYS = setOf(
        AppConstants.SHARED_PREFS_DEVICE_ID_KEY,
        AppConstants.SHARED_PREFS_API_KEY_KEY,
    )

    private val CLEARED_KEYS = REGISTRATION_KEYS + setOf(
        AppConstants.SHARED_PREFS_GATEWAY_ENABLED_KEY,
        AppConstants.SHARED_PREFS_DEVICE_NAME_KEY,
        AppConstants.SHARED_PREFS_ACCOUNT_EMAIL_KEY,
        AppConstants.SHARED_PREFS_LAST_HEARTBEAT_MS_KEY,
        // A later connection, maybe to another account, must not forward SMS without a new choice
        AppConstants.SHARED_PREFS_RECEIVE_SMS_ENABLED_KEY,
        // Pull and recovery poll timers
        AppConstants.SHARED_PREFS_PULL_LAST_CLAIM_MS_KEY,
        AppConstants.SHARED_PREFS_PULL_NEXT_CLAIM_MS_KEY,
        AppConstants.SHARED_PREFS_PULL_MORE_KEY,
        AppConstants.SHARED_PREFS_PULL_BOOKED_UNTIL_MS_KEY,
        AppConstants.SHARED_PREFS_LAST_RECOVERY_POLL_MS_KEY,
        AppConstants.SHARED_PREFS_LAST_PUSH_RECEIVED_AT_MS_KEY,
        // The queued sends are cancelled, so their booked slots are free
        AppConstants.SHARED_PREFS_NEXT_SEND_SLOT_MS_KEY,
        AppConstants.SHARED_PREFS_LAST_SEND_RESERVED_AT_MS_KEY,
        AppConstants.SHARED_PREFS_PREFERRED_SIM_SLOT_KEY,
        AppConstants.SHARED_PREFS_PREFERRED_SIM_KEY,
        AppConstants.SHARED_PREFS_APPLIED_PERIOD_MINUTES_KEY,
        AppConstants.SHARED_PREFS_LAST_REPORTED_SETTINGS_KEY,
        AppConstants.SHARED_PREFS_LAST_TRIGGERED_SETTINGS_KEY,
        AppConstants.SHARED_PREFS_LAST_TRIGGERED_SETTINGS_AT_KEY,
        AppConstants.SHARED_PREFS_NOTICE_CLOSED_IDS_KEY,
        AppConstants.SHARED_PREFS_NOTICE_NOTIFIED_IDS_KEY,
        AppConstants.SHARED_PREFS_API_KEY_REJECTED_AT_KEY,
        AppConstants.SHARED_PREFS_LAST_API_KEY_NOTIFIED_AT_KEY,
    )

    // One try, so a phone without a connection still clears itself in a few seconds
    const val SERVER_CALL_LIMIT_MS = 5_000L

    // Outlives the screen, so a rotation during the call cannot skip the step after it
    private val scope by lazy { CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate) }

    /** Runs [runWithServer], then [onDone] with the application context. */
    fun start(context: Context, onDone: (Context) -> Unit) {
        val app = context.applicationContext
        scope.launch {
            runWithServer(app)
            onDone(app)
        }
    }

    /** Tells the server once, then clears the phone whatever the answer. */
    suspend fun runWithServer(context: Context) {
        val app = context.applicationContext
        withContext(NonCancellable) {
            val deviceId = SharedPreferenceHelper.getSharedPreferenceString(app, AppConstants.SHARED_PREFS_DEVICE_ID_KEY, "").orEmpty()
            val apiKey = SharedPreferenceHelper.getSharedPreferenceString(app, AppConstants.SHARED_PREFS_API_KEY_KEY, "").orEmpty()
            if (deviceId.isNotEmpty() && apiKey.isNotEmpty()) {
                try {
                    withTimeoutOrNull(SERVER_CALL_LIMIT_MS) {
                        ApiManagerKt.getApiService().disconnectDevice(deviceId, apiKey).body()?.close()
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Disconnect not sent to the server: ${e.message}")
                }
            }
            this@DeviceDisconnect.run(app)
        }
    }

    fun keysToClear(storedKeys: Set<String>): Set<String> =
        CLEARED_KEYS + storedKeys.filter { it.startsWith(CONFIG_PREFIX) }

    fun run(context: Context) {
        val app = context.applicationContext
        val prefs = SharedPreferenceHelper.preferences(app)
        val registration = prefs.edit()
        REGISTRATION_KEYS.forEach { registration.remove(it) }
        registration.putBoolean(AppConstants.SHARED_PREFS_FCM_TOKEN_RESET_PENDING_KEY, true)
        registration.commit()
        // A sign-in started before must never connect this phone again by itself
        safely("sign-in state") { DeviceLinkStore.clear(app) }

        // A queued send would go out for the old connection and lose its status
        safely("send jobs") { SmsSendWorker.cancelAll(app) }
        safely("heartbeat") { HeartbeatManager.cancelHeartbeat(app) }
        safely("sticky service") { TextbeeUtils.stopStickyNotificationService(app) }
        safely("API key state") { ApiKeyStatus.clear(app) }
        safely("notifications") { NotificationManagerCompat.from(app).cancelAll() }

        val rest = prefs.edit()
        keysToClear(prefs.all.keys).forEach { rest.remove(it) }
        rest.commit()

        // Best effort; until it succeeds PushToken deletes it again before the next registration
        safely("push token") {
            FirebaseMessaging.getInstance().deleteToken()
                .addOnSuccessListener { PushToken.resetDone(app) }
                .addOnFailureListener { Log.w(TAG, "Push token not deleted: ${it.message}") }
        }
    }

    private inline fun safely(what: String, block: () -> Unit) {
        try {
            block()
        } catch (e: Exception) {
            Log.w(TAG, "Disconnect could not clear the $what: ${e.message}")
        }
    }
}
