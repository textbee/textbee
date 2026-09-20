package com.vernu.sms.dtos

import com.google.gson.Gson
import org.junit.Assert.assertEquals
import org.junit.Test

class HeartbeatResponseDTOTest {
    @Test
    fun acceptsIso8601TimestampWithMillisecondsAndZuluSuffix() {
        val timestamp = "2026-09-20T19:53:31.278Z"
        val json =
            """{"success":true,"fcmTokenUpdated":false,"lastHeartbeat":"$timestamp"}"""

        val response = Gson().fromJson(json, HeartbeatResponseDTO::class.java)

        assertEquals(timestamp, response.lastHeartbeat)
    }
}
