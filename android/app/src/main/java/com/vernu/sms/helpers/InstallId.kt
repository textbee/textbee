package com.vernu.sms.helpers

import android.content.Context
import android.util.Log
import java.io.File
import java.util.UUID

// Names this install of the app. Lives in no-backup storage, so a restored
// backup or a reinstall gets a new id.
object InstallId {
    private const val TAG = "InstallId"
    private const val FILE_NAME = "install_id"

    @Volatile
    private var cached: String? = null

    @JvmStatic
    fun get(context: Context): String =
        cached ?: synchronized(this) { cached ?: load(context.applicationContext) }

    private fun load(context: Context): String {
        try {
            val file = File(context.noBackupFilesDir, FILE_NAME)
            if (file.exists()) {
                val stored = file.readText().trim()
                if (isValid(stored)) return stored.also { cached = it }
            }
            val id = UUID.randomUUID().toString()
            file.writeText(id)
            return id.also { cached = it }
        } catch (e: Exception) {
            // Storage is not ready, for example before the first unlock. The
            // id is not kept, so the next call reads the stored one again.
            Log.w(TAG, "Install id storage not available: ${e.message}")
            return UUID.randomUUID().toString()
        }
    }

    private fun isValid(value: String): Boolean = try {
        UUID.fromString(value).toString() == value
    } catch (e: IllegalArgumentException) {
        false
    }
}
