package com.vernu.sms.database

import android.content.Context

interface MarkerStorage {
    fun get(key: String): String?
    fun all(): Map<String, String>
    // Synchronous. False when the write did not reach the disk.
    fun commit(put: Map<String, String>, remove: Collection<String>): Boolean
    fun apply(key: String, value: String)
}

// One marker per radio call, written to disk before the call and kept in
// every state. A message with a marker is never handed to the radio again,
// even when the app stopped before the result arrived.
class SendMarkerStore(
    private val storage: MarkerStorage,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    enum class Begin { STARTED, DUPLICATE, WRITE_FAILED }

    data class Marker(
        val state: String,
        val atMs: Long,
        val errorCode: String? = null,
        val errorMessage: String? = null,
    )

    companion object {
        const val SENDING = "sending"
        const val SENT = "sent"
        const val FAILED = "failed"
        const val TTL_MS = 8 * 24 * 60 * 60 * 1000L
        const val PRUNE_EVERY_MS = 6 * 60 * 60 * 1000L
        const val PREF_FILE = "sms_send_markers"
        private const val PRUNED_AT_KEY = "_pruned_at"

        // Shared by every instance, so check and write are one step
        private val lock = Any()

        @JvmStatic
        fun get(context: Context) = SendMarkerStore(SharedPreferencesStorage(context))

        // value is "<state>|<time>|<error code>|<error message>"
        fun parse(value: String?): Marker? {
            val parts = value?.split('|', limit = 4) ?: return null
            val state = parts[0]
            if (state != SENDING && state != SENT && state != FAILED) return null
            return Marker(
                state,
                parts.getOrNull(1)?.toLongOrNull() ?: 0L,
                parts.getOrNull(2)?.takeIf { it.isNotEmpty() },
                parts.getOrNull(3)?.takeIf { it.isNotEmpty() },
            )
        }
    }

    private fun key(smsId: String, phone: String) = "$smsId:$phone"

    // Any stored value counts, even one that cannot be read
    fun exists(smsId: String, phone: String): Boolean = storage.get(key(smsId, phone)) != null

    fun find(smsId: String, phone: String): Marker? = parse(storage.get(key(smsId, phone)))

    // Call right before the radio. Only STARTED may go on to send.
    fun begin(smsId: String, phone: String): Begin = synchronized(lock) {
        val k = key(smsId, phone)
        if (storage.get(k) != null) return@synchronized Begin.DUPLICATE
        val now = clock()
        val put = hashMapOf(k to "$SENDING|$now")
        val remove = ArrayList<String>()
        val prunedAt = storage.get(PRUNED_AT_KEY)?.toLongOrNull() ?: 0L
        if (now < prunedAt || now - prunedAt >= PRUNE_EVERY_MS) {
            remove.addAll(expiredKeys(now))
            put[PRUNED_AT_KEY] = now.toString()
        }
        if (storage.commit(put, remove)) return@synchronized Begin.STARTED
        // The caller reports a failure, so the marker says the same
        storage.apply(k, "$FAILED|$now|MARKER_WRITE_FAILED")
        Begin.WRITE_FAILED
    }

    // Records the radio result. Does nothing for a send that has no marker.
    fun finish(smsId: String, phone: String, state: String, errorCode: String? = null, errorMessage: String? = null) {
        synchronized(lock) {
            val k = key(smsId, phone)
            if (storage.get(k) == null) return
            val code = errorCode.orEmpty().replace('|', ' ')
            storage.apply(k, "$state|${clock()}|$code|${errorMessage.orEmpty()}")
        }
    }

    private fun expiredKeys(now: Long): List<String> {
        val cutoff = now - TTL_MS
        return storage.all().filter { (k, v) ->
            k != PRUNED_AT_KEY && (parse(v)?.atMs ?: 0L) < cutoff
        }.keys.toList()
    }

    private class SharedPreferencesStorage(context: Context) : MarkerStorage {
        private val prefs = context.applicationContext.getSharedPreferences(PREF_FILE, 0)

        override fun get(key: String): String? = try {
            prefs.getString(key, null)
        } catch (e: ClassCastException) {
            "?"
        }

        override fun all(): Map<String, String> =
            prefs.all.mapNotNull { (k, v) -> (v as? String)?.let { k to it } }.toMap()

        override fun commit(put: Map<String, String>, remove: Collection<String>): Boolean {
            val editor = prefs.edit()
            for (k in remove) editor.remove(k)
            for ((k, v) in put) editor.putString(k, v)
            return editor.commit()
        }

        override fun apply(key: String, value: String) = prefs.edit().putString(key, value).apply()
    }
}
