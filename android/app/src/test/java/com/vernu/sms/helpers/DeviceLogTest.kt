package com.vernu.sms.helpers

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DeviceLogTest {
    @Test
    fun masksPhoneNumbersButKeepsTheLastFourDigits() {
        assertEquals("sent to …0142", DeviceLog.redact("sent to +15550100142"))
        assertEquals("from …0142", DeviceLog.redact("from +1 (555) 010-0142"))
        assertEquals("to …0142", DeviceLog.redact("to 555-010-0142"))
        assertEquals("code 4 attempt 3", DeviceLog.redact("code 4 attempt 3"))
        assertEquals("version 2.9.0 (20)", DeviceLog.redact("version 2.9.0 (20)"))
        assertEquals("id …7890 and …4321", DeviceLog.redact("id 1234567890 and 09876554321"))
    }

    @Test
    fun keepsOnlyTheNewestEntries() {
        val max = DeviceConfig.DEVICE_LOG_MAX_ENTRIES.default
        val many = (1..max + 20).map { LogEntry(it.toLong(), "e", "", null) }
        val kept = DeviceLog.trim(many, nowMs = max.toLong())
        assertEquals(max, kept.size)
        assertEquals(21L, kept.first().timeMs)
    }

    @Test
    fun aNewLimitAppliesToTheNextTrimWithoutARestart() {
        val many = (1..2_000).map { LogEntry(it.toLong(), "e", "", null) }
        try {
            DeviceLog.useMaxEntries(500)
            assertEquals(500, DeviceLog.maxEntriesInUse)
            assertEquals(500, DeviceLog.trim(many, nowMs = 2_000L).size)

            DeviceLog.useMaxEntries(100)
            assertEquals(500, DeviceLog.maxEntriesInUse)
            DeviceLog.useMaxEntries(50_000)
            assertEquals(20_000, DeviceLog.maxEntriesInUse)
        } finally {
            DeviceLog.useMaxEntries(DeviceConfig.DEVICE_LOG_MAX_ENTRIES.default)
        }
    }

    @Test
    fun aSmallerLimitDropsTheOldestEntries() {
        val many = (1..2_000).map { LogEntry(it.toLong(), "e", "", null) }
        val kept = DeviceLog.trim(many, nowMs = 2_000L, maxEntries = 500)
        assertEquals(500, kept.size)
        assertEquals(1_501L, kept.first().timeMs)
        assertEquals(2_000L, kept.last().timeMs)
    }

    @Test
    fun dropsEntriesOlderThanTheMaxAge() {
        val now = DeviceLog.MAX_AGE_MS * 2
        val entries = listOf(now - DeviceLog.MAX_AGE_MS - 1, now - DeviceLog.MAX_AGE_MS, now)
            .map { LogEntry(it, "e", "", null) }
        val kept = DeviceLog.trim(entries, nowMs = now)
        assertEquals(listOf(now - DeviceLog.MAX_AGE_MS, now), kept.map { it.timeMs })
    }

    @Test
    fun keepsTheListWhenNothingIsTrimmed() {
        val entries = listOf(LogEntry(10L, "e", "", null), LogEntry(20L, "e", "", null))
        assertEquals(entries, DeviceLog.trim(entries, nowMs = 20L))
    }

    @Test
    fun linesRoundTripAndTabsAreFlattened() {
        val entry = LogEntry(1700000000000L, "send_attempted", "delay 5s\tsim 1", "abc123")
        val parsed = DeviceLog.parseLine(DeviceLog.formatLine(entry))
        assertEquals(entry.copy(detail = "delay 5s sim 1"), parsed)
        assertNull(DeviceLog.parseLine("garbage"))
        assertEquals(null, DeviceLog.parseLine("1\tevent\t\t")?.smsId)
    }
}
