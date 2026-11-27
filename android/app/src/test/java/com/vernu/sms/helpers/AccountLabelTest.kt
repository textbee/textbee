package com.vernu.sms.helpers

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AccountLabelTest {
    @Test
    fun aNewLabelFromTheServerIsSaved() {
        assertEquals("Acme Inc", AccountLabel.toSave("Acme Inc", "jane@example.com"))
        assertEquals("jane@example.com", AccountLabel.toSave("jane@example.com", null))
        assertEquals("jane@example.com", AccountLabel.toSave("jane@example.com", ""))
    }

    @Test
    fun aMissingOrBlankLabelKeepsTheSavedOne() {
        // Older servers send no label; the value saved at sign-in stays
        assertNull(AccountLabel.toSave(null, "jane@example.com"))
        assertNull(AccountLabel.toSave("", "jane@example.com"))
        assertNull(AccountLabel.toSave("   ", "jane@example.com"))
        assertNull(AccountLabel.toSave(null, null))
    }

    @Test
    fun theSameLabelIsNotWrittenAgain() {
        assertNull(AccountLabel.toSave("Acme Inc", "Acme Inc"))
        assertNull(AccountLabel.toSave("  Acme Inc ", "Acme Inc"))
    }

    @Test
    fun theLabelIsTrimmedAndLimited() {
        assertEquals("Acme Inc", AccountLabel.toSave("  Acme Inc\n", null))
        assertEquals("a".repeat(AccountLabel.MAX_LENGTH), AccountLabel.toSave("a".repeat(500), null))
    }
}
