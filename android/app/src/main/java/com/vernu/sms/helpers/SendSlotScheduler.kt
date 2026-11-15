package com.vernu.sms.helpers

import android.content.Context
import com.vernu.sms.AppConstants

// Hands out send times so messages keep the configured gap without any
// worker sleeping. Each enqueue reserves the next slot and gets back how
// long its job should wait before running.
object SendSlotScheduler {
    // A slot further ahead than this cannot come from real pacing
    const val MAX_SLOT_AHEAD_MS = 24 * 60 * 60 * 1000L

    data class Slot(val initialDelayMs: Long, val nextSlotMs: Long)

    fun next(storedSlotMs: Long, lastReservedAtMs: Long, nowMs: Long, gapMs: Long): Slot {
        var slot = storedSlotMs
        // A clock that moved backwards, or a corrupt slot, would stall every send
        if (nowMs < lastReservedAtMs || slot > nowMs + MAX_SLOT_AHEAD_MS) slot = nowMs
        val start = maxOf(nowMs, slot)
        return Slot(initialDelayMs = start - nowMs, nextSlotMs = start + gapMs)
    }

    // Two independent timelines: one spaces the jobs when they are queued,
    // the other re-checks right before the radio call, because WorkManager
    // may run several due jobs together after the phone wakes up.
    class Keys(val slotKey: String, val lastReservedKey: String)
    val QUEUE = Keys(
        AppConstants.SHARED_PREFS_NEXT_SEND_SLOT_MS_KEY,
        AppConstants.SHARED_PREFS_LAST_SEND_RESERVED_AT_MS_KEY,
    )
    val EXECUTION = Keys(
        AppConstants.SHARED_PREFS_NEXT_SEND_EXEC_SLOT_MS_KEY,
        AppConstants.SHARED_PREFS_LAST_SEND_EXEC_RESERVED_AT_MS_KEY,
    )

    interface SlotStore {
        fun get(key: String): Long
        fun set(key: String, value: Long)
    }

    private class PrefsSlotStore(private val context: Context) : SlotStore {
        override fun get(key: String) = SharedPreferenceHelper.getSharedPreferenceLong(context, key, 0L)
        override fun set(key: String, value: Long) = SharedPreferenceHelper.setSharedPreferenceLong(context, key, value)
    }

    private val lock = Any()

    fun reserve(context: Context, gapMs: Long, keys: Keys = QUEUE): Long =
        reserveIfWithin(context, gapMs, keys, Long.MAX_VALUE) ?: 0L

    fun reserveIfWithin(context: Context, gapMs: Long, keys: Keys, maxWaitMs: Long): Long? =
        reserveIfWithin(PrefsSlotStore(context), keys, gapMs, maxWaitMs)

    // How far ahead of now the queue timeline is booked
    fun queuedAheadMs(context: Context, nowMs: Long = System.currentTimeMillis()): Long =
        queuedAheadMs(PrefsSlotStore(context), QUEUE, nowMs)

    fun queuedAheadMs(store: SlotStore, keys: Keys, nowMs: Long): Long = synchronized(lock) {
        val slot = store.get(keys.slotKey)
        // Same sanity rule as next()
        if (nowMs < store.get(keys.lastReservedKey) || slot > nowMs + MAX_SLOT_AHEAD_MS) 0L
        else maxOf(0L, slot - nowMs)
    }

    // Takes the next slot only when its wait fits; otherwise nothing is
    // reserved and the caller comes back later.
    fun reserveIfWithin(
        store: SlotStore,
        keys: Keys,
        gapMs: Long,
        maxWaitMs: Long,
        nowMs: Long = System.currentTimeMillis(),
    ): Long? = synchronized(lock) {
        val slot = next(store.get(keys.slotKey), store.get(keys.lastReservedKey), nowMs, gapMs)
        if (slot.initialDelayMs > maxWaitMs) return null
        store.set(keys.slotKey, slot.nextSlotMs)
        store.set(keys.lastReservedKey, nowMs)
        slot.initialDelayMs
    }
}
