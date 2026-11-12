package com.vernu.sms.workers

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SendInputTest {
    private fun input(message: String) =
        SmsSendWorker.sendInput("+15555550100", message, "m1", "b1", null, 1, 42L)

    @Test
    fun aNewJobIsOnThePacedPath() {
        val data = input("hello")!!
        assertTrue(data.hasKeyWithValueOfType(SmsSendWorker.KEY_LEGACY_QUEUE, Boolean::class.javaObjectType))
        assertFalse(data.getBoolean(SmsSendWorker.KEY_LEGACY_QUEUE, true))
    }

    @Test
    fun theInputCarriesTheMessage() {
        val data = input("hello")!!
        assertEquals("+15555550100", data.getString(SmsSendWorker.KEY_PHONE))
        assertEquals("hello", data.getString(SmsSendWorker.KEY_MESSAGE))
        assertEquals("m1", data.getString(SmsSendWorker.KEY_SMS_ID))
        assertEquals("b1", data.getString(SmsSendWorker.KEY_SMS_BATCH_ID))
        assertEquals(-1, data.getInt(SmsSendWorker.KEY_SIM_SUBSCRIPTION_ID, 0))
        assertEquals(1, data.getInt(SmsSendWorker.KEY_SIM_SLOT_INDEX, 0))
        assertEquals(42L, data.getLong(SmsSendWorker.KEY_PUSH_RECEIVED_AT, 0))
    }

    @Test
    fun aMessageOverTheWorkManagerLimitGivesNoInput() {
        assertNotNull(input("a".repeat(9_000)))
        assertNull(input("a".repeat(10_240)))
    }

    // Text outside ASCII takes more than one byte per character
    @Test
    fun theLimitCountsBytesNotCharacters() {
        assertNotNull(input("é".repeat(4_000)))
        assertNull(input("é".repeat(6_000)))
    }
}
