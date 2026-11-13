package com.vernu.sms.helpers

import android.content.Context
import com.google.android.gms.tasks.Task
import com.google.firebase.messaging.FirebaseMessaging
import com.vernu.sms.AppConstants

// The push token for a registration; deletes the token of a disconnect first, so a dead token is never stored
object PushToken {
    fun get(context: Context): Task<String> {
        val app = context.applicationContext
        val messaging = FirebaseMessaging.getInstance()
        if (!SharedPreferenceHelper.getSharedPreferenceBoolean(app, AppConstants.SHARED_PREFS_FCM_TOKEN_RESET_PENDING_KEY, false)) {
            return messaging.token
        }
        // A failed delete keeps the flag and still returns the current token
        return messaging.deleteToken().continueWithTask { delete ->
            if (delete.isSuccessful) resetDone(app)
            messaging.token
        }
    }

    fun resetDone(context: Context) =
        SharedPreferenceHelper.clearSharedPreference(context, AppConstants.SHARED_PREFS_FCM_TOKEN_RESET_PENDING_KEY)
}
