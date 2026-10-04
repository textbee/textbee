package com.vernu.sms.helpers

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class HeartbeatSettingsKeyTest {
    private val health = DeviceHealthSnapshot(
        hasSendSmsPermission = true,
        hasReceiveSmsPermission = true,
        hasReadPhoneStatePermission = true,
        hasPostNotificationsPermission = true,
        stickyNotificationEnabled = false,
        usingLegacyUi = false,
    )
    private val base = HeartbeatHelper.settingsKey(health, false, 5, true)

    @Test
    fun sameValuesGiveSameKey() {
        assertEquals(base, HeartbeatHelper.settingsKey(health.copy(), false, 5, true))
    }

    @Test
    fun eachUserChangeGivesNewKey() {
        listOf(
            HeartbeatHelper.settingsKey(health, true, 5, true),
            HeartbeatHelper.settingsKey(health, false, 10, true),
            HeartbeatHelper.settingsKey(health, false, 5, false),
            HeartbeatHelper.settingsKey(health.copy(hasReceiveSmsPermission = false), false, 5, true),
            HeartbeatHelper.settingsKey(health.copy(hasPostNotificationsPermission = false), false, 5, true),
            HeartbeatHelper.settingsKey(health.copy(stickyNotificationEnabled = true), false, 5, true),
            HeartbeatHelper.settingsKey(health.copy(usingLegacyUi = true), false, 5, true),
        ).forEach { assertNotEquals(base, it) }
    }
}
