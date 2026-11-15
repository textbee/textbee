package com.vernu.sms.helpers

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.vernu.sms.dtos.HeartbeatInputDTO
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NoticesTest {
    private fun parse(json: String) = Notices.parse(JsonParser.parseString(json))

    private fun parseList(json: String) = Notices.parseList(JsonParser.parseString(json))

    private fun ids(notices: List<AppNotice>) = notices.map { it.id }

    private val full = AppNotice(
        "n1", NoticeLevel.WARNING, "Hello", "Heads up", "Open", NoticeAction.Web("https://example.com"),
        dismissible = false, maxAgeHours = 24, notify = true,
    )

    private fun notice(id: String, dismissible: Boolean = true, maxAgeHours: Int? = null) =
        AppNotice(id, NoticeLevel.INFO, "Text $id", dismissible = dismissible, maxAgeHours = maxAgeHours)

    @Test
    fun aFullNoticeIsRead() {
        assertEquals(full, parse("""{"id":"n1","level":"warning","title":"Heads up","text":"Hello","actionLabel":"Open","actionUrl":"https://example.com","dismissible":false,"maxAgeHours":24,"notify":true}"""))
    }

    @Test
    fun aMinimalNoticeTakesEveryDefault() {
        assertEquals(AppNotice("n1", NoticeLevel.INFO, "Hello"), parse("""{"id":"n1","text":"Hello"}"""))
        val minimal = parse("""{"id":"n1","text":"Hello"}""")!!
        assertNull(minimal.title)
        assertNull(minimal.actionLabel)
        assertNull(minimal.action)
        assertTrue(minimal.dismissible)
        assertNull(minimal.maxAgeHours)
        assertFalse(minimal.notify)
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
    fun anIdOver64CharactersDropsTheNotice() {
        assertEquals("a".repeat(64), parse("""{"id":"${"a".repeat(64)}","text":"Hello"}""")!!.id)
        assertNull(parse("""{"id":"${"a".repeat(65)}","text":"Hello"}"""))
        // Trimmed before the length check
        assertEquals("a".repeat(64), parse("""{"id":" ${"a".repeat(64)} ","text":"Hello"}""")!!.id)
    }

    @Test
    fun longTextIsCutTo500() {
        assertEquals("a".repeat(500), parse("""{"id":"n1","text":"${"a".repeat(600)}"}""")!!.text)
        assertEquals(500, parse("""{"id":"n1","text":"${"b".repeat(500)}"}""")!!.text.length)
    }

    @Test
    fun aTitleIsTrimmedAndCutTo80() {
        assertEquals("Hi", parse("""{"id":"n1","text":"Hello","title":"  Hi  "}""")!!.title)
        assertEquals("t".repeat(80), parse("""{"id":"n1","text":"Hello","title":"${"t".repeat(100)}"}""")!!.title)
    }

    @Test
    fun aBadTitleMeansNoTitle() {
        for (title in listOf("", ",\"title\":\"\"", ",\"title\":\"  \"", ",\"title\":5", ",\"title\":null", ",\"title\":[\"Hi\"]")) {
            val notice = parse("""{"id":"n1","text":"Hello"$title}""")!!
            assertNull(title, notice.title)
            assertEquals(title, "Hello", notice.text)
        }
    }

    @Test
    fun theLevelIsInfoUnlessWarningOrError() {
        for (level in listOf("", ",\"level\":\"WARNING\"", ",\"level\":\"Error\"", ",\"level\":3", ",\"level\":\"info\"", ",\"level\":\"critical\"")) {
            assertEquals(level, NoticeLevel.INFO, parse("""{"id":"n1","text":"Hello"$level}""")!!.level)
        }
        assertEquals(NoticeLevel.WARNING, parse("""{"id":"n1","text":"Hello","level":"warning"}""")!!.level)
        assertEquals(NoticeLevel.ERROR, parse("""{"id":"n1","text":"Hello","level":"error"}""")!!.level)
    }

    @Test
    fun theButtonNeedsALabelAndAKnownLink() {
        for (action in listOf(
            "",
            ",\"actionLabel\":\"Open\"",
            ",\"actionUrl\":\"https://example.com\"",
            ",\"actionUrl\":\"textbee://device-health\"",
            ",\"actionLabel\":\"Open\",\"actionUrl\":\"http://example.com\"",
            ",\"actionLabel\":\"Open\",\"actionUrl\":\"HTTP://example.com\"",
            ",\"actionLabel\":\"Open\",\"actionUrl\":\"HTTPS://example.com\"",
            ",\"actionLabel\":\"Open\",\"actionUrl\":\"javascript:alert(1)\"",
            ",\"actionLabel\":\"Open\",\"actionUrl\":\"market://details?id=com.vernu.sms\"",
            ",\"actionLabel\":\"Open\",\"actionUrl\":\"intent://scan#Intent;end\"",
            ",\"actionLabel\":\"Open\",\"actionUrl\":\"textbee://nothing\"",
            ",\"actionLabel\":\"Open\",\"actionUrl\":\"textbee://device-health/\"",
            ",\"actionLabel\":\"Open\",\"actionUrl\":\"TEXTBEE://device-health\"",
            ",\"actionLabel\":\"Open\",\"actionUrl\":5",
            ",\"actionLabel\":\"\",\"actionUrl\":\"https://example.com\"",
            ",\"actionLabel\":5,\"actionUrl\":\"https://example.com\"",
        )) {
            val notice = parse("""{"id":"n1","text":"Hello"$action}""")!!
            assertEquals(action, "Hello", notice.text)
            assertNull(action, notice.actionLabel)
            assertNull(action, notice.action)
        }
    }

    @Test
    fun eachAppLinkIsRead() {
        val links = mapOf(
            "textbee://device-health" to NoticeAction.DeviceHealth,
            "textbee://add-api-key" to NoticeAction.AddApiKey,
            "textbee://battery-settings" to NoticeAction.BatterySettings,
            "https://textbee.dev/download" to NoticeAction.Web("https://textbee.dev/download"),
        )
        for ((url, expected) in links) {
            val notice = parse("""{"id":"n1","text":"Hello","actionLabel":"Open","actionUrl":"$url"}""")!!
            assertEquals(url, expected, notice.action)
            assertEquals(url, "Open", notice.actionLabel)
            assertEquals(url, notice.action!!.url)
        }
    }

    @Test
    fun theCutNeverSplitsAnEmoji() {
        // The emoji takes units 499 and 500, so the cut drops it whole
        val text = "a".repeat(499) + "😀" + "b"
        assertEquals("a".repeat(499), parse(noticeJson(text))!!.text)
        // An emoji that ends at the cut stays
        val fits = "a".repeat(498) + "😀" + "b"
        assertEquals("a".repeat(498) + "😀", parse(noticeJson(fits))!!.text)
        assertEquals("ab", Notices.cut("ab", 5))
    }

    private fun noticeJson(text: String) =
        JsonObject().apply { addProperty("id", "n1"); addProperty("text", text) }.toString()

    @Test
    fun theTitleAndLabelCutsNeverSplitAnEmoji() {
        val emoji = "\uD83D\uDE00"
        fun with(title: String, label: String) = JsonObject().apply {
            addProperty("id", "n1"); addProperty("text", "Hello"); addProperty("title", title)
            addProperty("actionLabel", label); addProperty("actionUrl", "https://example.com")
        }.toString()
        val split = parse(with("t".repeat(79) + emoji + "x", "l".repeat(39) + emoji + "x"))!!
        assertEquals("t".repeat(79), split.title)
        assertEquals("l".repeat(39), split.actionLabel)
        val fits = parse(with("t".repeat(78) + emoji + "x", "l".repeat(38) + emoji + "x"))!!
        assertEquals("t".repeat(78) + emoji, fits.title)
        assertEquals("l".repeat(38) + emoji, fits.actionLabel)
    }

    @Test
    fun aLinkOver2048CharactersMeansNoButton() {
        fun withUrl(length: Int): AppNotice {
            val url = "https://example.com/" + "a".repeat(length - 20)
            assertEquals(length, url.length)
            return parse("""{"id":"n1","text":"Hello","actionLabel":"Open","actionUrl":"$url"}""")!!
        }
        assertEquals(2048, withUrl(2048).action!!.url.length)
        assertEquals("Open", withUrl(2048).actionLabel)
        val long = withUrl(2049)
        assertNull(long.action)
        assertNull(long.actionLabel)
        assertEquals("Hello", long.text)
    }

    @Test
    fun aLongLabelIsCutTo40() {
        val notice = parse("""{"id":"n1","text":"Hello","actionLabel":"${"x".repeat(50)}","actionUrl":"https://example.com"}""")!!
        assertEquals("x".repeat(40), notice.actionLabel)
    }

    @Test
    fun aMissingOrWrongDismissibleIsTrue() {
        for (value in listOf("", ",\"dismissible\":\"false\"", ",\"dismissible\":0", ",\"dismissible\":null")) {
            assertTrue(value, parse("""{"id":"n1","text":"Hello"$value}""")!!.dismissible)
        }
        assertFalse(parse("""{"id":"n1","text":"Hello","dismissible":false}""")!!.dismissible)
    }

    @Test
    fun aMissingOrWrongNotifyIsFalse() {
        for (value in listOf("", ",\"notify\":\"true\"", ",\"notify\":1", ",\"notify\":null", ",\"notify\":false")) {
            assertFalse(value, parse("""{"id":"n1","text":"Hello"$value}""")!!.notify)
        }
        assertTrue(parse("""{"id":"n1","text":"Hello","notify":true}""")!!.notify)
    }

    @Test
    fun maxAgeHoursIsAWholeNumberFrom1To8760() {
        fun maxAge(value: String) = parse("""{"id":"n1","text":"Hello","maxAgeHours":$value}""")!!.maxAgeHours
        assertEquals(1, maxAge("1"))
        assertEquals(24, maxAge("24"))
        assertEquals(24, maxAge("24.0"))
        assertEquals(8760, maxAge("8760"))
        // Above the cap becomes the cap, even past the Int range
        assertEquals(8760, maxAge("8761"))
        assertEquals(8760, maxAge("99999999999999999999"))
        // No limit
        for (value in listOf("0", "-1", "-99999999999999999999", "1.5", "0.5", "\"24\"", "true", "null", "[24]", "{}")) {
            assertNull(value, maxAge(value))
        }
        assertNull(parse("""{"id":"n1","text":"Hello"}""")!!.maxAgeHours)
    }

    // Compared before any conversion, so a huge exponent or a long digit string returns fast
    @Test(timeout = 2_000)
    fun maxAgeHoursHandlesExtremeNumbersFast() {
        fun maxAge(value: String) = parse("""{"id":"n1","text":"Hello","maxAgeHours":$value}""")!!.maxAgeHours
        assertEquals(8760, maxAge("1e20000000"))
        assertEquals(1000, maxAge("1e3"))
        assertEquals(24, maxAge("2.4e1"))
        assertNull(maxAge("1e-20000000"))
        assertNull(maxAge("-1e20000000"))
        assertEquals(8760, maxAge("9".repeat(32)))
        assertEquals(12, maxAge("12." + "0".repeat(29)))
        assertNull(maxAge("12." + "0".repeat(28) + "1"))
        // A number over 32 characters is not read
        assertNull(maxAge("9".repeat(33)))
        assertNull(maxAge("12." + "0".repeat(30)))
        assertNull(maxAge("9".repeat(1_000)))
        // Gson reads a number literal over about 1024 characters as a string
        assertNull(maxAge("9".repeat(200_000)))
        // Not whole wins over the cap
        assertNull(maxAge("8760.5"))
        assertNull(maxAge("9999.5"))
    }

    @Test
    fun aListThatIsNotAnArrayIsEmpty() {
        assertEquals(emptyList<AppNotice>(), Notices.parseList(null))
        for (value in listOf("null", "\"text\"", "5", "true", "{}", """{"id":"n1","text":"Hello"}""")) {
            assertEquals(value, emptyList<AppNotice>(), parseList(value))
        }
        assertEquals(emptyList<AppNotice>(), parseList("[]"))
    }

    @Test
    fun onlyTheFirst10ElementsAreRead() {
        val elements = (1..11).joinToString(",") { """{"id":"n$it","text":"Hello"}""" }
        assertEquals((1..10).map { "n$it" }, ids(parseList("[$elements]")))
    }

    @Test
    fun anInvalidElementCountsTowardsThe10() {
        val elements = listOf("5", """{"id":"n1"}""") + (2..11).map { """{"id":"n$it","text":"Hello"}""" }
        assertEquals((2..9).map { "n$it" }, ids(parseList(elements.joinToString(",", "[", "]"))))
    }

    @Test
    fun anInvalidElementIsDroppedAndTheRestStay() {
        val list = parseList("""[{"id":"a","text":"A"},null,{"id":"b"},{"id":"${"x".repeat(65)}","text":"X"},"text",{"id":"c","text":"C","level":"nope"}]""")
        assertEquals(listOf("a", "c"), ids(list))
        assertEquals(NoticeLevel.INFO, list[1].level)
    }

    @Test
    fun anInvalidElementDoesNotTakeItsIdFromALaterValidOne() {
        val list = parseList("""[{"id":"a"},{"id":"a","text":"Valid"}]""")
        assertEquals(listOf("a"), ids(list))
        assertEquals("Valid", list[0].text)
    }

    @Test
    fun aRepeatedIdKeepsTheFirst() {
        val list = parseList("""[{"id":"a","text":"First"},{"id":"b","text":"B"},{"id":" a ","text":"Second"}]""")
        assertEquals(listOf("a", "b"), ids(list))
        assertEquals("First", list[0].text)
    }

    @Test
    fun unknownFieldsAreIgnored() {
        assertEquals(AppNotice("n1", NoticeLevel.INFO, "Hello"), parse("""{"id":"n1","text":"Hello","color":"blue","extra":{"a":[1]}}"""))
    }

    @Test
    fun theStoredFormReadsBackTheSame() {
        val list = listOf(
            full,
            AppNotice("n2", NoticeLevel.INFO, "Plain"),
            AppNotice("n3", NoticeLevel.ERROR, "App link", actionLabel = "Check", action = NoticeAction.BatterySettings),
        )
        assertEquals(list, Notices.fromJson(Notices.listToJson(list)))
        assertEquals(emptyList<AppNotice>(), Notices.fromJson(Notices.listToJson(emptyList())))
        assertEquals(emptyList<AppNotice>(), Notices.fromJson(null))
        assertEquals(emptyList<AppNotice>(), Notices.fromJson(""))
        assertEquals(emptyList<AppNotice>(), Notices.fromJson("{not json"))
    }

    @Test
    fun anOldSingleNoticeInStorageReadsAsEmpty() {
        val old = """{"id":"n1","level":"warning","text":"Hello","actionLabel":"Open","actionUrl":"https://example.com","dismissible":true}"""
        assertEquals(emptyList<AppNotice>(), Notices.fromJson(old))
        assertEquals(emptyList<AppNotice>(), Notices.storedOf(old, 22, 22))
    }

    @Test
    fun aBuildChangeEmptiesTheStoredList() {
        val json = Notices.listToJson(listOf(notice("a"), notice("b")))
        assertEquals(listOf("a", "b"), ids(Notices.storedOf(json, 22, 22)))
        assertEquals(emptyList<AppNotice>(), Notices.storedOf(json, 22, 23))
        assertEquals(emptyList<AppNotice>(), Notices.storedOf(json, 23, 22))
        // No saved build means another build saved it
        assertEquals(emptyList<AppNotice>(), Notices.storedOf(json, 0, 22))
    }

    @Test
    fun visibleDropsClosedAndExpiredAndShowsTheFirst3() {
        val hour = 3_600_000L
        val stored = listOf(
            notice("closed"),
            notice("fixed", dismissible = false),
            notice("expired", maxAgeHours = 1),
            notice("young", maxAgeHours = 3),
            notice("plain"),
            notice("fourth"),
        )
        val visible = Notices.visibleOf(stored, listOf("closed", "fixed"), savedAt = 0L, now = 2 * hour)
        // One that cannot be closed shows even with its id in the closed list
        assertEquals(listOf("fixed", "young", "plain"), ids(visible))
        assertEquals(emptyList<AppNotice>(), Notices.visibleOf(emptyList(), emptyList(), 0L, 0L))
    }

    @Test
    fun maxAgeEdgeCases() {
        val hour = 3_600_000L
        val oneHour = notice("a", maxAgeHours = 1)
        val savedAt = 1_700_000_000_000L
        // Exactly at the limit still shows
        assertFalse(Notices.isExpired(oneHour, savedAt, savedAt + hour))
        assertTrue(Notices.isExpired(oneHour, savedAt, savedAt + hour + 1))
        // A clock moved back counts as age 0
        assertFalse(Notices.isExpired(oneHour, savedAt, savedAt - 365 * 24 * hour))
        // No limit never expires
        assertFalse(Notices.isExpired(notice("b"), savedAt, savedAt + 100 * 365 * 24 * hour))
        // The clamped maximum
        val capped = parse("""{"id":"c","text":"C","maxAgeHours":100000}""")!!
        assertFalse(Notices.isExpired(capped, savedAt, savedAt + 8760 * hour))
        assertTrue(Notices.isExpired(capped, savedAt, savedAt + 8760 * hour + 1))
        // No saved time with a limit reads as expired
        assertTrue(Notices.isExpired(oneHour, 0L, savedAt))
    }

    @Test
    fun closingANewNoticeKeepsTheOldOneClosed() {
        val stored = listOf(notice("A"), notice("B"))
        val closed = Notices.closedAfter(Notices.closedAfter(emptyList(), "A"), "B")
        assertEquals(emptyList<AppNotice>(), Notices.visibleOf(stored, closed, 0L, 0L))
        // A new id shows again
        assertEquals(listOf("C"), ids(Notices.visibleOf(listOf(notice("C")), closed, 0L, 0L)))
    }

    @Test
    fun onlyTheLast50ClosedIdsAreKept() {
        var closed = emptyList<String>()
        for (i in 1..51) closed = Notices.closedAfter(closed, "n$i")
        assertEquals((2..51).map { "n$it" }, closed)
        // Closing one again moves it to the end, with no copy
        assertEquals((3..51).map { "n$it" } + "n2", Notices.closedAfter(closed, "n2"))
    }

    @Test
    fun theClosedIdsReadBackTheSame() {
        val ids = listOf("A", "B \"quoted\"", "C,D")
        assertEquals(ids, Notices.idsFromJson(Notices.idsToJson(ids)))
        assertEquals(emptyList<String>(), Notices.idsFromJson(null))
        assertEquals(emptyList<String>(), Notices.idsFromJson("not json"))
        assertEquals(emptyList<String>(), Notices.idsFromJson("{}"))
    }

    @Test
    fun theHeartbeatSendsTheClosedIdsEvenWhenEmpty() {
        val empty = Gson().toJsonTree(HeartbeatInputDTO().apply { closedNoticeIds = emptyList() }).asJsonObject
        assertTrue(empty.get("closedNoticeIds").isJsonArray)
        assertEquals(0, empty.getAsJsonArray("closedNoticeIds").size())
        val two = Gson().toJson(HeartbeatInputDTO().apply { closedNoticeIds = listOf("a", "b") })
        assertTrue(two.contains("\"closedNoticeIds\":[\"a\",\"b\"]"))
    }

    @Test
    fun onlyNewNoticesWithNotifyAreNotified() {
        val visible = listOf(notice("a").copy(notify = true), notice("b"), notice("c").copy(notify = true))
        assertEquals(listOf("a", "c"), ids(NoticeNotifier.toNotify(visible, emptyList())))
        assertEquals(listOf("c"), ids(NoticeNotifier.toNotify(visible, listOf("a"))))
        var notified = emptyList<String>()
        for (i in 1..51) notified = Notices.idsAfter(notified, "n$i", NoticeNotifier.MAX_NOTIFIED)
        assertEquals((2..51).map { "n$it" }, notified)
    }
}
