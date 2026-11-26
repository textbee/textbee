package com.vernu.sms.helpers

import android.content.Context
import android.util.Log
import com.google.gson.Gson
import java.io.File

/** One sign-in in progress. After approval it also holds the key until the connect is finished. */
data class DeviceLinkSession(
    val displayCode: String = "",
    val linkUrl: String? = null,
    val manualUrl: String = DeviceLink.FALLBACK_MANUAL_URL,
    val pollToken: String = "",
    val pollSeconds: Double? = null,
    val startedAtMs: Long = 0L,
    val browserOpened: Boolean = false,
    val apiKey: String? = null,
    val deviceId: String? = null,
    val deviceName: String? = null,
    val accountEmail: String? = null,
    val reconnected: Boolean = false,
    val enable: Boolean = false,
) {
    val isApproved: Boolean get() = !apiKey.isNullOrEmpty() && !deviceId.isNullOrEmpty()

    // An approved sign-in waits for its last step; a pending one only while the code can still be approved
    fun canResume(nowMs: Long): Boolean =
        isApproved || (pollToken.isNotEmpty() && displayCode.isNotEmpty() && !DeviceLink.waitTimeUp(startedAtMs, nowMs))
}

// Kept in no-backup storage, so a sign-in survives the app being stopped while the browser is open
object DeviceLinkStore {
    private const val TAG = "DeviceLinkStore"
    private const val FILE_NAME = "device_link.json"
    private val gson = Gson()

    fun load(context: Context): DeviceLinkSession? = try {
        val file = file(context)
        if (file.exists()) gson.fromJson(file.readText(), DeviceLinkSession::class.java) else null
    } catch (e: Exception) {
        Log.w(TAG, "Sign-in state not read: ${e.message}")
        null
    }

    fun save(context: Context, session: DeviceLinkSession) {
        try {
            val file = file(context)
            val temp = File(file.parentFile, "$FILE_NAME.tmp")
            temp.writeText(gson.toJson(session))
            if (!temp.renameTo(file)) {
                file.writeText(gson.toJson(session))
                temp.delete()
            }
        } catch (e: Exception) {
            Log.w(TAG, "Sign-in state not saved: ${e.message}")
        }
    }

    fun clear(context: Context) {
        try {
            file(context).delete()
        } catch (e: Exception) {
            Log.w(TAG, "Sign-in state not cleared: ${e.message}")
        }
    }

    private fun file(context: Context) = File(context.applicationContext.noBackupFilesDir, FILE_NAME)
}
