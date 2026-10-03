package com.vernu.sms.helpers

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceHealthRowsTest {
    private val now = 10_000_000L
    private val allGood = DeviceHealthSnapshot(
        hasSendSmsPermission = true, hasReceiveSmsPermission = true, hasReadPhoneStatePermission = true,
        hasPostNotificationsPermission = true, stickyNotificationEnabled = true, usingLegacyUi = false,
    )

    private fun inputs(snapshot: DeviceHealthSnapshot = allGood, battery: Boolean? = true, lastHeartbeat: Long? = now - 60_000) =
        HealthInputs(snapshot, battery, powerSaveMode = false, deviceIdleMode = false, sendDelaySeconds = 5,
            lastHeartbeatMs = lastHeartbeat, nowMs = now, manufacturer = "Google", gatewayEnabled = true)

    @Test
    fun aHealthyPhoneHasNoIssues() {
        val rows = DeviceHealthRows.build(inputs())
        assertEquals(0, DeviceHealthRows.issueCount(rows))
        assertNull(rows.find { it.id == "oem" })
    }

    @Test
    fun missingSmsPermissionIsRedAndNamed() {
        val rows = DeviceHealthRows.build(inputs(allGood.copy(hasReceiveSmsPermission = false)))
        val sms = rows.first { it.id == "sms" }
        assertEquals(HealthStatus.RED, sms.status)
        assertTrue(sms.detail.contains("Receive SMS"))
        assertEquals(HealthAction.GRANT_SMS, sms.action)
    }

    @Test
    fun missingSendSmsOnAndroid15MentionsRestrictedSettings() {
        val noSend = allGood.copy(hasSendSmsPermission = false)
        assertTrue(DeviceHealthRows.build(inputs(noSend).copy(sdkInt = 35)).first { it.id == "sms" }.detail.contains("restricted settings"))
        assertFalse(DeviceHealthRows.build(inputs(noSend).copy(sdkInt = 34)).first { it.id == "sms" }.detail.contains("restricted settings"))
    }

    @Test
    fun batteryAndStickyAreAmberIssues() {
        val rows = DeviceHealthRows.build(inputs(allGood.copy(stickyNotificationEnabled = false), battery = false))
        assertEquals(2, DeviceHealthRows.issueCount(rows))
        assertEquals(HealthAction.OPEN_BATTERY_SETTINGS, rows.first { it.id == "battery" }.action)
        assertEquals(HealthAction.TOGGLE_STICKY, rows.first { it.id == "sticky" }.action)
    }

    @Test
    fun sendDelayUsesThePlaybookNumbers() {
        assertEquals(
            "At 5 seconds, about 12 messages a minute. 500 recipients takes 41 minutes.",
            DeviceHealthRows.sendDelayRow(5).detail,
        )
        assertEquals(HealthStatus.AMBER, DeviceHealthRows.sendDelayRow(0).status)
    }

    @Test
    fun heartbeatAgesFromGreenToRed() {
        assertEquals(HealthStatus.GREEN, DeviceHealthRows.heartbeatRow(now - 10 * 60_000, now, true).status)
        assertEquals(HealthStatus.AMBER, DeviceHealthRows.heartbeatRow(now - 2 * 3_600_000, now, true).status)
        assertEquals(HealthStatus.RED, DeviceHealthRows.heartbeatRow(now - 5 * 3_600_000, now, true).status)
        assertEquals(HealthStatus.RED, DeviceHealthRows.heartbeatRow(null, now, true).status)
    }

    @Test
    fun heartbeatRowOffersAManualSendAndSaysNothingAboutReporting() {
        val never = DeviceHealthRows.heartbeatRow(null, now, true)
        assertEquals("Heartbeat", never.title)
        assertEquals(HealthAction.SEND_HEARTBEAT, never.action)
        assertEquals("Send heartbeat", never.actionLabel)
        assertEquals("Never. Send one to check the connection.", never.detail)

        // the gateway being off is the user's own choice, so no action and no issue
        val off = DeviceHealthRows.heartbeatRow(null, now, false)
        assertEquals(HealthAction.NONE, off.action)
        assertEquals(false, off.countsAsIssue)
    }

    @Test
    fun stickyOnWithoutReceivePermissionIsNotReportedAsRunning() {
        val rows = DeviceHealthRows.build(inputs(allGood.copy(hasReceiveSmsPermission = false)))
        assertEquals(HealthStatus.AMBER, rows.first { it.id == "sticky" }.status)
    }

    @Test
    fun futureHeartbeatIsNotGreen() {
        assertEquals(HealthStatus.AMBER, DeviceHealthRows.heartbeatRow(now + 60_000, now, true).status)
    }

    @Test
    fun knownPhoneMakersGetTips() {
        val rows = DeviceHealthRows.build(inputs().copy(manufacturer = "samsung"))
        val oem = rows.first { it.id == "oem" }
        assertEquals("Tips for Samsung phones", oem.title)
        assertEquals(HealthAction.OPEN_APP_SETTINGS, oem.action)
        assertEquals(0, DeviceHealthRows.issueCount(rows))
    }

    @Test
    fun durationsReadNaturally() {
        assertEquals("under a minute", DeviceHealthRows.formatDuration(30_000))
        assertEquals("1 minute", DeviceHealthRows.formatDuration(60_000))
        assertEquals("1 hour 30 min", DeviceHealthRows.formatDuration(90 * 60_000))
        assertEquals("2 hours", DeviceHealthRows.formatDuration(120 * 60_000))
    }
}
