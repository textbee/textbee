package com.vernu.sms.helpers

import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NoticesTest {
    private fun parse(json: String) = Notices.parse(JsonParser.parseString(json))

    private val full = AppNotice("n1", NoticeLevel.WARNING, "Hello", "Open", "https://example.com", false)

    @Test
    fun aFullNoticeIsRead() {
        assertEquals(full, parse("""{"id":"n1","level":"warning","text":"Hello","actionLabel":"Open","actionUrl":"https://example.com","dismissible":false}"""))
    }

    @Test
    fun aValueThatIsNotAnObjectIsNoNotice() {
        assertNull(Notices.parse(null))
        for (value in listOf("null", "\"text\"", "5", "true", "[]", """[{"id":"n1","text":"Hello"}]""")) {
            assertNull(value, parse(value))
        }
    }

    @Test
    fun aNoticeWithNoUsableIdOrTextIsNoNotice() {
        for (json in listOf(
            """{"text":"Hello"}""", """{"id":"","text":"Hello"}""", """{"id":"  ","text":"Hello"}""",
            """{"id":5,"text":"Hello"}""", """{"id":null,"text":"Hello"}""",
            """{"id":"n1"}""", """{"id":"n1","text":""}""", """{"id":"n1","text":["Hello"]}""",
        )) {
            assertNull(json, parse(json))
        }
    }

    @Test
    fun longTextIsCutTo200() {
        val notice = parse("""{"id":"n1","text":"${"a".repeat(250)}"}""")!!
        assertEquals("a".repeat(200), notice.text)
        assertEquals(200, parse("""{"id":"n1","text":"${"b".repeat(200)}"}""")!!.text.length)
    }

    @Test
    fun anUnknownOrMissingLevelIsInfo() {
        for (level in listOf("", ",\"level\":\"error\"", ",\"level\":\"WARNING\"", ",\"level\":3", ",\"level\":\"info\"")) {
            assertEquals(level, NoticeLevel.INFO, parse("""{"id":"n1","text":"Hello"$level}""")!!.level)
        }
        assertEquals(NoticeLevel.WARNING, parse("""{"id":"n1","text":"Hello","level":"warning"}""")!!.level)
    }

    @Test
    fun theButtonNeedsALabelAndAnHttpsUrl() {
        for (action in listOf(
            "",
            ",\"actionLabel\":\"Open\"",
            ",\"actionUrl\":\"https://example.com\"",
            ",\"actionLabel\":\"Open\",\"actionUrl\":\"http://example.com\"",
            ",\"actionLabel\":\"Open\",\"actionUrl\":\"javascript:alert(1)\"",
            ",\"actionLabel\":\"Open\",\"actionUrl\":\"HTTPS://example.com\"",
            ",\"actionLabel\":\"\",\"actionUrl\":\"https://example.com\"",
            ",\"actionLabel\":5,\"actionUrl\":\"https://example.com\"",
        )) {
            val notice = parse("""{"id":"n1","text":"Hello"$action}""")!!
            assertEquals(action, "Hello", notice.text)
            assertNull(action, notice.actionLabel)
            assertNull(action, notice.actionUrl)
        }
    }

    @Test
    fun theCutNeverSplitsAnEmoji() {
        // The emoji takes units 199 and 200, so the cut drops it whole
        val text = "a".repeat(199) + "\uD83D\uDE00" + "b"
        val notice = parse(noticeJson(text))!!
        assertEquals("a".repeat(199), notice.text)
        // An emoji that ends at the cut stays
        val fits = "a".repeat(198) + "\uD83D\uDE00" + "b"
        assertEquals("a".repeat(198) + "\uD83D\uDE00", parse(noticeJson(fits))!!.text)
        assertEquals("ab", Notices.cut("ab", 5))
    }

    private fun noticeJson(text: String) =
        com.google.gson.JsonObject().apply { addProperty("id", "n1"); addProperty("text", text) }.toString()

    @Test
    fun aLongLabelIsCut() {
        val notice = parse("""{"id":"n1","text":"Hello","actionLabel":"${"x".repeat(40)}","actionUrl":"https://example.com"}""")!!
        assertEquals("x".repeat(30), notice.actionLabel)
    }

    @Test
    fun aMissingOrWrongDismissibleIsTrue() {
        for (value in listOf("", ",\"dismissible\":\"false\"", ",\"dismissible\":0", ",\"dismissible\":null")) {
            assertTrue(value, parse("""{"id":"n1","text":"Hello"$value}""")!!.dismissible)
        }
        assertFalse(parse("""{"id":"n1","text":"Hello","dismissible":false}""")!!.dismissible)
    }

    @Test
    fun theStoredFormReadsBackTheSame() {
        assertEquals(full, Notices.fromJson(Notices.toJson(full)))
        val plain = AppNotice("n2", NoticeLevel.INFO, "Plain")
        assertEquals(plain, Notices.fromJson(Notices.toJson(plain)))
        assertNull(Notices.fromJson(null))
        assertNull(Notices.fromJson(""))
        assertNull(Notices.fromJson("{not json"))
    }

    @Test
    fun visibility() {
        val closable = full.copy(dismissible = true)
        assertFalse(Notices.isVisible(null, emptyList()))
        assertFalse(Notices.isVisible(null, listOf("n1")))
        assertTrue(Notices.isVisible(closable, emptyList()))
        // Closed stays closed for the same id
        assertFalse(Notices.isVisible(closable, listOf("n1")))
        // A new id shows again
        assertTrue(Notices.isVisible(closable.copy(id = "n2"), listOf("n1")))
        // One that cannot be closed always shows
        assertTrue(Notices.isVisible(full, listOf("n1")))
    }

    @Test
    fun closingANewNoticeKeepsTheOldOneClosed() {
        val a = full.copy(id = "A", dismissible = true)
        val b = full.copy(id = "B", dismissible = true)
        val closed = Notices.closedAfter(Notices.closedAfter(emptyList(), "A"), "B")
        assertFalse(Notices.isVisible(a, closed))
        assertFalse(Notices.isVisible(b, closed))
    }

    @Test
    fun onlyTheLastTenClosedIdsAreKept() {
        var closed = emptyList<String>()
        for (i in 1..11) closed = Notices.closedAfter(closed, "n$i")
        assertEquals((2..11).map { "n$it" }, closed)
        // Closing one again moves it to the end, with no copy
        assertEquals((3..11).map { "n$it" } + "n2", Notices.closedAfter(closed, "n2"))
    }

    @Test
    fun theClosedIdsReadBackTheSame() {
        val ids = listOf("A", "B \"quoted\"", "C,D")
        assertEquals(ids, Notices.closedIdsFromJson(Notices.closedIdsToJson(ids)))
        assertEquals(emptyList<String>(), Notices.closedIdsFromJson(null))
        assertEquals(emptyList<String>(), Notices.closedIdsFromJson("not json"))
        assertEquals(emptyList<String>(), Notices.closedIdsFromJson("{}"))
    }
}
