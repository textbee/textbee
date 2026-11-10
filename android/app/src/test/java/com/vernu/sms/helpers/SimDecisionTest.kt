package com.vernu.sms.helpers

import org.junit.Assert.assertEquals
import org.junit.Test

class SimDecisionTest {
    @Test
    fun slotWithoutPhonePermissionFailsAsPermissionDenied() {
        val decision = SimReport.decide(
            requestedSlot = 1, phonePermission = false, slotSubscriptionId = null,
            requestedId = 19, requestedValid = true, preferredId = 7
        )
        assertEquals(SimDecision(null, "requested_slot", "PERMISSION_DENIED"), decision)
    }

    @Test
    fun slotWithASimSendsFromIt() {
        val decision = SimReport.decide(
            requestedSlot = 1, phonePermission = true, slotSubscriptionId = 4,
            requestedId = null, requestedValid = false, preferredId = 7
        )
        assertEquals(SimDecision(4, "requested_slot"), decision)
    }

    @Test
    fun slotWinsOverARequestedId() {
        val decision = SimReport.decide(
            requestedSlot = 0, phonePermission = true, slotSubscriptionId = 3,
            requestedId = 19, requestedValid = true, preferredId = null
        )
        assertEquals(SimDecision(3, "requested_slot"), decision)
    }

    @Test
    fun emptySlotFailsWithoutFallingBack() {
        val decision = SimReport.decide(
            requestedSlot = 1, phonePermission = true, slotSubscriptionId = null,
            requestedId = 19, requestedValid = true, preferredId = 7
        )
        assertEquals(SimDecision(null, "requested_slot_empty", "SIM_SLOT_EMPTY"), decision)
    }

    @Test
    fun validRequestedIdIsUsedAsToday() {
        val decision = SimReport.decide(
            requestedSlot = null, phonePermission = true, slotSubscriptionId = null,
            requestedId = 19, requestedValid = true, preferredId = 7
        )
        assertEquals(SimDecision(19, "requested"), decision)
    }

    @Test
    fun invalidRequestedIdFallsBackAsToday() {
        assertEquals(
            SimDecision(7, "requested_invalid_fallback"),
            SimReport.decide(null, true, null, 18, false, 7)
        )
        assertEquals(
            SimDecision(null, "requested_invalid_fallback"),
            SimReport.decide(null, true, null, 18, false, null)
        )
    }

    @Test
    fun noRequestUsesThePreferredSim() {
        assertEquals(SimDecision(7, "app_preferred"), SimReport.decide(null, true, null, null, false, 7))
    }

    @Test
    fun noRequestAndNoPreferenceUsesTheSystemDefault() {
        assertEquals(SimDecision(null, "system_default"), SimReport.decide(null, true, null, null, false, null))
    }

    @Test
    fun noSlotIgnoresThePhonePermission() {
        assertEquals(SimDecision(null, "system_default"), SimReport.decide(null, false, null, null, false, null))
    }

    @Test
    fun copyTextIsReadyToPasteIntoARequest() {
        assertEquals("\"simSlotIndex\": 0", SimReport.slotRequestField(0))
        assertEquals("\"simSlotIndex\": 1", SimReport.slotRequestField(1))
    }

    @Test
    fun slotLabelMatchesTheSimFilter() {
        assertEquals("SIM 2 · Smart", SimReport.slotLabel(1, "Smart"))
        assertEquals("SIM 1", SimReport.slotLabel(0, null))
        assertEquals("SIM 1", SimReport.slotLabel(0, "  "))
    }
}
