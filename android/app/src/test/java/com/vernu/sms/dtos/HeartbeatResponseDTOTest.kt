package com.vernu.sms.dtos

import com.google.gson.Gson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The heartbeat reply is the only way server config reaches the phone, so a
 * parse failure here silently disables every switch in the app. The API sends
 * lastHeartbeat as an ISO date string, which is why it must not be a number.
 */
class HeartbeatResponseDTOTest {

    private val serverReply = """
        {
          "success": true,
          "fcmTokenUpdated": false,
          "lastHeartbeat": "2026-09-21T05:32:28.558Z",
          "name": "Test phone",
          "pendingCount": 3,
          "config": {
            "sendSchedulerV2Enabled": true,
            "recoveryPollEnabled": false,
            "directUploadEnabled": true,
            "updateNotificationsEnabled": false,
            "latestVersionCode": 20,
            "latestVersionName": "2.9.0"
          }
        }
    """.trimIndent()

    @Test
    fun parsesTheRealServerReply() {
        val body = Gson().fromJson(serverReply, HeartbeatResponseDTO::class.java)

        assertTrue(body.success)
        assertEquals("Test phone", body.name)
        assertEquals(3, body.pendingCount)
        assertEquals("2026-09-21T05:32:28.558Z", body.lastHeartbeat)

        val config = body.config
        assertNotNull(config)
        assertEquals(true, config!!.sendSchedulerV2Enabled)
        assertEquals(false, config.recoveryPollEnabled)
        assertEquals(true, config.directUploadEnabled)
        assertEquals(20, config.latestVersionCode)
        assertEquals("2.9.0", config.latestVersionName)
    }

    /** Servers that predate the switch leave it out, so the saved value is kept. */
    @Test
    fun parsesAConfigWithoutDirectUploadEnabled() {
        val body = Gson().fromJson(
            """{"success":true,"fcmTokenUpdated":false,"config":{"sendSchedulerV2Enabled":true}}""",
            HeartbeatResponseDTO::class.java,
        )

        assertEquals(true, body.config!!.sendSchedulerV2Enabled)
        assertEquals(null, body.config!!.directUploadEnabled)
    }

    /** Older servers answered without the fields 2.9 added. */
    @Test
    fun parsesAReplyWithoutConfigOrPendingCount() {
        val body = Gson().fromJson(
            """{"success":true,"fcmTokenUpdated":true,"lastHeartbeat":"2026-09-21T05:32:28.558Z"}""",
            HeartbeatResponseDTO::class.java,
        )

        assertTrue(body.success)
        assertTrue(body.fcmTokenUpdated)
        assertEquals(0, body.pendingCount)
        assertEquals(null, body.config)
    }

    /** A null name must not become the string "null" on the device. */
    @Test
    fun parsesAReplyWithAnExplicitNullName() {
        val body = Gson().fromJson(
            """{"success":true,"fcmTokenUpdated":false,"lastHeartbeat":null,"name":null,"pendingCount":0}""",
            HeartbeatResponseDTO::class.java,
        )

        assertEquals(null, body.name)
        assertEquals(null, body.lastHeartbeat)
    }
}
