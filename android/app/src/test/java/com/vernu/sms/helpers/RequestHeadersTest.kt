package com.vernu.sms.helpers

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RequestHeadersTest {
    private val installId = "3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f"
    private val hash = "a".repeat(64)

    @Test
    fun allThreeValuesAreSent() {
        val headers = RequestHeaders.build(installId, hash, hash)
        assertEquals(
            mapOf(
                RequestHeaders.INSTALL_ID to installId,
                RequestHeaders.PHONE_ID to hash,
                RequestHeaders.APP_SIGNER to hash,
            ),
            headers
        )
    }

    @Test
    fun missingValuesAreLeftOut() {
        assertEquals(emptyMap<String, String>(), RequestHeaders.build(null, null, null))
        assertEquals(mapOf(RequestHeaders.PHONE_ID to hash), RequestHeaders.build(null, hash, ""))
        assertEquals(mapOf(RequestHeaders.INSTALL_ID to installId), RequestHeaders.build(installId, "   ", null))
    }

    @Test
    fun valuesAHeaderCannotCarryAreLeftOut() {
        val headers = RequestHeaders.build("id with space", "a".repeat(65), "café")
        assertTrue(headers.isEmpty())
    }

    @Test
    fun valuesAreTrimmed() {
        assertEquals(installId, RequestHeaders.build(" $installId\n", null, null)[RequestHeaders.INSTALL_ID])
    }

    @Test
    fun theAndroidIdIsCleaned() {
        assertEquals("1a2b3c4d5e6f7a8b", RequestHeaders.cleanAndroidId(" 1A2B3C4D5E6F7A8B "))
        assertNull(RequestHeaders.cleanAndroidId(null))
        assertNull(RequestHeaders.cleanAndroidId(""))
        assertNull(RequestHeaders.cleanAndroidId("0000000000000000"))
        assertNull(RequestHeaders.cleanAndroidId("9774d56d682e549c"))
        assertNull(RequestHeaders.cleanAndroidId("unknown"))
    }

    @Test
    fun thePhoneIdIsAHashOfThePrefixedAndroidId() {
        val phoneId = RequestHeaders.phoneIdFrom("1a2b3c4d5e6f7a8b")!!
        assertEquals(64, phoneId.length)
        assertTrue(phoneId.all { it in '0'..'9' || it in 'a'..'f' })
        assertEquals(
            RequestHeaders.sha256Hex((RequestHeaders.PHONE_ID_PREFIX + "1a2b3c4d5e6f7a8b").toByteArray()),
            phoneId
        )
        assertFalse(phoneId.contains("1a2b3c4d5e6f7a8b"))
    }

    @Test
    fun thePhoneIdNeverChanges() {
        // A changed prefix or hash would make every reinstalled phone look like a new one
        assertEquals("textbee-phone-id:", RequestHeaders.PHONE_ID_PREFIX)
        assertEquals(
            "903e960541580d0211106ffd1276d1f0978f0f208b843c58957951637e2efdc5",
            RequestHeaders.phoneIdFrom("1a2b3c4d5e6f7a8b")
        )
    }

    @Test
    fun noHeadersBeforeTheAppStarts() {
        assertEquals(emptyMap<String, String>(), RequestHeaders.current())
    }

    @Test
    fun thePhoneIdIsStableAndIgnoresLetterCase() {
        assertEquals(RequestHeaders.phoneIdFrom("1a2b3c4d5e6f7a8b"), RequestHeaders.phoneIdFrom("1A2B3C4D5E6F7A8B"))
        assertNotEquals(RequestHeaders.phoneIdFrom("1a2b3c4d5e6f7a8b"), RequestHeaders.phoneIdFrom("1a2b3c4d5e6f7a8c"))
    }

    @Test
    fun noPhoneIdWithoutAUsableAndroidId() {
        assertNull(RequestHeaders.phoneIdFrom(null))
        assertNull(RequestHeaders.phoneIdFrom("0000000000000000"))
    }

    @Test
    fun theHashMatchesAKnownValue() {
        assertEquals(
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            RequestHeaders.sha256Hex(ByteArray(0))
        )
        assertEquals(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            RequestHeaders.sha256Hex("abc".toByteArray())
        )
    }
}
