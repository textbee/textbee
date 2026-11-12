package com.vernu.sms.helpers

import com.google.android.gms.common.ConnectionResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RegistrationChecksTest {
    @Test
    fun acceptsADashboardDeviceId() {
        assertTrue(RegistrationChecks.isValidDeviceId("6a1b2c3d4e5f60718293a4b5"))
        assertTrue(RegistrationChecks.isValidDeviceId("  6A1B2C3D4E5F60718293A4B5 "))
    }

    @Test
    fun rejectsIdsWithTheWrongLengthOrCharacters() {
        assertFalse(RegistrationChecks.isValidDeviceId(""))
        assertFalse(RegistrationChecks.isValidDeviceId("6a1b2c3d4e5f60718293a4b"))
        assertFalse(RegistrationChecks.isValidDeviceId("6a1b2c3d4e5f60718293a4b5c"))
        assertFalse(RegistrationChecks.isValidDeviceId("6a1b2c3d4e5f60718293a4bz"))
        // An API key pasted into the Device ID field
        assertFalse(RegistrationChecks.isValidDeviceId("a1b2c3d4-e5f6-7081-92a3-b4c5d6e7f809"))
    }

    @Test
    fun saysNothingWhenPlayServicesWorks() {
        assertNull(RegistrationChecks.playServicesMessage(ConnectionResult.SUCCESS))
    }

    @Test
    fun namesEachPlayServicesProblem() {
        val missing = RegistrationChecks.playServicesMessage(ConnectionResult.SERVICE_MISSING)
        val outdated = RegistrationChecks.playServicesMessage(ConnectionResult.SERVICE_VERSION_UPDATE_REQUIRED)
        val disabled = RegistrationChecks.playServicesMessage(ConnectionResult.SERVICE_DISABLED)

        assertNotNull(missing)
        assertTrue(missing!!.contains("does not have Google Play services"))
        assertTrue(outdated!!.contains("out of date"))
        assertTrue(disabled!!.contains("turned off"))
    }

    @Test
    fun doesNotCallAFakeOrBrokenInstallMissing() {
        val invalid = RegistrationChecks.playServicesMessage(ConnectionResult.SERVICE_INVALID)!!
        val other = RegistrationChecks.playServicesMessage(ConnectionResult.NETWORK_ERROR)!!

        assertTrue(invalid.contains("not genuine"))
        assertFalse(invalid.contains("does not have"))
        assertFalse(other.contains("does not have"))
    }

    private val stored = "6a1b2c3d4e5f60718293a4b5"
    private val other = "7a1b2c3d4e5f60718293a4b5"

    @Test
    fun addingAnApiKeyAlwaysUpdatesTheStoredDevice() {
        // Whatever the other flags say, as after process death with nothing restored
        for (returning in listOf(true, false)) for (useExisting in listOf(true, false)) for (entered in listOf("", other)) {
            assertEquals(DeviceRequest(true, stored),
                RegistrationChecks.deviceRequest(true, stored, returning, useExisting, entered))
        }
    }

    @Test
    fun addingAnApiKeyWithNoStoredDeviceMakesNoRequest() {
        assertNull(RegistrationChecks.deviceRequest(true, "", true, true, other))
        assertNull(RegistrationChecks.deviceRequest(true, "", false, false, ""))
    }

    @Test
    fun plainOnboardingRegistersOrReconnects() {
        assertEquals(DeviceRequest(false), RegistrationChecks.deviceRequest(false, "", false, false, ""))
        // A stored id from an earlier setup does not change plain onboarding
        assertEquals(DeviceRequest(false), RegistrationChecks.deviceRequest(false, stored, false, false, ""))
        assertEquals(DeviceRequest(false), RegistrationChecks.deviceRequest(false, "", false, true, ""))
        assertEquals(DeviceRequest(true, other), RegistrationChecks.deviceRequest(false, stored, false, true, other))
        assertEquals(DeviceRequest(true, other), RegistrationChecks.deviceRequest(false, "", true, true, other))
        assertEquals(DeviceRequest(true, ""), RegistrationChecks.deviceRequest(false, "", true, true, ""))
    }
}
