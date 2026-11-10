package com.vernu.sms.database

import android.content.Context
import com.vernu.sms.helpers.DeliveryVerdict

sealed class DeliveryOutcome {
    // Nothing to report yet, or the message was already reported
    object Wait : DeliveryOutcome()
    object Delivered : DeliveryOutcome()
    data class Failed(val code: String, val message: String) : DeliveryOutcome()
}

// Joins the delivery reports of a multipart SMS into one result. Each part
// gets its own report, hours apart at worst, so the state is stored. The
// message is delivered when every part is, and failed when any part fails.
// Some carriers report only some parts, so settle() also counts a message
// as delivered when a part was delivered, none failed and nothing new came.
class MultipartDeliveryTracker(
    private val storage: DedupeStorage,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    companion object {
        const val TTL_MS = 7 * 24 * 60 * 60 * 1000L
        private const val PREF_FILE = "SMS_MULTIPART_DELIVERY"
        private const val OPEN = 'o'
        private const val DONE = 'x'
        private const val PART_WAITING = '.'
        private const val PART_DELIVERED = 'd'
        // get() makes a new tracker per report, so the lock is shared
        private val lock = Any()

        @JvmStatic
        fun get(context: Context) = MultipartDeliveryTracker(SharedPreferencesStorage(context))

        /** The outcome of a single-part message: its one report decides. */
        @JvmStatic
        fun single(verdict: DeliveryVerdict): DeliveryOutcome = when (verdict) {
            DeliveryVerdict.Delivered -> DeliveryOutcome.Delivered
            DeliveryVerdict.Pending -> DeliveryOutcome.Wait
            is DeliveryVerdict.Failed -> DeliveryOutcome.Failed(verdict.code, verdict.message)
        }
    }

    // value is "<firstSeen>|<o or x>|<one char per part>|<last delivered at>"
    private data class State(
        val firstSeen: Long,
        val done: Boolean,
        val parts: CharArray,
        val lastDeliveredAt: Long = 0,
    )

    private fun parse(value: String?): State? {
        val fields = value?.split('|') ?: return null
        if (fields.size != 4) return null
        val firstSeen = fields[0].toLongOrNull() ?: return null
        val lastDeliveredAt = fields[3].toLongOrNull() ?: return null
        return State(firstSeen, fields[1] == DONE.toString(), fields[2].toCharArray(), lastDeliveredAt)
    }

    private fun write(smsId: String, state: State) {
        val done = if (state.done) DONE else OPEN
        storage.put(smsId, "${state.firstSeen}|$done|${String(state.parts)}|${state.lastDeliveredAt}")
    }

    fun record(smsId: String, partIndex: Int, partCount: Int, verdict: DeliveryVerdict): DeliveryOutcome {
        if (partCount <= 1 || partIndex !in 0 until partCount) return single(verdict)
        return synchronized(lock) { recordPart(smsId, partIndex, partCount, verdict) }
    }

    private fun recordPart(smsId: String, partIndex: Int, partCount: Int, verdict: DeliveryVerdict): DeliveryOutcome {
        prune()

        val stored = parse(storage.all()[smsId])?.takeIf { it.parts.size == partCount }
        val state = stored ?: State(clock(), false, CharArray(partCount) { PART_WAITING })
        if (state.done) return DeliveryOutcome.Wait

        return when (verdict) {
            DeliveryVerdict.Pending -> DeliveryOutcome.Wait
            is DeliveryVerdict.Failed -> {
                write(smsId, state.copy(done = true))
                DeliveryOutcome.Failed(verdict.code, verdict.message)
            }
            DeliveryVerdict.Delivered -> {
                state.parts[partIndex] = PART_DELIVERED
                val all = state.parts.all { it == PART_DELIVERED }
                write(smsId, state.copy(done = all, lastDeliveredAt = clock()))
                if (all) DeliveryOutcome.Delivered else DeliveryOutcome.Wait
            }
        }
    }

    /**
     * Ends an open message that has at least one delivered part and no
     * failure. Returns when the last part was delivered, or null when there
     * is nothing to settle.
     */
    fun settle(smsId: String): Long? = synchronized(lock) {
        val state = parse(storage.all()[smsId]) ?: return null
        if (state.done || state.parts.none { it == PART_DELIVERED }) return null
        write(smsId, state.copy(done = true))
        state.lastDeliveredAt
    }

    fun prune() {
        val cutoff = clock() - TTL_MS
        for ((k, v) in storage.all()) {
            val firstSeen = parse(v)?.firstSeen
            if (firstSeen == null || firstSeen < cutoff) storage.remove(k)
        }
    }

    private class SharedPreferencesStorage(context: Context) : DedupeStorage {
        private val prefs = context.applicationContext.getSharedPreferences(PREF_FILE, 0)

        @Suppress("UNCHECKED_CAST")
        override fun all(): Map<String, String> = prefs.all as Map<String, String>
        override fun put(key: String, value: String) = prefs.edit().putString(key, value).apply()
        override fun remove(key: String) = prefs.edit().remove(key).apply()
    }
}
