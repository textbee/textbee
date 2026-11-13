package com.vernu.sms.helpers

import com.vernu.sms.AppConstants
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceDisconnectTest {
    private val cleared = DeviceDisconnect.keysToClear(
        setOf(
            AppConstants.SHARED_PREFS_CONFIG_PULL_KEY,
            AppConstants.SHARED_PREFS_CONFIG_NOTICE_KEY,
            // Written by builds before 2.10, no longer a constant
            "CONFIG_SEND_SCHEDULER_V2_ENABLED",
            AppConstants.SHARED_PREFS_RECEIVE_SMS_ENABLED_KEY,
        )
    )

    @Test
    fun theConnectionAndItsStateAreCleared() {
        listOf(
            AppConstants.SHARED_PREFS_DEVICE_ID_KEY,
            AppConstants.SHARED_PREFS_API_KEY_KEY,
            AppConstants.SHARED_PREFS_GATEWAY_ENABLED_KEY,
            AppConstants.SHARED_PREFS_DEVICE_NAME_KEY,
            AppConstants.SHARED_PREFS_LAST_HEARTBEAT_MS_KEY,
            AppConstants.SHARED_PREFS_PULL_LAST_CLAIM_MS_KEY,
            AppConstants.SHARED_PREFS_PULL_NEXT_CLAIM_MS_KEY,
            AppConstants.SHARED_PREFS_PULL_MORE_KEY,
            AppConstants.SHARED_PREFS_PULL_BOOKED_UNTIL_MS_KEY,
            AppConstants.SHARED_PREFS_LAST_RECOVERY_POLL_MS_KEY,
            AppConstants.SHARED_PREFS_NEXT_SEND_SLOT_MS_KEY,
            AppConstants.SHARED_PREFS_LAST_SEND_RESERVED_AT_MS_KEY,
            AppConstants.SHARED_PREFS_PREFERRED_SIM_SLOT_KEY,
            AppConstants.SHARED_PREFS_PREFERRED_SIM_KEY,
            AppConstants.SHARED_PREFS_APPLIED_PERIOD_MINUTES_KEY,
            AppConstants.SHARED_PREFS_LAST_REPORTED_SETTINGS_KEY,
            AppConstants.SHARED_PREFS_NOTICE_CLOSED_IDS_KEY,
            AppConstants.SHARED_PREFS_API_KEY_REJECTED_AT_KEY,
            AppConstants.SHARED_PREFS_LAST_API_KEY_NOTIFIED_AT_KEY,
            AppConstants.SHARED_PREFS_RECEIVE_SMS_ENABLED_KEY,
        ).forEach { assertTrue(it, it in cleared) }
    }

    @Test
    fun theRegistrationIsClearedFirst() {
        assertEquals(
            setOf(AppConstants.SHARED_PREFS_DEVICE_ID_KEY, AppConstants.SHARED_PREFS_API_KEY_KEY),
            DeviceDisconnect.REGISTRATION_KEYS,
        )
        assertTrue(cleared.containsAll(DeviceDisconnect.REGISTRATION_KEYS))
    }

    @Test
    fun everyStoredConfigValueIsCleared() {
        assertTrue(AppConstants.SHARED_PREFS_CONFIG_PULL_KEY in cleared)
        assertTrue(AppConstants.SHARED_PREFS_CONFIG_NOTICE_KEY in cleared)
        assertTrue("CONFIG_SEND_SCHEDULER_V2_ENABLED" in cleared)
    }

    @Test
    fun userSettingsAndResendGuardsAreKept() {
        listOf(
            AppConstants.SHARED_PREFS_STICKY_NOTIFICATION_ENABLED_KEY,
            AppConstants.SHARED_PREFS_SMS_SEND_DELAY_SECONDS_KEY,
            AppConstants.SHARED_PREFS_SMS_FILTER_CONFIG_KEY,
            AppConstants.SHARED_PREFS_OLD_DEDUPE_READ_SINCE_MS_KEY,
            AppConstants.SHARED_PREFS_DEDUPE_SKIP_COUNT_KEY,
            // Set by the disconnect itself and cleared when the token delete succeeds
            AppConstants.SHARED_PREFS_FCM_TOKEN_RESET_PENDING_KEY,
            // The real gap before the radio still holds after a reconnect
            AppConstants.SHARED_PREFS_NEXT_SEND_EXEC_SLOT_MS_KEY,
            AppConstants.SHARED_PREFS_LAST_SEND_EXEC_RESERVED_AT_MS_KEY,
        ).forEach { assertFalse(it, it in cleared) }
    }
}
