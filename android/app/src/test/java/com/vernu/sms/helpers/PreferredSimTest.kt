package com.vernu.sms.helpers

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PreferredSimTest {
    @Test
    fun movesAnOldIdToTheSlotOfItsActiveSim() {
        assertEquals(1, PreferredSim.migratedSlot(savedSlot = PreferredSim.NONE, legacySubscriptionId = 19, legacySlot = 1))
        assertEquals(0, PreferredSim.migratedSlot(PreferredSim.NONE, 3, 0))
    }

    @Test
    fun neverOverwritesASavedSlot() {
        assertNull(PreferredSim.migratedSlot(savedSlot = 0, legacySubscriptionId = 19, legacySlot = 1))
    }

    @Test
    fun nothingToMoveWithoutAnOldId() {
        assertNull(PreferredSim.migratedSlot(PreferredSim.NONE, PreferredSim.NONE, null))
    }

    @Test
    fun waitsWhileTheOldSimIsNotInThePhone() {
        assertNull(PreferredSim.migratedSlot(PreferredSim.NONE, 19, null))
    }

    @Test
    fun keepsTheChosenSimIdForOlderBuilds() {
        assertEquals(4, PreferredSim.legacyIdToSave(slot = 1, slotSubscriptionId = 4))
    }

    @Test
    fun clearsTheOldIdForTheSystemDefault() {
        assertNull(PreferredSim.legacyIdToSave(PreferredSim.NONE, null))
        assertNull(PreferredSim.legacyIdToSave(PreferredSim.NONE, 4))
    }

    @Test
    fun clearsTheOldIdWhenTheSlotHasNoActiveSim() {
        assertNull(PreferredSim.legacyIdToSave(1, null))
    }

    @Test
    fun ignoresAnImpossibleSlot() {
        assertNull(PreferredSim.migratedSlot(PreferredSim.NONE, 19, -1))
        assertNull(PreferredSim.migratedSlot(PreferredSim.NONE, 19, 8))
    }
}
