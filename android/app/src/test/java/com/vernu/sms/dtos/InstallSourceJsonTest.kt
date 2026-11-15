package com.vernu.sms.dtos

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.vernu.sms.helpers.InstallSource
import com.vernu.sms.helpers.InstallSourceReport
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class InstallSourceJsonTest {
    private fun json(dto: Any): JsonObject = Gson().toJsonTree(dto).asJsonObject

    private fun heartbeat(r: InstallSourceReport?) = HeartbeatInputDTO().also { InstallSource.applyTo(it, r) }

    private fun registration(r: InstallSourceReport?) = RegisterDeviceInputDTO().also { InstallSource.applyTo(it, r) }

    private val unknown = InstallSource.report(34, null, null, 1700000000000L)
    private val known = InstallSource.report(34, "com.android.vending", "com.android.vending", 1700000000000L)

    @Test
    fun heartbeatKeepsAnEmptyInstallerAndOmitsNullInitiator() {
        val body = json(heartbeat(unknown))
        assertEquals("", body.get("installerPackage").asString)
        assertFalse(body.has("initiatingPackage"))
        assertEquals(1700000000000L, body.get("appLastUpdateTime").asLong)
        assertTrue(Gson().toJson(heartbeat(unknown)).contains("\"installerPackage\":\"\""))
    }

    @Test
    fun heartbeatCarriesKnownValues() {
        val body = json(heartbeat(known))
        assertEquals("com.android.vending", body.get("installerPackage").asString)
        assertEquals("com.android.vending", body.get("initiatingPackage").asString)
    }

    @Test
    fun heartbeatOmitsAllThreeWhenTheLookupFails() {
        val body = json(heartbeat(null))
        listOf("installerPackage", "initiatingPackage", "appLastUpdateTime").forEach { assertFalse(it, body.has(it)) }
    }

    @Test
    fun registrationBehavesTheSame() {
        val body = json(registration(unknown))
        assertEquals("", body.get("installerPackage").asString)
        assertFalse(body.has("initiatingPackage"))
        assertEquals(1700000000000L, body.get("appLastUpdateTime").asLong)
        assertEquals("com.android.vending", json(registration(known)).get("initiatingPackage").asString)
        val none = json(registration(null))
        listOf("installerPackage", "initiatingPackage", "appLastUpdateTime").forEach { assertFalse(it, none.has(it)) }
    }

    @Test
    fun deviceUpdateBuiltByTheHelperCarriesTheInstallSource() {
        val dto = RegisterDeviceInputDTO().apply { appVersionCode = 22 }
        InstallSource.applyTo(dto, unknown)
        assertTrue(Gson().toJson(dto).contains("\"installerPackage\":\"\""))
        assertEquals(1700000000000L, json(dto).get("appLastUpdateTime").asLong)
        assertFalse(json(dto).has("initiatingPackage"))
    }

    @Test
    fun deviceUpdateOmitsAllThreeWhenTheLookupFails() {
        val dto = RegisterDeviceInputDTO().apply { appVersionCode = 22 }
        InstallSource.applyTo(dto, null as InstallSourceReport?)
        val body = json(dto)
        listOf("installerPackage", "initiatingPackage", "appLastUpdateTime").forEach { assertFalse(it, body.has(it)) }
    }
}
