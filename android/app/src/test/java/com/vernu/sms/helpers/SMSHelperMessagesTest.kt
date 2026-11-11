package com.vernu.sms.helpers

import org.junit.Assert.assertEquals
import org.junit.Test

class SMSHelperMessagesTest {
    @Test
    fun namesThePhonePermissionWhenOnlyItIsMissing() {
        assertEquals("Phone permission not granted", SMSHelper.permissionDeniedMessage(smsGranted = true))
    }

    @Test
    fun namesTheSmsPermissionWhenItIsMissing() {
        assertEquals("SMS permission not granted", SMSHelper.permissionDeniedMessage(smsGranted = false))
    }

    @Test
    fun emptySlotNamesTheSimAndTheIndex() {
        assertEquals("No active SIM 1 (simSlotIndex 0).", SMSHelper.simSlotEmptyMessage(0))
        assertEquals("No active SIM 2 (simSlotIndex 1).", SMSHelper.simSlotEmptyMessage(1))
    }
}
