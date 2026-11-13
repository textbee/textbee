package com.vernu.sms.services

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StickyStartTest {
    private val calls = mutableListOf<String>()

    private fun handle(wanted: Boolean, foregroundAllowed: Boolean = true) = StickyStart.handle(
        wanted = wanted,
        enterForeground = { calls += "enter"; foregroundAllowed },
        leaveForeground = { calls += "leave" }
    )

    @Test
    fun aWantedServiceEntersTheForegroundAndStaysUp() {
        assertTrue(handle(wanted = true))
        assertEquals(listOf("enter"), calls)
    }

    // Android wants the call after each start request, also when the service already runs
    @Test
    fun everyStartRequestEntersTheForeground() {
        repeat(3) { assertTrue(handle(wanted = true)) }
        assertEquals(listOf("enter", "enter", "enter"), calls)
    }

    @Test
    fun aServiceThatIsNotWantedEntersTheForegroundBeforeItStops() {
        assertFalse(handle(wanted = false))
        assertEquals(listOf("enter", "leave"), calls)
    }

    @Test
    fun aRefusedForegroundStopsTheService() {
        assertFalse(handle(wanted = true, foregroundAllowed = false))
        assertEquals(listOf("enter"), calls)
    }
}
