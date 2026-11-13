package com.vernu.sms.helpers

import com.google.gson.GsonBuilder
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.vernu.sms.dtos.ClaimMessagesResponseDTO
import com.vernu.sms.dtos.HeartbeatResponseDTO
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceConfigReadTest {
    // Writes JSON nulls, so a key set to null reaches the parser
    private val gson = GsonBuilder().serializeNulls().create()

    // The default config object from api/src/gateway/device-config.spec.ts
    private val serverDefault = """
        {
          "sendSchedulerV2Enabled": true,
          "recoveryPollEnabled": false,
          "updateNotificationsEnabled": false,
          "directUploadEnabled": false,
          "pullEnabled": false,
          "partReportsEnabled": true,
          "latestVersionCode": 18,
          "latestVersionName": "2.8.0",
          "periodicJobMinutes": 30,
          "deviceLogMaxEntries": 10000,
          "analyticsEnabled": true,
          "tuning": {
            "claimMinGapSeconds": 30,
            "directUploadRetryDelaySeconds": 30,
            "sendingMarkerYoungMinutes": 5
          }
        }
    """.trimIndent()

    // Every value differs from what its key reads as when missing
    private val distinct = """
        {
          "sendSchedulerV2Enabled": true,
          "recoveryPollEnabled": true,
          "updateNotificationsEnabled": true,
          "directUploadEnabled": true,
          "pullEnabled": true,
          "partReportsEnabled": true,
          "latestVersionCode": 22,
          "latestVersionName": "2.10.0",
          "periodicJobMinutes": 60,
          "deviceLogMaxEntries": 5000,
          "analyticsEnabled": false,
          "tuning": {
            "claimMinGapSeconds": 120,
            "directUploadRetryDelaySeconds": 60,
            "sendingMarkerYoungMinutes": 10
          }
        }
    """.trimIndent()

    private val distinctParsed = ParsedConfig(
        recoveryPollEnabled = true,
        directUploadEnabled = true,
        updateNotificationsEnabled = true,
        latestVersionCode = 22,
        latestVersionName = "2.10.0",
        pullEnabled = true,
        partReportsEnabled = true,
        periodicJobMinutes = 60,
        deviceLogMaxEntries = 5000,
        analyticsEnabled = false,
        claimMinGapSeconds = 120,
        directUploadRetryDelaySeconds = 60,
        sendingMarkerYoungMinutes = 10,
    )

    private enum class Kind { BOOLEAN, INTEGER, STRING }

    private class Key(val path: String, val kind: Kind, val missing: (ParsedConfig) -> ParsedConfig)

    private val keys = listOf(
        // Keys of released builds keep the stored value
        Key("recoveryPollEnabled", Kind.BOOLEAN) { it.copy(recoveryPollEnabled = null) },
        Key("updateNotificationsEnabled", Kind.BOOLEAN) { it.copy(updateNotificationsEnabled = null) },
        Key("directUploadEnabled", Kind.BOOLEAN) { it.copy(directUploadEnabled = null) },
        Key("latestVersionCode", Kind.INTEGER) { it.copy(latestVersionCode = null) },
        Key("latestVersionName", Kind.STRING) { it.copy(latestVersionName = null) },
        // Missing means off
        Key("pullEnabled", Kind.BOOLEAN) { it.copy(pullEnabled = false) },
        Key("partReportsEnabled", Kind.BOOLEAN) { it.copy(partReportsEnabled = false) },
        // New keys go back to the built-in default
        Key("periodicJobMinutes", Kind.INTEGER) { it.copy(periodicJobMinutes = 30) },
        Key("deviceLogMaxEntries", Kind.INTEGER) { it.copy(deviceLogMaxEntries = 10_000) },
        Key("analyticsEnabled", Kind.BOOLEAN) { it.copy(analyticsEnabled = true) },
        Key("tuning.claimMinGapSeconds", Kind.INTEGER) { it.copy(claimMinGapSeconds = 30) },
        Key("tuning.directUploadRetryDelaySeconds", Kind.INTEGER) { it.copy(directUploadRetryDelaySeconds = 30) },
        Key("tuning.sendingMarkerYoungMinutes", Kind.INTEGER) { it.copy(sendingMarkerYoungMinutes = 5) },
    )

    private val badValues = mapOf(
        Kind.BOOLEAN to listOf("\"true\"", "1", "{}", "[]", "null"),
        Kind.INTEGER to listOf("\"15\"", "22.5", "2147483648", "-2147483649", "1e10", "{}", "true", "[]", "null"),
        Kind.STRING to listOf("5", "true", "{}", "[]", "null"),
    )

    private fun json(text: String): JsonElement = JsonParser.parseString(text)

    private fun withValue(config: String, path: String, value: String?): JsonObject {
        val root = json(config).asJsonObject
        val parts = path.split('.')
        val target = if (parts.size == 2) root.getAsJsonObject(parts[0]) else root
        if (value == null) target.remove(parts.last()) else target.add(parts.last(), json(value))
        return root
    }

    private fun heartbeatReply(config: JsonElement?): HeartbeatResponseDTO {
        val reply = JsonObject().apply {
            addProperty("success", true)
            addProperty("fcmTokenUpdated", false)
            addProperty("pendingCount", 2)
            if (config != null) add("config", config)
        }
        return gson.fromJson(gson.toJson(reply), HeartbeatResponseDTO::class.java)
    }

    private fun claimReply(config: JsonElement?): ClaimMessagesResponseDTO {
        val reply = json("""{"data":[{"smsId":"m1","message":"hi","recipients":["+15555550100"]}],"more":true,"retryAfterSeconds":1.5}""")
            .asJsonObject
        if (config != null) reply.add("config", config)
        return gson.fromJson(gson.toJson(reply), ClaimMessagesResponseDTO::class.java)
    }

    // Parses the config through both reply types and checks the rest of each reply survived
    private fun parseBoth(config: JsonElement?): List<ParsedConfig> {
        val heartbeat = heartbeatReply(config)
        assertEquals(true, heartbeat.success)
        assertEquals(2, heartbeat.pendingCount)
        val claim = claimReply(config)
        assertEquals("m1", claim.data!!.single().smsId)
        assertEquals(true, claim.more)
        return listOf(DeviceConfig.parse(heartbeat.config), DeviceConfig.parse(claim.config))
    }

    @Test
    fun theRealServerReplyParses() {
        val expected = ParsedConfig(
            recoveryPollEnabled = false,
            directUploadEnabled = false,
            updateNotificationsEnabled = false,
            latestVersionCode = 18,
            latestVersionName = "2.8.0",
            pullEnabled = false,
            partReportsEnabled = true,
            periodicJobMinutes = 30,
            deviceLogMaxEntries = 10000,
            analyticsEnabled = true,
            claimMinGapSeconds = 30,
            directUploadRetryDelaySeconds = 30,
            sendingMarkerYoungMinutes = 5,
        )
        parseBoth(json(serverDefault)).forEach { assertEquals(expected, it) }
    }

    @Test
    fun everyKeyIsReadWhenValid() {
        parseBoth(json(distinct)).forEach { assertEquals(distinctParsed, it) }
    }

    @Test
    fun aBadValueInOneKeyCountsAsMissingAndKeepsTheOthers() {
        for (key in keys) {
            for (bad in badValues.getValue(key.kind)) {
                val expected = key.missing(distinctParsed)
                parseBoth(withValue(distinct, key.path, bad)).forEach {
                    assertEquals("${key.path} = $bad", expected, it)
                }
            }
        }
    }

    @Test
    fun aMissingKeyFollowsItsRule() {
        for (key in keys) {
            val expected = key.missing(distinctParsed)
            parseBoth(withValue(distinct, key.path, null)).forEach {
                assertEquals("${key.path} missing", expected, it)
            }
        }
    }

    @Test
    fun aWholeNumberWrittenWithADecimalPointIsAccepted() {
        val parsed = DeviceConfig.parse(withValue(distinct, "periodicJobMinutes", "45.0"))
        assertEquals(45, parsed.periodicJobMinutes)
    }

    @Test
    fun numbersAreClampedAtBothEnds() {
        val ranges = listOf(
            Triple("periodicJobMinutes", 15, 240),
            Triple("deviceLogMaxEntries", 500, 20_000),
            Triple("tuning.claimMinGapSeconds", 10, 300),
            Triple("tuning.directUploadRetryDelaySeconds", 30, 3600),
            Triple("tuning.sendingMarkerYoungMinutes", 3, 60),
        )
        val read: Map<String, (ParsedConfig) -> Int> = mapOf(
            "periodicJobMinutes" to { it.periodicJobMinutes },
            "deviceLogMaxEntries" to { it.deviceLogMaxEntries },
            "tuning.claimMinGapSeconds" to { it.claimMinGapSeconds },
            "tuning.directUploadRetryDelaySeconds" to { it.directUploadRetryDelaySeconds },
            "tuning.sendingMarkerYoungMinutes" to { it.sendingMarkerYoungMinutes },
        )
        for ((path, min, max) in ranges) {
            val value = read.getValue(path)
            for ((given, expected) in listOf(
                "-2147483648" to min, "0" to min, "${min - 1}" to min, "$min" to min,
                "$max" to max, "${max + 1}" to max, "2147483647" to max,
            )) {
                parseBoth(withValue(distinct, path, given)).forEach {
                    assertEquals("$path = $given", expected, value(it))
                }
            }
        }
    }

    @Test
    fun aMissingTuningObjectGivesTheTuningDefaults() {
        val defaults = distinctParsed.copy(claimMinGapSeconds = 30, directUploadRetryDelaySeconds = 30, sendingMarkerYoungMinutes = 5)
        parseBoth(withValue(distinct, "tuning", null)).forEach { assertEquals(defaults, it) }
        for (notAnObject in listOf("null", "5", "\"x\"", "true", "[]", "[{\"claimMinGapSeconds\":60}]")) {
            parseBoth(withValue(distinct, "tuning", notAnObject)).forEach {
                assertEquals("tuning = $notAnObject", defaults, it)
            }
        }
    }

    @Test
    fun aPartlyBadTuningObjectKeepsItsGoodKeys() {
        val config = withValue(distinct, "tuning", """{"claimMinGapSeconds":"60","directUploadRetryDelaySeconds":90,"sendingMarkerYoungMinutes":2.5}""")
        parseBoth(config).forEach {
            assertEquals(30, it.claimMinGapSeconds)
            assertEquals(90, it.directUploadRetryDelaySeconds)
            assertEquals(5, it.sendingMarkerYoungMinutes)
            assertEquals(60, it.periodicJobMinutes)
        }
    }

    @Test
    fun tuningKeysAtTheTopLevelAreNotRead() {
        val config = withValue(distinct, "claimMinGapSeconds", "600")
        assertEquals(120, DeviceConfig.parse(config).claimMinGapSeconds)
    }

    @Test
    fun aHeartbeatReplyWithNoConfigTurnsPullAndPartReportsOffAndResetsNewKeys() {
        val expected = ParsedConfig(
            recoveryPollEnabled = null,
            directUploadEnabled = null,
            updateNotificationsEnabled = null,
            latestVersionCode = null,
            latestVersionName = null,
            pullEnabled = false,
            partReportsEnabled = false,
            periodicJobMinutes = 30,
            deviceLogMaxEntries = 10_000,
            analyticsEnabled = true,
            claimMinGapSeconds = 30,
            directUploadRetryDelaySeconds = 30,
            sendingMarkerYoungMinutes = 5,
        )
        // Absent, JSON null, and not an object
        assertEquals(expected, DeviceConfig.parse(heartbeatReply(null).config))
        for (notAnObject in listOf("null", "true", "5", "\"config\"", "[]", "[$distinct]")) {
            assertEquals("config = $notAnObject", expected, DeviceConfig.parse(heartbeatReply(json(notAnObject)).config))
        }
        assertEquals(expected, DeviceConfig.parse(null))
    }

    @Test
    fun aClaimReplyWithNoConfigIsNotRead() {
        assertFalse(PullClient.readsConfig(claimReply(null).config))
        for (notAnObject in listOf("null", "true", "5", "\"config\"", "[]", "[$distinct]")) {
            val claim = claimReply(json(notAnObject))
            assertEquals("m1", claim.data!!.single().smsId)
            assertFalse("config = $notAnObject", PullClient.readsConfig(claim.config))
        }
        assertTrue(PullClient.readsConfig(claimReply(json(distinct)).config))
    }

    @Test
    fun extremeNumbersCountAsMissing() {
        val huge = listOf("1e999999999", "-1e999999999", "1e-999999999", "1e9999999999", "9".repeat(5_000), "-" + "9".repeat(5_000))
        for (value in huge) {
            val config = json(distinct).asJsonObject.apply { add("latestVersionCode", json(value)) }
            assertNull(value.take(20), DeviceConfig.intOf(config, "latestVersionCode"))
        }
        val parsed = DeviceConfig.parse(withValue(distinct, "periodicJobMinutes", "1e999999999"))
        assertEquals(30, parsed.periodicJobMinutes)
    }

    // Build 22 no longer reads the old send scheduler switch; the server still sends it
    @Test
    fun theOldSchedulerKeyIsIgnoredWhateverItHolds() {
        val without = withValue(distinct, "sendSchedulerV2Enabled", null)
        assertEquals(distinctParsed, DeviceConfig.parse(without))
        for (value in listOf("true", "false", "\"true\"", "1", "{}", "[]", "null")) {
            parseBoth(withValue(distinct, "sendSchedulerV2Enabled", value)).forEach {
                assertEquals("sendSchedulerV2Enabled = $value", distinctParsed, it)
            }
        }
    }

    @Test
    fun unknownKeysAreIgnored() {
        val config = json(distinct).asJsonObject.apply {
            addProperty("someFutureKey", 7)
            add("anotherFutureKey", json("""{"nested":[1,2,3]}"""))
            getAsJsonObject("tuning").addProperty("someFutureTuning", 3)
        }
        parseBoth(config).forEach { assertEquals(distinctParsed, it) }
    }

    @Test
    fun aNoticeIsReadFromBothReplyTypes() {
        val config = withValue(distinct, "notice",
            """{"id":"n1","level":"warning","text":"Hello","actionLabel":"Open","actionUrl":"https://example.com","dismissible":true}""")
        val expected = distinctParsed.copy(notice = AppNotice("n1", NoticeLevel.WARNING, "Hello", "Open", "https://example.com", true))
        parseBoth(config).forEach { assertEquals(expected, it) }
    }

    @Test
    fun aBadNoticeMeansNoNoticeAndKeepsTheOtherKeys() {
        for (bad in listOf("null", "\"text\"", "5", "true", "[]", """{"text":"Hello"}""", """{"id":"n1"}""", """{"id":7,"text":"Hello"}""")) {
            parseBoth(withValue(distinct, "notice", bad)).forEach { assertEquals("notice = $bad", distinctParsed, it) }
        }
        // Missing, so a stored notice is cleared
        assertNull(DeviceConfig.parse(json(distinct)).notice)
        assertNull(DeviceConfig.parse(heartbeatReply(null).config).notice)
    }
}
