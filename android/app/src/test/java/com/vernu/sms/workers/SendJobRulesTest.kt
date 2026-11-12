package com.vernu.sms.workers

import androidx.work.Data
import com.vernu.sms.database.BucketListing
import com.vernu.sms.database.MarkerBuckets
import com.vernu.sms.database.SendMarkerStore
import com.vernu.sms.helpers.DuplicateSkip
import com.vernu.sms.helpers.SMSHelper
import com.vernu.sms.workers.SmsSendWorker.Companion.JobResult
import com.vernu.sms.workers.SmsSendWorker.Companion.Outcome
import com.vernu.sms.workers.SmsSendWorker.Companion.Start
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SendJobRulesTest {
    private class MemoryBuckets : MarkerBuckets {
        val files = LinkedHashMap<String, MutableMap<String, String>>()
        override fun list(today: Long) =
            BucketListing(files.keys.associateWith { it.substringAfterLast('_').toLong() }, true)
        override fun get(bucket: String, key: String): String? = files[bucket]?.get(key)
        override fun commit(bucket: String, key: String, value: String): Boolean {
            files.getOrPut(bucket) { LinkedHashMap() }[key] = value
            return true
        }
        override fun apply(bucket: String, key: String, value: String) {
            files.getOrPut(bucket) { LinkedHashMap() }[key] = value
        }
        override fun delete(bucket: String) { files.remove(bucket) }
    }

    private val markers = SendMarkerStore(MemoryBuckets()) { 1_800_000_000_000L }
    private val phone = "+15555550100"

    @Test
    fun anOldChainJobNeverFailsOrRetries() {
        for (outcome in Outcome.values()) {
            assertEquals("legacy, $outcome", JobResult.SUCCESS, SmsSendWorker.resultFor(true, outcome))
        }
    }

    @Test
    fun aPacedJobFailsWhenNothingWasSent() {
        val expected = mapOf(
            Outcome.SENT to JobResult.SUCCESS,
            Outcome.DUPLICATE to JobResult.SUCCESS,
            Outcome.MAYBE_SENT to JobResult.SUCCESS,
            Outcome.REFUSED to JobResult.FAILURE,
            Outcome.SIM_ERROR to JobResult.FAILURE,
            Outcome.MISSING_INPUT to JobResult.FAILURE,
            Outcome.NOT_REGISTERED to JobResult.FAILURE,
            Outcome.STOPPED to JobResult.FAILURE,
            Outcome.WAIT to JobResult.RETRY,
            Outcome.ERROR to JobResult.FAILURE,
        )
        assertEquals(Outcome.values().toSet(), expected.keys)
        expected.forEach { (outcome, result) -> assertEquals("paced, $outcome", result, SmsSendWorker.resultFor(false, outcome)) }
    }

    @Test
    fun anOldChainJobSendsOnItsFirstRun() {
        assertEquals(Start.SEND, SmsSendWorker.start(legacy = true, runAttemptCount = 0, known = false))
    }

    @Test
    fun anOldChainJobRunAgainWithNoRecordIsNotSentAgain() {
        assertEquals(Start.MAYBE_SENT, SmsSendWorker.start(legacy = true, runAttemptCount = 1, known = false))
        assertEquals(Start.MAYBE_SENT, SmsSendWorker.start(legacy = true, runAttemptCount = 3, known = false))
    }

    @Test
    fun aRecordedMessageFollowsTheMarker() {
        assertEquals(Start.DUPLICATE, SmsSendWorker.start(legacy = true, runAttemptCount = 1, known = true))
        assertEquals(Start.DUPLICATE, SmsSendWorker.start(legacy = true, runAttemptCount = 0, known = true))
        assertEquals(Start.DUPLICATE, SmsSendWorker.start(legacy = false, runAttemptCount = 2, known = true))
    }

    @Test
    fun aPacedJobIsNotAffectedByItsRunCount() {
        assertEquals(Start.SEND, SmsSendWorker.start(legacy = false, runAttemptCount = 0, known = false))
        assertEquals(Start.SEND, SmsSendWorker.start(legacy = false, runAttemptCount = 4, known = false))
    }

    @Test
    fun anOversizeMessageIsMarkedFailedReportedOnceAndNotQueued() {
        var reports = 0
        var queued = 0
        val result = SmsSendWorker.queueOrFail(
            null, "m1", phone, { markers }, report = { reports++ }, queue = { queued++; true },
        )

        assertFalse(result)
        assertEquals(1, reports)
        // No job means no send slot is reserved
        assertEquals(0, queued)
        val marker = markers.find("m1", phone)!!
        assertEquals(SendMarkerStore.FAILED, marker.state)
        assertEquals(SMSHelper.ERROR_MESSAGE_TOO_LARGE, marker.errorCode)
        assertEquals(SMSHelper.MESSAGE_TOO_LARGE_TEXT, marker.errorMessage)
    }

    @Test
    fun aRepeatedOversizeOfferRestatesTheFailure() {
        SmsSendWorker.queueOrFail(null, "m1", phone, { markers }, report = {}, queue = { true })

        assertTrue(markers.exists("m1", phone))
        val restated = DuplicateSkip.statusFor(markers.find("m1", phone), true, 1_800_000_000_000L)!!
        assertEquals("FAILED", restated.status)
        assertEquals(SMSHelper.ERROR_MESSAGE_TOO_LARGE, restated.errorCode)
    }

    @Test
    fun aMessageThatFitsIsQueuedWithNoMarkerOrReport() {
        var reports = 0
        val input = SmsSendWorker.sendInput(phone, "hello", "m2", null, null, null, 0L)
        val result = SmsSendWorker.queueOrFail(input, "m2", phone, { markers }, report = { reports++ }, queue = { true })

        assertTrue(result)
        assertEquals(0, reports)
        assertFalse(markers.exists("m2", phone))
    }

    @Test
    fun anAlreadyQueuedMessageCountsAsNotQueued() {
        val input = SmsSendWorker.sendInput(phone, "hello", "m3", null, null, null, 0L)
        assertFalse(SmsSendWorker.queueOrFail(input, "m3", phone, { markers }, report = {}, queue = { false }))
    }

    @Test
    fun twoOffersOfOneOversizeMessageReportOnce() {
        var reports = 0
        repeat(2) {
            SmsSendWorker.queueOrFail(null, "m4", phone, { markers }, report = { reports++ }, queue = { true })
        }
        assertEquals(1, reports)
    }

    @Test
    fun anOversizeMessageWithNoIdIsStillReported() {
        var reports = 0
        SmsSendWorker.queueOrFail(null, null, phone, { markers }, report = { reports++ }, queue = { true })
        assertEquals(1, reports)
    }

    // A 2.8.0 job has no flag
    @Test
    fun aJobWithNoFlagIsOnTheOldChain() {
        val input = Data.Builder().putString(SmsSendWorker.KEY_PHONE, phone).build()
        assertTrue(SmsSendWorker.isLegacy(input))
        assertEquals(Start.SEND, SmsSendWorker.startFor(input, 0, known = false))
        assertEquals(Start.MAYBE_SENT, SmsSendWorker.startFor(input, 1, known = false))
    }

    // A 2.9.0 paced job
    @Test
    fun aJobWithTheFlagFalseIsPacedAtAnyCount() {
        val input = Data.Builder().putBoolean(SmsSendWorker.KEY_LEGACY_QUEUE, false).build()
        assertFalse(SmsSendWorker.isLegacy(input))
        for (count in listOf(0, 1, 5)) assertEquals(Start.SEND, SmsSendWorker.startFor(input, count, known = false))
    }

    // A 2.9.0 chain job
    @Test
    fun aJobWithTheFlagTrueIsOnTheOldChain() {
        val input = Data.Builder().putBoolean(SmsSendWorker.KEY_LEGACY_QUEUE, true).build()
        assertTrue(SmsSendWorker.isLegacy(input))
        assertEquals(Start.SEND, SmsSendWorker.startFor(input, 0, known = false))
        assertEquals(Start.MAYBE_SENT, SmsSendWorker.startFor(input, 1, known = false))
    }

    // Why the maybe-sent path reports before it writes its SENDING marker
    @Test
    fun maybeSentReportsOnlyWhenNoMarkerIsWrittenYet() {
        val now = 1_800_000_000_000L
        assertNotNull(DuplicateSkip.statusFor(null, false, now))
        assertNull(DuplicateSkip.statusFor(SendMarkerStore.Marker(SendMarkerStore.SENDING, now), true, now))
    }
}
