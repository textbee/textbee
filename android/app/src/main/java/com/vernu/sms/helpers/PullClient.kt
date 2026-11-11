package com.vernu.sms.helpers

import android.content.Context
import android.os.PowerManager
import android.util.Log
import com.vernu.sms.ApiManager
import com.vernu.sms.AppConstants
import com.vernu.sms.TextbeeUtils
import com.vernu.sms.dtos.ClaimMessagesInputDTO
import com.vernu.sms.workers.SmsSendWorker
import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

// Asks the server for messages to send and hands them to the normal send
// path. Runs only when the server has switched it on. Each call is one
// request; a failed request waits for the next doorbell.
object PullClient {
    private const val TAG = "PullClient"
    const val MAX_LIMIT = 25
    // Never hold more than this much sending work on the phone
    const val WINDOW_MS = 5 * 60 * 1000L
    const val MIN_GAP_MS = 30_000L
    const val MIN_SEND_GAP_MS = 1_000L
    const val MAX_RETRY_AFTER_MS = 60 * 60 * 1000L
    const val DRAIN = "drain"
    private const val WAKELOCK_MS = 30_000L
    // Shorter than the wakelock, so the reply is handled while it is held
    private const val CALL_TIMEOUT_SECONDS = 25L

    private val running = AtomicBoolean(false)

    // How many messages fit in the window. aheadMs is the sending work
    // already queued. An idle queue always gets at least one.
    fun claimLimit(aheadMs: Long, gapMs: Long): Int {
        val gap = maxOf(gapMs, MIN_SEND_GAP_MS)
        val room = WINDOW_MS - maxOf(aheadMs, 0L)
        if (room <= 0) return 0
        return ((room + gap - 1) / gap).coerceIn(0L, MAX_LIMIT.toLong()).toInt()
    }

    // The limit for a claim now, or 0 when no claim may be made
    fun plan(
        reason: String, nowMs: Long, lastClaimMs: Long, nextClaimMs: Long,
        more: Boolean, aheadMs: Long, gapMs: Long,
    ): Int {
        // A value far in the future can only come from a clock change
        if (nowMs < nextClaimMs && nextClaimMs - nowMs <= MAX_RETRY_AFTER_MS) return 0
        if (reason == DRAIN) {
            // Refill in batches, not once per finished send
            if (!more || aheadMs > WINDOW_MS / 2) return 0
        } else if (nowMs - lastClaimMs in 0 until MIN_GAP_MS) {
            return 0
        }
        return claimLimit(aheadMs, gapMs)
    }

    @JvmStatic
    fun claimNow(context: Context, reason: String) {
        val appContext = context.applicationContext
        try {
            if (!isActive(appContext)) return
            if (!running.compareAndSet(false, true)) return
        } catch (e: Exception) {
            Log.w(TAG, "Claim ($reason) not started: ${e.message}")
            return
        }
        var wakeLock: PowerManager.WakeLock? = null
        try {
            val limit = planNow(appContext, reason)
            if (limit <= 0) {
                running.set(false)
                return
            }
            wakeLock = acquireWakeLock(appContext)
            val heldLock = wakeLock
            Thread({
                try {
                    claim(appContext, reason, limit)
                } catch (e: Exception) {
                    TextbeeUtils.logException(e, "Claim failed")
                } finally {
                    release(heldLock)
                    running.set(false)
                }
            }, "pull-claim").start()
        } catch (e: Throwable) {
            release(wakeLock)
            running.set(false)
            Log.w(TAG, "Claim ($reason) not started: ${e.message}")
        }
    }

    private fun isActive(context: Context): Boolean {
        if (!DeviceConfig.pullEnabled(context)) return false
        if (deviceId(context).isEmpty() || apiKey(context).isEmpty()) return false
        return SharedPreferenceHelper.getSharedPreferenceBoolean(
            context, AppConstants.SHARED_PREFS_GATEWAY_ENABLED_KEY, false
        )
    }

    private fun planNow(context: Context, reason: String): Int {
        val now = System.currentTimeMillis()
        return plan(
            reason, now,
            getLong(context, AppConstants.SHARED_PREFS_PULL_LAST_CLAIM_MS_KEY),
            getLong(context, AppConstants.SHARED_PREFS_PULL_NEXT_CLAIM_MS_KEY),
            SharedPreferenceHelper.getSharedPreferenceBoolean(
                context, AppConstants.SHARED_PREFS_PULL_MORE_KEY, false
            ),
            aheadMs(context, now), sendGapMs(context),
        )
    }

    // The send queue timeline, or this client's own booking when that is
    // later (no send gap, or the chained send path that books no slots)
    private fun aheadMs(context: Context, now: Long): Long {
        val booked = getLong(context, AppConstants.SHARED_PREFS_PULL_BOOKED_UNTIL_MS_KEY) - now
        val bookedAhead = if (booked in 0..SendSlotScheduler.MAX_SLOT_AHEAD_MS) booked else 0L
        return maxOf(SendSlotScheduler.queuedAheadMs(context, now), bookedAhead)
    }

    private fun sendGapMs(context: Context): Long =
        SharedPreferenceHelper.getSharedPreferenceInt(
            context, AppConstants.SHARED_PREFS_SMS_SEND_DELAY_SECONDS_KEY,
            AppConstants.DEFAULT_SMS_SEND_DELAY_SECONDS
        ).coerceIn(0, 3600) * 1000L

    private fun claim(context: Context, reason: String, limit: Int) {
        val startedAt = System.currentTimeMillis()
        setLong(context, AppConstants.SHARED_PREFS_PULL_LAST_CLAIM_MS_KEY, startedAt)

        val response = try {
            val call = ApiManager.getApiService().claimMessages(
                deviceId(context), apiKey(context),
                ClaimMessagesInputDTO(limit, reason, InstallId.get(context))
            )
            call.timeout().timeout(CALL_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            call.execute()
        } catch (e: Exception) {
            // After a network error the next doorbell, for example network regained, may try at once
            if (e is IOException) setLong(context, AppConstants.SHARED_PREFS_PULL_LAST_CLAIM_MS_KEY, 0L)
            setMore(context, false)
            Log.w(TAG, "Claim ($reason) failed: ${e.message}")
            DeviceLog.log(context, "claim_failed", "$reason: ${if (e is IOException) "network" else e.javaClass.simpleName}")
            return
        }

        if (!response.isSuccessful) {
            setMore(context, false)
            // The server says this device may not pull. The next heartbeat config decides again.
            if (response.code() == 403) DeviceConfig.setPullEnabled(context, false)
            Log.w(TAG, "Claim ($reason) failed: ${response.code()}")
            DeviceLog.log(context, "claim_failed", "$reason: http ${response.code()}")
            return
        }

        val body = response.body()
        // Stamped after the reply, since the server hands the messages out while answering
        val receivedAt = System.currentTimeMillis()
        val messages = body?.data.orEmpty()
        val aheadBefore = aheadMs(context, receivedAt)
        var enqueued = 0
        for (payload in messages) {
            val smsId = payload.smsId ?: continue
            val message = payload.message ?: continue
            for (recipient in payload.recipients.orEmpty()) {
                try {
                    SmsSendWorker.enqueue(
                        context, recipient, message, smsId, payload.smsBatchId,
                        payload.simSubscriptionId, receivedAt
                    )
                    enqueued++
                } catch (e: Exception) {
                    TextbeeUtils.logException(e, "Could not queue a claimed message")
                }
            }
        }

        if (enqueued > 0) {
            setLong(
                context, AppConstants.SHARED_PREFS_PULL_BOOKED_UNTIL_MS_KEY,
                receivedAt + aheadBefore + enqueued * maxOf(sendGapMs(context), MIN_SEND_GAP_MS)
            )
        }
        setMore(context, body?.more == true)
        val retryAfterMs = ((body?.retryAfterSeconds ?: 0.0) * 1000).toLong().coerceIn(0L, MAX_RETRY_AFTER_MS)
        setLong(context, AppConstants.SHARED_PREFS_PULL_NEXT_CLAIM_MS_KEY, receivedAt + retryAfterMs)
        DeviceConfig.save(context, body?.config)

        Log.d(TAG, "Claim ($reason): ${messages.size} messages, $enqueued sends enqueued")
        DeviceLog.log(context, "claim", "$reason: ${messages.size} message(s)")
    }

    private fun acquireWakeLock(context: Context): PowerManager.WakeLock? = try {
        (context.getSystemService(Context.POWER_SERVICE) as? PowerManager)
            ?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "textbee:pull-claim")
            ?.apply {
                setReferenceCounted(false)
                acquire(WAKELOCK_MS)
            }
    } catch (e: Exception) {
        Log.w(TAG, "No wakelock for the claim: ${e.message}")
        null
    }

    private fun release(wakeLock: PowerManager.WakeLock?) {
        try {
            if (wakeLock?.isHeld == true) wakeLock.release()
        } catch (e: Exception) {
            Log.w(TAG, "Wakelock release failed: ${e.message}")
        }
    }

    private fun deviceId(context: Context): String =
        SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_DEVICE_ID_KEY, ""
        ) ?: ""

    private fun apiKey(context: Context): String =
        SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_API_KEY_KEY, ""
        ) ?: ""

    private fun getLong(context: Context, key: String): Long =
        SharedPreferenceHelper.getSharedPreferenceLong(context, key, 0L)

    private fun setLong(context: Context, key: String, value: Long) =
        SharedPreferenceHelper.setSharedPreferenceLong(context, key, value)

    private fun setMore(context: Context, more: Boolean) =
        SharedPreferenceHelper.setSharedPreferenceBoolean(
            context, AppConstants.SHARED_PREFS_PULL_MORE_KEY, more
        )
}
