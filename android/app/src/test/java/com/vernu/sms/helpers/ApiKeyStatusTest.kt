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
    fun onlyAReplyMadeWithTheCurrentKeyCounts() {
        assertTrue(ApiKeyStatus.isCurrentKey("key", "key"))
        assertFalse(ApiKeyStatus.isCurrentKey("old", "new"))
        assertFalse(ApiKeyStatus.isCurrentKey("old", ""))
        assertFalse(ApiKeyStatus.isCurrentKey("", ""))
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

    private val none = ApiKeyStatus.Mark(0L, null)

    // One reply with the key stored now, as record applies it
    private fun reply(mark: ApiKeyStatus.Mark, code: Int, key: String = "key", current: String = key) =
        ApiKeyStatus.nextMark(code, key, current, mark, now) ?: mark

    private fun refuses(mark: ApiKeyStatus.Mark, current: String = "key") =
        ApiKeyStatus.refusesSend(true, mark, current)

    @Test
    fun a401ForTheCurrentKeyRefusesSending() {
        val mark = reply(none, 401)
        assertEquals(now, mark.atMs)
        assertTrue(refuses(mark))
    }

    @Test
    fun aSuccessAfterA401ResumesSending() {
        for (code in listOf(200, 201, 204, 299)) {
            val mark = reply(reply(none, 401), code)
            assertEquals("http $code", none, mark)
            assertFalse("http $code", refuses(mark))
        }
    }

    @Test
    fun aNewKeyIsNeverRefusedForTheOldKeysMark() {
        val mark = reply(none, 401, key = "old")
        assertTrue(refuses(mark, current = "old"))
        assertFalse(refuses(mark, current = "new"))
        assertFalse(refuses(mark, current = ""))
        // A late reply for the old key changes nothing for the new one
        assertEquals(mark, reply(mark, 401, key = "old", current = "new"))
        assertFalse(refuses(reply(mark, 401, key = "old", current = "new"), current = "new"))
    }

    @Test
    fun theNewKeysOwn401MarksIt() {
        val mark = reply(reply(none, 401, key = "old"), 401, key = "new")
        assertTrue(refuses(mark, current = "new"))
        assertFalse(refuses(mark, current = "old"))
    }

    @Test
    fun otherAnswersNeverMarkTheKey() {
        // 0 and -1 stand for no answer at all
        for (code in listOf(-1, 0, 300, 400, 403, 404, 429, 500, 502, 503)) {
            val mark = reply(none, code)
            assertEquals("http $code", none, mark)
            assertFalse("http $code", refuses(mark))
        }
    }

    @Test
    fun otherAnswersAfterA401KeepRefusing() {
        for (code in listOf(-1, 0, 403, 429, 500)) {
            assertTrue("http $code", refuses(reply(reply(none, 401), code)))
        }
    }

    @Test
    fun aClearedMarkResumesSending() {
        assertFalse(refuses(none))
    }

    @Test
    fun aMarkFromAnOlderBuildHasNoKeyAndRefusesNothing() {
        val legacy = ApiKeyStatus.Mark(now - hour, null)
        assertFalse(refuses(legacy))
        // The next 401 ties it to the key and keeps the first time
        val tied = reply(legacy, 401)
        assertEquals(now - hour, tied.atMs)
        assertTrue(refuses(tied))
    }

    @Test
    fun theServerSwitchOffKeepsSending() {
        assertFalse(ApiKeyStatus.refusesSend(false, reply(none, 401), "key"))
    }

    @Test
    fun theHashIsTheSha256OfTheKey() {
        assertEquals(
            "2c70e12b7a0646f92279f427c7b38e7334d8e5389cff167a1dc30e73f826b683",
            ApiKeyStatus.hashOf("key"),
        )
        assertFalse(ApiKeyStatus.hashOf("key") == ApiKeyStatus.hashOf("key2"))
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
