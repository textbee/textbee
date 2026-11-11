package com.vernu.sms.helpers

import com.vernu.sms.database.SendMarkerStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DuplicateSkipTest {
    private val now = 10_000_000_000L

    @Test
    fun aKnownResultIsRestated() {
        val sent = DuplicateSkip.statusFor(SendMarkerStore.Marker(SendMarkerStore.SENT, 123), true, now)!!
        assertEquals("SENT", sent.status)
        assertEquals(123, sent.sentAtInMillis)

        val failed = DuplicateSkip.statusFor(
            SendMarkerStore.Marker(SendMarkerStore.FAILED, 456, "1", "No service"), true, now
        )!!
        assertEquals("FAILED", failed.status)
        assertEquals(456, failed.failedAtInMillis)
        assertEquals("1", failed.errorCode)
        assertEquals("No service", failed.errorMessage)
    }

    @Test
    fun aSendStillWaitingForItsResultReportsNothing() {
        val marker = SendMarkerStore.Marker(SendMarkerStore.SENDING, now - 1_000)
        assertNull(DuplicateSkip.statusFor(marker, true, now))
    }

    @Test
    fun aSendWithNoResultIsReportedAsInterrupted() {
        val marker = SendMarkerStore.Marker(SendMarkerStore.SENDING, now - DuplicateSkip.INTERRUPTED_AFTER_MS)
        val dto = DuplicateSkip.statusFor(marker, true, now)!!
        assertEquals("UNKNOWN", dto.status)
        assertEquals(DuplicateSkip.SEND_INTERRUPTED, dto.errorCode)
    }

    @Test
    fun aMessageKnownOnlyToTheOldStoreIsReportedAsInterrupted() {
        val dto = DuplicateSkip.statusFor(null, false, now)!!
        assertEquals("UNKNOWN", dto.status)
        assertEquals(DuplicateSkip.SEND_INTERRUPTED, dto.errorCode)
    }
}
