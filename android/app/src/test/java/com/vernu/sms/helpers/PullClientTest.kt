package com.vernu.sms.helpers

import org.junit.Assert.assertEquals
import org.junit.Test

class PullClientTest {
    private val now = 10_000_000_000L
    private val window = PullClient.WINDOW_MS

    @Test
    fun anIdleQueueTakesAFullBatch() {
        assertEquals(25, PullClient.claimLimit(aheadMs = 0, gapMs = 5_000))
        assertEquals(25, PullClient.claimLimit(aheadMs = 0, gapMs = 0))
    }

    @Test
    fun theLimitShrinksAsTheQueueFills() {
        assertEquals(10, PullClient.claimLimit(aheadMs = window - 60_000, gapMs = 5_000))
        assertEquals(0, PullClient.claimLimit(aheadMs = window, gapMs = 5_000))
        assertEquals(0, PullClient.claimLimit(aheadMs = window + 60_000, gapMs = 5_000))
    }

    @Test
    fun aShortSendGapCountsAsSixSecondsPerSend() {
        // 25 claimed sends book half the window, so two batches fill it
        assertEquals(25, PullClient.claimLimit(aheadMs = 25 * PullClient.MIN_SEND_GAP_MS, gapMs = 0))
        assertEquals(0, PullClient.claimLimit(aheadMs = 50 * PullClient.MIN_SEND_GAP_MS, gapMs = 1_000))
    }

    @Test
    fun aLongSendGapStillTakesOneMessage() {
        assertEquals(1, PullClient.claimLimit(aheadMs = 0, gapMs = 3_600_000))
        assertEquals(5, PullClient.claimLimit(aheadMs = 0, gapMs = 60_000))
    }

    @Test
    fun doorbellsKeepThirtySecondsApart() {
        assertEquals(0, plan("timer", lastClaimMs = now - PullClient.MIN_GAP_MS + 1))
        assertEquals(25, plan("timer", lastClaimMs = now - PullClient.MIN_GAP_MS))
        // A clock that moved backwards must not block claims
        assertEquals(25, plan("timer", lastClaimMs = now + 60_000))
    }

    @Test
    fun noClaimBeforeTheServerAllowsIt() {
        assertEquals(0, plan("timer", nextClaimMs = now + 1))
        assertEquals(0, plan(PullClient.DRAIN, nextClaimMs = now + 1, more = true))
        assertEquals(25, plan("timer", nextClaimMs = now))
        assertEquals(25, plan("timer", nextClaimMs = now + PullClient.MAX_RETRY_AFTER_MS + 1))
    }

    @Test
    fun drainNeedsMoreAndAHalfEmptyQueue() {
        assertEquals(0, plan(PullClient.DRAIN, more = false))
        assertEquals(25, plan(PullClient.DRAIN, more = true, lastClaimMs = now - 1))
        assertEquals(0, plan(PullClient.DRAIN, more = true, aheadMs = window / 2 + 1))
        assertEquals(25, plan(PullClient.DRAIN, more = true, aheadMs = window / 2))
    }

    private fun plan(
        reason: String, lastClaimMs: Long = 0, nextClaimMs: Long = 0,
        more: Boolean = false, aheadMs: Long = 0,
    ) = PullClient.plan(reason, now, lastClaimMs, nextClaimMs, more, aheadMs, 5_000)
}
