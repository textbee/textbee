package com.vernu.sms.helpers

import android.Manifest
import com.vernu.sms.AppConstants
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceHealthTest {
    private class FakeProbe(
        override val sdkInt: Int = 34,
        private val granted: Set<String> = emptySet(),
        private val prefs: Map<String, Boolean> = emptyMap(),
    ) : DeviceHealthProbe {
        override fun isPermissionGranted(permission: String) = permission in granted
        override fun prefBoolean(key: String, default: Boolean) = prefs[key] ?: default
    }

    @Test
    fun reportsEachSmsPermission() {
        val snapshot = DeviceHealth.evaluate(
            FakeProbe(granted = setOf(Manifest.permission.SEND_SMS, Manifest.permission.READ_PHONE_STATE))
        )
        assertTrue(snapshot.hasSendSmsPermission)
        assertFalse(snapshot.hasReceiveSmsPermission)
        assertTrue(snapshot.hasReadPhoneStatePermission)
    }

    @Test
    fun notificationPermissionIsImpliedBelowAndroid13() {
        assertTrue(DeviceHealth.evaluate(FakeProbe(sdkInt = 32)).hasPostNotificationsPermission)
        assertFalse(DeviceHealth.evaluate(FakeProbe(sdkInt = 33)).hasPostNotificationsPermission)
        assertTrue(
            DeviceHealth.evaluate(
                FakeProbe(sdkInt = 33, granted = setOf("android.permission.POST_NOTIFICATIONS"))
            ).hasPostNotificationsPermission
        )
    }

    @Test
    fun stickyNotificationDefaultsOff() {
        assertFalse(DeviceHealth.evaluate(FakeProbe()).stickyNotificationEnabled)
        assertTrue(
            DeviceHealth.evaluate(
                FakeProbe(prefs = mapOf(AppConstants.SHARED_PREFS_STICKY_NOTIFICATION_ENABLED_KEY to true))
            ).stickyNotificationEnabled
        )
    }
}
