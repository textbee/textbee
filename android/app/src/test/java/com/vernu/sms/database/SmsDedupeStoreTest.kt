package com.vernu.sms.database

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SmsDedupeStoreTest {
    // Values as builds 20 and 21 wrote them: "<firstSeen>|<sentAt or empty>"
    private val values = mapOf(
        "sent:+15555550100" to "1000000|1000500",
        "seen:+15555550100" to "1000000|",
        "broken:+15555550100" to "x|1000500",
    )
    private val store = SmsDedupeStore { values[it] }

    private val valid = SmsDedupeStore.EARLIEST_VALID_MS + 1_000L

    @Test
    fun aSentMessageIsSkipped() {
        assertTrue(store.wasSent("sent", "+15555550100"))
        assertFalse(store.wasSent("sent", "+15555550101"))
    }

    @Test
    fun seenButNotSentMustSendAgain() {
        assertFalse(store.wasSent("seen", "+15555550100"))
    }

    @Test
    fun anUnknownOrUnreadableEntryIsNotSent() {
        assertFalse(store.wasSent("missing", "+15555550100"))
        assertFalse(store.wasSent("broken", "+15555550100"))
    }

    @Test
    fun theStoreIsReadForEightDaysAfterTheFirstRun() {
        assertTrue(SmsDedupeStore.stillRead(valid, valid))
        assertTrue(SmsDedupeStore.stillRead(valid, valid + SmsDedupeStore.READ_FOR_MS - 1))
        assertFalse(SmsDedupeStore.stillRead(valid, valid + SmsDedupeStore.READ_FOR_MS))
        assertFalse(SmsDedupeStore.stillRead(valid, valid + 365L * 24 * 60 * 60 * 1000))
    }

    @Test
    fun eightDaysOutlastTheServerRepeatWindow() {
        assertTrue(SmsDedupeStore.READ_FOR_MS > 72L * 60 * 60 * 1000)
    }

    @Test
    fun aClockSetBackBeforeTheFirstRunKeepsTheRead() {
        assertTrue(SmsDedupeStore.stillRead(valid, valid - 1))
        assertTrue(SmsDedupeStore.stillRead(valid, 0L))
    }

    @Test
    fun theFirstRunIsStampedOnceWithAValidClock() {
        assertEquals(valid, SmsDedupeStore.stampFor(0L, valid))
        assertNull(SmsDedupeStore.stampFor(valid, valid + SmsDedupeStore.READ_FOR_MS))
    }

    @Test
    fun aClockBeforeTheBuildStampsNothingAndKeepsTheRead() {
        val wrong = 86_400_000L
        assertNull(SmsDedupeStore.stampFor(0L, wrong))
        assertTrue(SmsDedupeStore.stillRead(0L, wrong))
        // A stamp from a wrong clock is replaced once the clock is valid
        assertEquals(valid, SmsDedupeStore.stampFor(wrong, valid))
        assertTrue(SmsDedupeStore.stillRead(wrong, valid + SmsDedupeStore.READ_FOR_MS * 10))
    }
}
