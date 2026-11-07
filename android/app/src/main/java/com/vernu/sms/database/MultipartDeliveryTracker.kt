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

    // value is "<firstSeen>|<o or x>|<one char per part>"
    private data class State(val firstSeen: Long, val done: Boolean, val parts: CharArray)

    private fun parse(value: String?): State? {
        val fields = value?.split('|') ?: return null
        if (fields.size != 3) return null
        val firstSeen = fields[0].toLongOrNull() ?: return null
        return State(firstSeen, fields[1] == DONE.toString(), fields[2].toCharArray())
    }

    private fun write(smsId: String, state: State) {
        storage.put(smsId, "${state.firstSeen}|${if (state.done) DONE else OPEN}|${String(state.parts)}")
    }

    @Synchronized
    fun record(smsId: String, partIndex: Int, partCount: Int, verdict: DeliveryVerdict): DeliveryOutcome {
        if (partCount <= 1 || partIndex !in 0 until partCount) return single(verdict)
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
                write(smsId, state.copy(done = all))
                if (all) DeliveryOutcome.Delivered else DeliveryOutcome.Wait
            }
        }
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
