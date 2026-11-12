package com.vernu.sms.helpers

import com.google.gson.Gson
import com.google.gson.JsonParser
import com.vernu.sms.dtos.HeartbeatResponseDTO
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PartReportsConfigTest {
    private fun parse(json: String) = DeviceConfig.parse(JsonParser.parseString(json))

    @Test
    fun theKeyIsRead() {
        assertTrue(parse("""{"partReportsEnabled":true}""").partReportsEnabled)
        assertFalse(parse("""{"partReportsEnabled":false}""").partReportsEnabled)
    }

    @Test
    fun aReplyWithoutTheKeyTurnsItOff() {
        assertFalse(parse("""{"sendSchedulerV2Enabled":true,"directUploadEnabled":true}""").partReportsEnabled)
    }

    @Test
    fun aHeartbeatReplyWithoutAConfigTurnsItOff() {
        val body = Gson().fromJson("""{"success":true,"fcmTokenUpdated":false}""", HeartbeatResponseDTO::class.java)
        assertEquals(null, body.config)
        assertFalse(DeviceConfig.parse(body.config).partReportsEnabled)
    }
}
