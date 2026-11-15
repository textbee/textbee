package com.vernu.sms.database

import android.content.Context
import com.vernu.sms.AppConstants
import com.vernu.sms.helpers.SharedPreferenceHelper

fun interface DedupeStorage {
    fun get(key: String): String?
}

// Read-only record of the sends of builds 20 and 21, which had no send markers; deleted when no longer read
class SmsDedupeStore(private val storage: DedupeStorage) {
    companion object {
        // The server offers a message again for up to 72 hours; 8 days covers that with room to spare
        const val READ_FOR_MS = 8 * 24 * 60 * 60 * 1000L
        // 2026-11-01 UTC, before this build existed: an earlier clock is wrong and stamps nothing
        const val EARLIEST_VALID_MS = 1_793_491_200_000L
        private const val PREF_FILE = "SMS_DEDUPE"

        @Volatile
        private var deleted = false

        // The first-run time to store now, or null to keep the stored one or wait for a valid clock
        fun stampFor(storedMs: Long, nowMs: Long): Long? =
            if (storedMs < EARLIEST_VALID_MS && nowMs >= EARLIEST_VALID_MS) nowMs else null

        // Read until 8 days after a valid first run; a clock set back before it keeps the read
        fun stillRead(firstRunMs: Long, nowMs: Long): Boolean =
            firstRunMs < EARLIEST_VALID_MS || nowMs < firstRunMs || nowMs - firstRunMs < READ_FOR_MS

        // Null once the store is no longer read. Records the first run of this build once.
        @JvmStatic
        fun forReading(context: Context): SmsDedupeStore? {
            val app = context.applicationContext
            val now = System.currentTimeMillis()
            var firstRun = SharedPreferenceHelper.getSharedPreferenceLong(
                app, AppConstants.SHARED_PREFS_OLD_DEDUPE_READ_SINCE_MS_KEY, 0L
            )
            stampFor(firstRun, now)?.let {
                firstRun = it
                SharedPreferenceHelper.setSharedPreferenceLong(
                    app, AppConstants.SHARED_PREFS_OLD_DEDUPE_READ_SINCE_MS_KEY, it
                )
            }
            if (stillRead(firstRun, now)) return SmsDedupeStore(SharedPreferencesStorage(app))
            if (!deleted) {
                app.deleteSharedPreferences(PREF_FILE)
                deleted = true
            }
            return null
        }
    }

    // value is "<firstSeen>|<sentAt or empty>"
    fun wasSent(smsId: String, phone: String): Boolean {
        val parts = storage.get("$smsId:$phone")?.split('|') ?: return false
        return parts.getOrNull(0)?.toLongOrNull() != null && parts.getOrNull(1)?.toLongOrNull() != null
    }

    private class SharedPreferencesStorage(context: Context) : DedupeStorage {
        private val prefs = context.getSharedPreferences(PREF_FILE, 0)

        // A value of another type counts as missing
        override fun get(key: String): String? = try {
            prefs.getString(key, null)
        } catch (e: ClassCastException) {
            null
        }
    }
}
