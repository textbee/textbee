package com.vernu.sms.helpers

import com.google.gson.Gson
import com.vernu.sms.helpers.SMSFilterHelper.Decision
import com.vernu.sms.helpers.SMSFilterHelper.FilterConfig
import com.vernu.sms.helpers.SMSFilterHelper.FilterMode
import com.vernu.sms.models.SMSFilterRule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SMSFilterHelperTest {
    private fun config(
        mode: FilterMode = FilterMode.BLOCK_LIST,
        slots: List<Int> = emptyList(),
        rules: List<SMSFilterRule> = emptyList(),
        enabled: Boolean = true
    ) = FilterConfig().apply {
        this.enabled = enabled
        this.mode = mode
        this.allowedSimSlots = slots.toMutableList()
        this.rules = rules.toMutableList()
    }

    private val bankRule = SMSFilterRule("BANK", SMSFilterRule.MatchType.CONTAINS)

    @Test
    fun noSimSelectionAllowsEverySim() {
        assertEquals(Decision.PROCESS, SMSFilterHelper.decide(config(), "BANK", "hi", 0))
        assertEquals(Decision.PROCESS, SMSFilterHelper.decide(config(), "BANK", "hi", 1))
    }

    @Test
    fun blocksSimOutsideTheSelectionEvenWithoutRules() {
        val c = config(slots = listOf(0))
        assertEquals(Decision.PROCESS, SMSFilterHelper.decide(c, "x", "hi", 0))
        assertEquals(Decision.BLOCKED_BY_SIM, SMSFilterHelper.decide(c, "x", "hi", 1))
    }

    @Test
    fun unknownSimPassesTheSimCheck() {
        val c = config(slots = listOf(0))
        assertEquals(Decision.PROCESS, SMSFilterHelper.decide(c, "x", "hi", null))
    }

    @Test
    fun unknownSimStillGoesThroughTheRules() {
        val c = config(mode = FilterMode.BLOCK_LIST, slots = listOf(0), rules = listOf(bankRule))
        assertEquals(Decision.BLOCKED_BY_RULES, SMSFilterHelper.decide(c, "BANK", "hi", null))
    }

    @Test
    fun disabledFilterIgnoresTheSimSelection() {
        val c = config(slots = listOf(0), enabled = false)
        assertEquals(Decision.PROCESS, SMSFilterHelper.decide(c, "x", "hi", 1))
        assertFalse(SMSFilterHelper.filtersBySim(c))
    }

    @Test
    fun allowListNeedsTheSimAndARule() {
        val c = config(mode = FilterMode.ALLOW_LIST, slots = listOf(0), rules = listOf(bankRule))
        assertEquals(Decision.PROCESS, SMSFilterHelper.decide(c, "BANK", "hi", 0))
        assertEquals(Decision.BLOCKED_BY_RULES, SMSFilterHelper.decide(c, "SHOP", "hi", 0))
        assertEquals(Decision.BLOCKED_BY_SIM, SMSFilterHelper.decide(c, "BANK", "hi", 1))
    }

    @Test
    fun blockListBlocksOnEitherCheck() {
        val c = config(mode = FilterMode.BLOCK_LIST, slots = listOf(1), rules = listOf(bankRule))
        assertEquals(Decision.PROCESS, SMSFilterHelper.decide(c, "SHOP", "hi", 1))
        assertEquals(Decision.BLOCKED_BY_RULES, SMSFilterHelper.decide(c, "BANK", "hi", 1))
        assertEquals(Decision.BLOCKED_BY_SIM, SMSFilterHelper.decide(c, "SHOP", "hi", 0))
    }

    @Test
    fun configSavedBeforeThisFeatureLoadsAsAllSims() {
        val old = """{"enabled":true,"mode":"BLOCK_LIST","rules":[]}"""
        val c = Gson().fromJson(old, FilterConfig::class.java)
        assertTrue(c.allowedSimSlots.orEmpty().isEmpty())
        assertEquals(Decision.PROCESS, SMSFilterHelper.decide(c, "x", "hi", 1))
    }

    @Test
    fun nullSlotListMeansAllSims() {
        val c = Gson().fromJson("""{"enabled":true,"allowedSimSlots":null}""", FilterConfig::class.java)
        assertEquals(Decision.PROCESS, SMSFilterHelper.decide(c, "x", "hi", 1))
        assertFalse(SMSFilterHelper.filtersBySim(c))
    }

    @Test
    fun untickingFromAllSimsSavesTheRest() {
        assertEquals(listOf(0), SMSFilterHelper.toggleSimSlot(emptyList(), listOf(0, 1), 1))
        assertEquals(listOf(0, 2), SMSFilterHelper.toggleSimSlot(emptyList(), listOf(0, 1, 2), 1))
    }

    @Test
    fun tickingEverySimSavesAllSims() {
        assertEquals(emptyList<Int>(), SMSFilterHelper.toggleSimSlot(listOf(0), listOf(0, 1), 1))
    }

    @Test
    fun cannotUntickTheLastSim() {
        assertNull(SMSFilterHelper.toggleSimSlot(listOf(0), listOf(0, 1), 0))
    }

    @Test
    fun removedSimStaysUntilUnticked() {
        // SIM 2 was allowed, then taken out. Ticking SIM 1 keeps both.
        assertEquals(listOf(0, 1), SMSFilterHelper.toggleSimSlot(listOf(1), listOf(0), 0))
        // Unticking the removed SIM now leaves only what is in the phone.
        assertEquals(emptyList<Int>(), SMSFilterHelper.toggleSimSlot(listOf(0, 1), listOf(0), 1))
    }

    @Test
    fun cannotLeaveOnlySimsThatAreNotInThePhone() {
        // SIM 2 was taken out. Unticking SIM 1 would block every SMS.
        assertNull(SMSFilterHelper.toggleSimSlot(listOf(0, 1), listOf(0), 0))
    }

    @Test
    fun tapWithNoSimsReadSavesThatSlot() {
        assertEquals(listOf(0), SMSFilterHelper.toggleSimSlot(emptyList(), emptyList(), 0))
    }

    @Test
    fun savedSlotListSurvivesGson() {
        val json = Gson().toJson(config(slots = listOf(0, 2)))
        val c = Gson().fromJson(json, FilterConfig::class.java)
        assertEquals(Decision.PROCESS, SMSFilterHelper.decide(c, "x", "hi", 0))
        assertEquals(Decision.BLOCKED_BY_SIM, SMSFilterHelper.decide(c, "x", "hi", 1))
        assertEquals(Decision.PROCESS, SMSFilterHelper.decide(c, "x", "hi", 2))
        assertTrue(SMSFilterHelper.filtersBySim(c))
    }

    @Test
    fun nullSenderStillGetsTheSimCheck() {
        val c = config(slots = listOf(0))
        assertEquals(Decision.BLOCKED_BY_SIM, SMSFilterHelper.decide(c, null, "hi", 1))
        assertEquals(Decision.PROCESS, SMSFilterHelper.decide(c, null, "hi", 0))
    }
}
