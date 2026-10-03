package com.vernu.sms.helpers

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PermissionFailureNotifierTest {
    private val hour = 3_600_000L
    private val now = 100 * hour

    @Test
    fun notifiesTheFirstTime() {
        assertTrue(PermissionFailureNotifier.shouldNotify(nowMs = now, lastMs = 0L))
    }

    @Test
    fun staysQuietWithinTheGap() {
        assertFalse(PermissionFailureNotifier.shouldNotify(nowMs = now, lastMs = now - 1))
        assertFalse(PermissionFailureNotifier.shouldNotify(nowMs = now, lastMs = now - hour + 1))
    }

    @Test
    fun notifiesAgainAfterTheGap() {
        assertTrue(PermissionFailureNotifier.shouldNotify(nowMs = now, lastMs = now - hour))
        assertTrue(PermissionFailureNotifier.shouldNotify(nowMs = now, lastMs = now - 5 * hour))
    }

    @Test
    fun aGrantedPermissionIsNeverBlocked() {
        assertFalse(SmsPermissionHelp.isBlocked(granted = true, requestedBefore = true, canShowRationale = false))
    }

    @Test
    fun aPermissionNeverRequestedIsNotBlocked() {
        assertFalse(SmsPermissionHelp.isBlocked(granted = false, requestedBefore = false, canShowRationale = false))
    }

    @Test
    fun aDeniedPermissionThatCanAskAgainIsNotBlocked() {
        assertFalse(SmsPermissionHelp.isBlocked(granted = false, requestedBefore = true, canShowRationale = true))
    }

    @Test
    fun aDeniedPermissionWithNoRationaleIsBlocked() {
        assertTrue(SmsPermissionHelp.isBlocked(granted = false, requestedBefore = true, canShowRationale = false))
    }

    @Test
    fun theMenuStepShowsOnlyForRestrictedSettings() {
        assertTrue(SmsPermissionHelp.steps(restricted = true).any { it.contains("Allow restricted settings") })
        assertFalse(SmsPermissionHelp.steps(restricted = false).any { it.contains("Allow restricted settings") })
    }
}
