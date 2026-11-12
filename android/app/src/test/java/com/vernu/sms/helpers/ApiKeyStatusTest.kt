package com.vernu.sms.helpers

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ApiKeyStatusTest {
    private val hour = 3_600_000L
    private val now = 1_000 * hour

    @Test
    fun a401SetsTheTimeOnce() {
        assertEquals(now, ApiKeyStatus.next(401, 0L, now))
        assertEquals(now - hour, ApiKeyStatus.next(401, now - hour, now))
    }

    @Test
    fun anySuccessClearsIt() {
        for (code in listOf(200, 201, 204, 299)) {
            assertEquals("http $code", 0L, ApiKeyStatus.next(code, now - hour, now))
            assertEquals("http $code", 0L, ApiKeyStatus.next(code, 0L, now))
        }
    }

    @Test
    fun otherCodesKeepIt() {
        for (code in listOf(300, 400, 403, 404, 429, 500, 503)) {
            assertEquals("http $code", now - hour, ApiKeyStatus.next(code, now - hour, now))
            assertEquals("http $code", 0L, ApiKeyStatus.next(code, 0L, now))
        }
    }

    @Test
    fun aReplyToAnOldKeyIsIgnored() {
        for (code in listOf(401, 200, 500)) {
            assertNull("http $code", ApiKeyStatus.decide(code, "old", "new", 0L, now))
            assertNull("http $code", ApiKeyStatus.decide(code, "old", "new", now - hour, now))
        }
        assertNull(ApiKeyStatus.decide(401, "", "", 0L, now))
    }

    @Test
    fun aCurrentKey401SetsTheTimeOnce() {
        assertEquals(now, ApiKeyStatus.decide(401, "key", "key", 0L, now))
        assertEquals(now - hour, ApiKeyStatus.decide(401, "key", "key", now - hour, now))
    }

    @Test
    fun aCurrentKeySuccessClears() {
        assertEquals(0L, ApiKeyStatus.decide(200, "key", "key", now - hour, now))
        assertEquals(0L, ApiKeyStatus.decide(204, "key", "key", 0L, now))
    }

    @Test
    fun otherCodesChangeNothing() {
        for (code in listOf(400, 403, 404, 429, 500)) {
            assertEquals("http $code", now - hour, ApiKeyStatus.decide(code, "key", "key", now - hour, now))
            assertEquals("http $code", 0L, ApiKeyStatus.decide(code, "key", "key", 0L, now))
        }
    }

    @Test
    fun notifiesTheFirstTime() {
        assertTrue(ApiKeyStatus.shouldNotify(nowMs = now, lastMs = 0L))
    }

    @Test
    fun staysQuietForADay() {
        assertFalse(ApiKeyStatus.shouldNotify(nowMs = now, lastMs = now - 1))
        assertFalse(ApiKeyStatus.shouldNotify(nowMs = now, lastMs = now - 24 * hour + 1))
    }

    @Test
    fun notifiesAgainAfterADay() {
        assertTrue(ApiKeyStatus.shouldNotify(nowMs = now, lastMs = now - 24 * hour))
        assertTrue(ApiKeyStatus.shouldNotify(nowMs = now, lastMs = now - 72 * hour))
    }

    @Test
    fun aClockSetBackwardsDoesNotMuteIt() {
        assertTrue(ApiKeyStatus.shouldNotify(nowMs = now, lastMs = now + hour))
    }
}
