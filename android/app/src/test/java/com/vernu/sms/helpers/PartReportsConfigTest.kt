package com.vernu.sms.helpers

import com.google.gson.Gson
import com.vernu.sms.dtos.DeviceConfigDTO
import com.vernu.sms.dtos.HeartbeatResponseDTO
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PartReportsConfigTest {
    private fun parse(json: String) = Gson().fromJson(json, DeviceConfigDTO::class.java)

    @Test
    fun theKeyIsRead() {
        assertTrue(DeviceConfig.partReportsEnabled(parse("""{"partReportsEnabled":true}""")))
        assertFalse(DeviceConfig.partReportsEnabled(parse("""{"partReportsEnabled":false}""")))
    }

    @Test
    fun aReplyWithoutTheKeyTurnsItOff() {
        val config = parse("""{"sendSchedulerV2Enabled":true,"directUploadEnabled":true}""")
        assertEquals(null, config.partReportsEnabled)
        assertFalse(DeviceConfig.partReportsEnabled(config))
    }

    @Test
    fun aHeartbeatReplyWithoutAConfigTurnsItOff() {
        val body = Gson().fromJson("""{"success":true,"fcmTokenUpdated":false}""", HeartbeatResponseDTO::class.java)
        assertEquals(null, body.config)
        assertFalse(DeviceConfig.partReportsEnabled(body.config))
    }
}
