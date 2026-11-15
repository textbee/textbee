package com.vernu.sms.models

import com.google.gson.Gson
import com.vernu.sms.dtos.PendingMessagesResponseDTO
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SMSPayloadTest {
    private val gson = Gson()

    @Test
    fun readsTheSlot() {
        val payload = gson.fromJson(
            """{"smsId":"a1","message":"hi","recipients":["+15555550123"],"simSlotIndex":1,"simSubscriptionId":4}""",
            SMSPayload::class.java
        )
        assertEquals(1, payload.simSlotIndex)
        assertEquals(4, payload.simSubscriptionId)
    }

    @Test
    fun slotZeroIsKept() {
        val payload = gson.fromJson("""{"smsId":"a1","simSlotIndex":0}""", SMSPayload::class.java)
        assertEquals(0, payload.simSlotIndex)
    }

    @Test
    fun missingSlotStaysNull() {
        val payload = gson.fromJson(
            """{"smsId":"a1","message":"hi","recipients":["+15555550123"],"simSubscriptionId":4}""",
            SMSPayload::class.java
        )
        assertNull(payload.simSlotIndex)
        assertEquals(4, payload.simSubscriptionId)
    }

    @Test
    fun nullSlotStaysNull() {
        val payload = gson.fromJson("""{"smsId":"a1","simSlotIndex":null}""", SMSPayload::class.java)
        assertNull(payload.simSlotIndex)
    }

    @Test
    fun recoveryPollPayloadCarriesTheSlot() {
        val response = gson.fromJson(
            """{"data":[{"smsId":"a1","simSlotIndex":1},{"smsId":"a2"}]}""",
            PendingMessagesResponseDTO::class.java
        )
        val data = response.data!!
        assertEquals(1, data[0].simSlotIndex)
        assertNull(data[1].simSlotIndex)
    }
}
