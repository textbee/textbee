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
            lastHeartbeatMs = lastHeartbeat, nowMs = now, manufacturer = "Google", gatewayEnabled = true,
            periodMinutes = 30)

    @Test
    fun aHealthyPhoneHasNoIssues() {
        val rows = DeviceHealthRows.build(inputs())
        assertEquals(0, DeviceHealthRows.issueCount(rows))
        assertNull(rows.find { it.id == "oem" })
    }

    @Test
    fun missingReceiveSmsIsRedOnlyWhileReceiveIsOn() {
        val noReceive = allGood.copy(hasReceiveSmsPermission = false)
        val on = DeviceHealthRows.build(inputs(noReceive).copy(receiveSmsEnabled = true)).first { it.id == "permission_receive_sms" }
        assertEquals(HealthStatus.RED, on.status)
        assertEquals("Not allowed. textbee cannot receive SMS.", on.detail)
        assertEquals(HealthAction.GRANT_SMS, on.action)
        assertTrue(on.countsAsIssue)

        val off = DeviceHealthRows.build(inputs(noReceive)).first { it.id == "permission_receive_sms" }
        assertEquals(HealthStatus.AMBER, off.status)
        assertEquals("Not allowed. Needed only when receive SMS is on.", off.detail)
        assertEquals(HealthAction.GRANT_SMS, off.action)
        assertFalse(off.countsAsIssue)
    }

    @Test
    fun everyPermissionHasItsOwnRow() {
        val rows = DeviceHealthRows.build(inputs())
        listOf("permission_send_sms" to "Send SMS", "permission_receive_sms" to "Receive SMS",
            "permission_phone_state" to "Phone state", "permission_notifications" to "Notifications").forEach { (id, title) ->
            val row = rows.first { it.id == id }
            assertEquals(title, row.title)
            assertEquals("Allowed", row.detail)
            assertEquals(HealthStatus.GREEN, row.status)
            assertEquals(HealthAction.NONE, row.action)
        }
        assertNull(rows.find { it.id == "sms" })
    }

    @Test
    fun eachMissingPermissionHasItsOwnFix() {
        val none = allGood.copy(hasSendSmsPermission = false, hasReceiveSmsPermission = false,
            hasReadPhoneStatePermission = false, hasPostNotificationsPermission = false)
        val rows = DeviceHealthRows.build(inputs(none))
        assertEquals(HealthAction.GRANT_SMS, rows.first { it.id == "permission_send_sms" }.action)
        assertEquals(HealthAction.GRANT_SMS, rows.first { it.id == "permission_receive_sms" }.action)
        assertEquals(HealthAction.GRANT_PHONE_STATE, rows.first { it.id == "permission_phone_state" }.action)
        assertEquals(HealthAction.GRANT_NOTIFICATIONS, rows.first { it.id == "permission_notifications" }.action)
        rows.filter { it.id.startsWith("permission_") }.forEach { assertEquals("Allow", it.actionLabel) }
        // Only Send SMS is red with receive SMS off
        assertEquals(1, DeviceHealthRows.issueCount(rows))
    }

    @Test
    fun missingSendSmsOnAndroid15MentionsRestrictedSettings() {
        val noSend = allGood.copy(hasSendSmsPermission = false)
        val row35 = DeviceHealthRows.build(inputs(noSend).copy(sdkInt = 35)).first { it.id == "permission_send_sms" }
        assertTrue(row35.detail.startsWith("Not allowed. textbee cannot send SMS."))
        assertTrue(row35.detail.contains("restricted settings"))
        assertEquals("Not allowed. textbee cannot send SMS.",
            DeviceHealthRows.build(inputs(noSend).copy(sdkInt = 34)).first { it.id == "permission_send_sms" }.detail)
    }

    // Every combination of the four permissions, with receive SMS on and off
    @Test
    fun permissionItemsCoverEveryCombination() {
        for (mask in 0 until 16) {
            for (receiveOn in listOf(true, false)) {
                val send = mask and 1 != 0
                val receive = mask and 2 != 0
                val phone = mask and 4 != 0
                val notifications = mask and 8 != 0
                val snapshot = allGood.copy(hasSendSmsPermission = send, hasReceiveSmsPermission = receive,
                    hasReadPhoneStatePermission = phone, hasPostNotificationsPermission = notifications)
                val label = "send=$send receive=$receive phone=$phone notifications=$notifications receiveOn=$receiveOn"
                val items = DeviceHealthRows.permissionItems(snapshot, receiveOn)
                assertEquals(label, listOf(AppPermission.SEND_SMS, AppPermission.RECEIVE_SMS, AppPermission.PHONE_STATE,
                    AppPermission.NOTIFICATIONS), items.map { it.permission })

                fun check(item: PermissionItem, granted: Boolean, status: HealthStatus, detail: String, home: HomeCard) {
                    assertEquals(label, granted, item.granted)
                    assertEquals(label, if (granted) HealthStatus.GREEN else status, item.status)
                    assertEquals(label, if (granted) "Allowed" else detail, item.detail)
                    assertEquals(label, if (granted) HomeCard.NONE else home, item.homeCard)
                }
                check(items[0], send, HealthStatus.RED, "Not allowed. textbee cannot send SMS.", HomeCard.RED)
                if (receiveOn) check(items[1], receive, HealthStatus.RED, "Not allowed. textbee cannot receive SMS.", HomeCard.RED)
                else check(items[1], receive, HealthStatus.AMBER, "Not allowed. Needed only when receive SMS is on.", HomeCard.NONE)
                check(items[2], phone, HealthStatus.AMBER,
                    "Not allowed. Needed to choose a SIM and to report which SIM was used.", HomeCard.AMBER)
                check(items[3], notifications, HealthStatus.AMBER,
                    "Not allowed. textbee cannot show that it is running, and Android stops it sooner in the background.", HomeCard.NONE)

                // The badge counts red permission rows only
                val expectedRed = listOf(!send, !receive && receiveOn).count { it }
                val rows = DeviceHealthRows.build(inputs(snapshot).copy(receiveSmsEnabled = receiveOn))
                assertEquals(label, expectedRed, DeviceHealthRows.issueCount(rows))
                assertEquals(label, expectedRed, items.count { it.homeCard == HomeCard.RED })
                assertEquals(label, if (phone) 0 else 1, items.count { it.homeCard == HomeCard.AMBER })
            }
        }
    }

    @Test
    fun aWorkingApiKeyIsGreen() {
        val row = DeviceHealthRows.apiKeyRow(0L)
        assertEquals("API key", row.title)
        assertEquals("Working", row.detail)
        assertEquals(HealthStatus.GREEN, row.status)
        assertEquals(HealthAction.NONE, row.action)
    }

    @Test
    fun aRejectedApiKeyIsRedAndCounts() {
        val row = DeviceHealthRows.apiKeyRow(now) { "Nov 12, 2026, 3:04 PM" }
        assertEquals(HealthStatus.RED, row.status)
        assertEquals("Rejected since Nov 12, 2026, 3:04 PM. Create a new API key in the dashboard and add it here.", row.detail)
        assertEquals(HealthAction.ADD_API_KEY, row.action)
        assertEquals("Add API key", row.actionLabel)

        val rows = DeviceHealthRows.build(inputs().copy(apiKeyRejectedAtMs = now, timeText = { "then" }))
        assertEquals("Rejected since then. Create a new API key in the dashboard and add it here.",
            rows.first { it.id == "api_key" }.detail)
        assertEquals(1, DeviceHealthRows.issueCount(rows))
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
        assertEquals(HealthStatus.GREEN, DeviceHealthRows.heartbeatRow(now - 10 * 60_000, now, true, 30).status)
        assertEquals(HealthStatus.AMBER, DeviceHealthRows.heartbeatRow(now - 2 * 3_600_000, now, true, 30).status)
        assertEquals(HealthStatus.RED, DeviceHealthRows.heartbeatRow(now - 5 * 3_600_000, now, true, 30).status)
        assertEquals(HealthStatus.RED, DeviceHealthRows.heartbeatRow(null, now, true, 30).status)
    }

    @Test
    fun theRowUsesTheAppliedPeriodWhenOneIsStored() {
        assertEquals(15, DeviceHealthRows.healthPeriodMinutes(15, 240))
        assertEquals(240, DeviceHealthRows.healthPeriodMinutes(240, 15))
        assertEquals(60, DeviceHealthRows.healthPeriodMinutes(null, 60))
        assertEquals(60, DeviceHealthRows.healthPeriodMinutes(0, 60))
    }

    @Test
    fun heartbeatLimitsFollowTheJobPeriod() {
        val minute = 60_000L
        val now = 100_000_000_000L
        val atDefault = DeviceHealthRows.heartbeatRow(now - 46 * minute, now, true, 30)
        assertEquals(HealthStatus.AMBER, atDefault.status)
        assertEquals("46 minutes ago. Expected every 30 minutes.", atDefault.detail)
        assertEquals(HealthStatus.GREEN, DeviceHealthRows.heartbeatRow(now - 44 * minute, now, true, 30).status)

        // A one hour period: late after 75 minutes
        assertEquals(HealthStatus.GREEN, DeviceHealthRows.heartbeatRow(now - 74 * minute, now, true, 60).status)
        val hourly = DeviceHealthRows.heartbeatRow(now - 76 * minute, now, true, 60)
        assertEquals(HealthStatus.AMBER, hourly.status)
        assertEquals("1 hour 16 min ago. Expected every hour.", hourly.detail)

        // The longest period: green until 255 minutes, red only after twice that
        assertEquals(HealthStatus.GREEN, DeviceHealthRows.heartbeatRow(now - 254 * minute, now, true, 240).status)
        val slow = DeviceHealthRows.heartbeatRow(now - 256 * minute, now, true, 240)
        assertEquals(HealthStatus.AMBER, slow.status)
        assertEquals("4 hours 16 min ago. Expected every 4 hours.", slow.detail)
        assertEquals(HealthStatus.AMBER, DeviceHealthRows.heartbeatRow(now - 509 * minute, now, true, 240).status)
        assertEquals(HealthStatus.RED, DeviceHealthRows.heartbeatRow(now - 510 * minute, now, true, 240).status)

        assertEquals("hour", DeviceHealthRows.everyText(60))
        assertEquals("15 minutes", DeviceHealthRows.everyText(15))
        assertEquals("30 minutes", DeviceHealthRows.everyText(30))
        assertEquals("90 minutes", DeviceHealthRows.everyText(90))
        assertEquals("2 hours", DeviceHealthRows.everyText(120))
        assertEquals("4 hours", DeviceHealthRows.everyText(240))

        // build() passes the period through
        val rows = DeviceHealthRows.build(inputs(lastHeartbeat = this.now - 50 * minute).copy(periodMinutes = 60))
        assertEquals(HealthStatus.GREEN, rows.first { it.id == "heartbeat" }.status)
    }

    @Test
    fun heartbeatRowOffersAManualSendAndSaysNothingAboutReporting() {
        val never = DeviceHealthRows.heartbeatRow(null, now, true, 30)
        assertEquals("Heartbeat", never.title)
        assertEquals(HealthAction.SEND_HEARTBEAT, never.action)
        assertEquals("Send heartbeat", never.actionLabel)
        assertEquals("Never. Send one to check the connection.", never.detail)

        // the gateway being off is the user's own choice, so no action and no issue
        val off = DeviceHealthRows.heartbeatRow(null, now, false, 30)
        assertEquals(HealthAction.NONE, off.action)
        assertEquals(false, off.countsAsIssue)
    }

    @Test
    fun theStickyServiceStartsOnTheSwitchAloneWithAnyPermissions() {
        for (mask in 0 until 16) {
            val snapshot = allGood.copy(hasSendSmsPermission = mask and 1 != 0, hasReceiveSmsPermission = mask and 2 != 0,
                hasReadPhoneStatePermission = mask and 4 != 0, hasPostNotificationsPermission = mask and 8 != 0)
            assertTrue("mask $mask", DeviceHealth.shouldStartSticky(snapshot.copy(stickyNotificationEnabled = true)))
            assertFalse("mask $mask", DeviceHealth.shouldStartSticky(snapshot.copy(stickyNotificationEnabled = false)))
        }
    }

    @Test
    fun theRedCardAsksForBothSmsPermissionsAndTheAmberCardForPhoneState() {
        val send = "android.permission.SEND_SMS"
        val receive = "android.permission.RECEIVE_SMS"
        val phone = "android.permission.READ_PHONE_STATE"
        fun request(card: HomeCard, s: DeviceHealthSnapshot, receiveOn: Boolean) =
            DeviceHealthRows.homeRequest(card, DeviceHealthRows.permissionItems(s, receiveOn), s)

        val none = allGood.copy(hasSendSmsPermission = false, hasReceiveSmsPermission = false,
            hasReadPhoneStatePermission = false, hasPostNotificationsPermission = false)
        for (receiveOn in listOf(true, false)) {
            // One group, one dialog: receive is asked for too, even while receive SMS is off
            assertEquals(listOf(send, receive), request(HomeCard.RED, none, receiveOn))
            assertEquals(listOf(phone), request(HomeCard.AMBER, none, receiveOn))
            assertEquals(emptyList<String>(), request(HomeCard.NONE, none, receiveOn))
            assertEquals(emptyList<String>(), request(HomeCard.RED, allGood, receiveOn))
            assertEquals(emptyList<String>(), request(HomeCard.AMBER, allGood, receiveOn))
        }
        val noReceive = allGood.copy(hasReceiveSmsPermission = false)
        assertEquals(listOf(receive), request(HomeCard.RED, noReceive, true))
        // Receive missing while receive SMS is off shows no card
        assertEquals(emptyList<String>(), request(HomeCard.RED, noReceive, false))
        assertEquals(listOf(send), request(HomeCard.RED, allGood.copy(hasSendSmsPermission = false), false))
        // Notifications never come from a home card
        val noNotifications = allGood.copy(hasPostNotificationsPermission = false)
        assertEquals(emptyList<String>(), request(HomeCard.RED, noNotifications, true))
        assertEquals(emptyList<String>(), request(HomeCard.AMBER, noNotifications, true))
        assertEquals("android.permission.POST_NOTIFICATIONS", DeviceHealthRows.androidPermission(AppPermission.NOTIFICATIONS))
    }

    @Test
    fun futureHeartbeatIsNotGreen() {
        assertEquals(HealthStatus.AMBER, DeviceHealthRows.heartbeatRow(now + 60_000, now, true, 30).status)
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
