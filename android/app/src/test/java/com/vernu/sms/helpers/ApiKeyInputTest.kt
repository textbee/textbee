package com.vernu.sms.helpers

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ApiKeyInputTest {
    private val uuidKey = "3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f"
    private val txbKey = "txb_" + "aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0hL"

    @Test
    fun bothKeyFormatsPassWithNoMessage() {
        for (key in listOf(uuidKey, txbKey)) {
            assertEquals(36, key.length)
            assertEquals(key, ApiKeyInput.clean(key))
            assertNull(ApiKeyInput.problem(key))
            assertNull(ApiKeyInput.hint(key))
            assertTrue(ApiKeyInput.canSubmit(key))
        }
    }

    @Test
    fun everyCharacterOfBothFormatsIsAccepted() {
        val all = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
        assertNull(ApiKeyInput.problem(all))
    }

    @Test
    fun spacesAndLineBreaksAroundAKeyAreRemoved() {
        assertEquals(txbKey, ApiKeyInput.clean("  $txbKey \n"))
        assertEquals(uuidKey, ApiKeyInput.clean("\t$uuidKey\r\n"))
    }

    @Test
    fun whatACopyAddsAroundAKeyIsRemoved() {
        assertEquals(txbKey, ApiKeyInput.clean("\"$txbKey\""))
        assertEquals(uuidKey, ApiKeyInput.clean("'$uuidKey'"))
        assertEquals(txbKey, ApiKeyInput.clean("\u200b$txbKey\ufeff"))
    }

    @Test
    fun aKeyAtTheLimitIsKeptWhole() {
        val key = "k".repeat(ApiKeyInput.MAX_LENGTH)
        assertEquals(key, ApiKeyInput.clean("  $key  "))
        assertTrue(ApiKeyInput.canSubmit(key))
    }

    @Test
    fun aHugePasteIsCutAndRefused() {
        val cleaned = ApiKeyInput.clean("x".repeat(500_000))
        assertEquals(ApiKeyInput.MAX_LENGTH + 1, cleaned.length)
        assertEquals(ApiKeyInput.TOO_LONG, ApiKeyInput.problem(cleaned))
        assertFalse(ApiKeyInput.canSubmit(cleaned))
    }

    @Test
    fun oneCharacterOverTheLimitIsRefused() {
        assertEquals(ApiKeyInput.TOO_LONG, ApiKeyInput.problem("k".repeat(ApiKeyInput.MAX_LENGTH + 1)))
    }

    @Test
    fun aCommandOrALinkWithSpacesIsRefused() {
        val short = ApiKeyInput.clean("curl -X 'POST' \\\n  'https://api.textbee.dev/api/v1/auth/api-keys'")
        val long = ApiKeyInput.clean("curl -X 'POST' " + "-H 'accept: */*' ".repeat(200))
        for (command in listOf(short, long)) {
            assertEquals(ApiKeyInput.HAS_SPACES, ApiKeyInput.problem(command))
            assertFalse(ApiKeyInput.canSubmit(command))
        }
    }

    @Test
    fun aKeyWithOtherCharactersIsRefused() {
        for (key in listOf("txb_\u043a\u043b\u044e\u0447000000000000000000000000", "txb_abc\u0000def", "txb_abc\u200bdef")) {
            assertEquals(ApiKeyInput.OTHER_CHARACTERS, ApiKeyInput.problem(key))
            assertFalse(ApiKeyInput.canSubmit(key))
        }
    }

    // The server decides if a key is valid, so the app accepts formats it does not know
    @Test
    fun aKeyInAnotherFormatCanBeSentWithNoMessage() {
        val others = listOf(
            txbKey + "moreCharacters",
            uuidKey.uppercase(),
            "aB3+dE6/gH9=jK2.mN5~pQ8:sT1!vW4",
            "k".repeat(200)
        )
        for (key in others) {
            assertEquals(key, ApiKeyInput.clean(key))
            assertNull(ApiKeyInput.problem(key))
            assertNull(ApiKeyInput.hint(key))
            assertTrue(ApiKeyInput.canSubmit(key))
        }
    }

    @Test
    fun aVeryShortKeyCanBeSentAndGetsAHint() {
        for (key in listOf("a", txbKey.take(19))) {
            assertNull(ApiKeyInput.problem(key))
            assertTrue(ApiKeyInput.canSubmit(key))
            assertEquals(ApiKeyInput.LOOKS_SHORT, ApiKeyInput.hint(key))
        }
        assertNull(ApiKeyInput.hint(txbKey.take(20)))
    }

    @Test
    fun anEmptyFieldHasNoMessageAndCannotBeSent() {
        assertNull(ApiKeyInput.problem(""))
        assertNull(ApiKeyInput.hint(""))
        assertFalse(ApiKeyInput.canSubmit(""))
    }

    @Test
    fun aRefusedKeyGetsNoSecondHint() {
        assertNull(ApiKeyInput.hint("two words"))
    }
}
