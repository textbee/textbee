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

    // A pending sign-in resumes while its code can still be approved, an approved one for a day
    fun canResume(nowMs: Long): Boolean =
        if (isApproved) !DeviceLink.finishTimeUp(startedAtMs, nowMs)
        else pollToken.isNotEmpty() && displayCode.isNotEmpty() && !DeviceLink.waitTimeUp(startedAtMs, nowMs)
}

// Kept in no-backup storage, so a sign-in survives the app being stopped while the browser is open
object DeviceLinkStore {
    private const val TAG = "DeviceLinkStore"
    private const val FILE_NAME = "device_link.json"
    private val gson = Gson()

    fun load(context: Context): DeviceLinkSession? = load(dir(context))

    fun save(context: Context, session: DeviceLinkSession) = save(dir(context), session)

    fun clear(context: Context) = clear(dir(context))

    /** Null when nothing is stored or the stored text cannot be read. */
    fun load(dir: File?): DeviceLinkSession? = if (dir == null) null else try {
        val file = File(dir, FILE_NAME)
        if (file.exists()) gson.fromJson(file.readText(), DeviceLinkSession::class.java) else null
    } catch (e: Exception) {
        log("Sign-in state not read: ${e.message}")
        null
    }

    fun save(dir: File?, session: DeviceLinkSession) {
        if (dir == null) return
        try {
            val file = File(dir, FILE_NAME)
            val temp = File(dir, "$FILE_NAME.tmp")
            temp.writeText(gson.toJson(session))
            if (!temp.renameTo(file)) {
                file.writeText(gson.toJson(session))
                temp.delete()
            }
        } catch (e: Exception) {
            log("Sign-in state not saved: ${e.message}")
        }
    }

    fun clear(dir: File?) {
        if (dir == null) return
        try {
            File(dir, FILE_NAME).delete()
        } catch (e: Exception) {
            log("Sign-in state not cleared: ${e.message}")
        }
    }

    private fun dir(context: Context): File? = try {
        context.applicationContext.noBackupFilesDir
    } catch (e: Exception) {
        null
    }

    private fun log(message: String) {
        try {
            Log.w(TAG, message)
        } catch (e: RuntimeException) {
            // Unit tests run without the Android log
        }
    }
}
