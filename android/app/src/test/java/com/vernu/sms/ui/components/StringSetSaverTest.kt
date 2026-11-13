package com.vernu.sms.ui.components

import androidx.compose.runtime.saveable.SaverScope
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.Serializable

class StringSetSaverTest {
    private val scope = SaverScope { true }

    private fun save(value: Set<String>): ArrayList<String>? = with(StringSetSaver) { scope.save(value) }

    // As rememberSaveable(stateSaver = ...) does: a saved null is restored as a null state value
    private fun saveAndRestore(value: Set<String>): Set<String>? {
        val saved = save(value) ?: return null
        return StringSetSaver.restore(saved)
    }

    @Test
    fun anEmptySetIsSavedAsAValue() {
        assertNotNull(save(emptySet()))
    }

    @Test
    fun anEmptySetComesBackEmpty() {
        assertEquals(emptySet<String>(), saveAndRestore(emptySet()))
    }

    @Test
    fun aSetComesBackEqual() {
        val value = setOf("android.permission.SEND_SMS", "android.permission.READ_PHONE_STATE")
        assertEquals(value, saveAndRestore(value))
    }

    @Test
    fun theSavedValueIsSerializable() {
        for (value in listOf(emptySet(), setOf("android.permission.SEND_SMS"))) {
            val saved = save(value)
            assertTrue(saved is Serializable)
            assertEquals(value.toList(), saved)
        }
    }
}
