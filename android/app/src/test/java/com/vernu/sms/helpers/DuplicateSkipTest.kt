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
        val marker = SendMarkerStore.Marker(SendMarkerStore.SENDING, now - DeviceConfig.SENDING_MARKER_YOUNG_MINUTES.default * 60_000L)
        val dto = DuplicateSkip.statusFor(marker, true, now)!!
        assertEquals("UNKNOWN", dto.status)
        assertEquals(DuplicateSkip.SEND_INTERRUPTED, dto.errorCode)
    }

    @Test
    fun theInFlightAgeComesFromTheConfig() {
        val youngMs = 10 * 60_000L
        val young = SendMarkerStore.Marker(SendMarkerStore.SENDING, now - youngMs + 1)
        assertNull(DuplicateSkip.statusFor(young, true, now, youngMs))
        val old = SendMarkerStore.Marker(SendMarkerStore.SENDING, now - youngMs)
        assertEquals("UNKNOWN", DuplicateSkip.statusFor(old, true, now, youngMs)!!.status)
    }

    @Test
    fun aMessageKnownOnlyToTheOldStoreIsReportedAsInterrupted() {
        val dto = DuplicateSkip.statusFor(null, false, now)!!
        assertEquals("UNKNOWN", dto.status)
        assertEquals(DuplicateSkip.SEND_INTERRUPTED, dto.errorCode)
    }
}
