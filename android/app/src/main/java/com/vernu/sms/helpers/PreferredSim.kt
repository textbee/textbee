package com.vernu.sms.helpers

import android.content.Context
import com.vernu.sms.AppConstants
import com.vernu.sms.TextbeeUtils

/**
 * The SIM the user picked for sends that name no SIM. Saved by zero-based slot.
 * Builds before the slot release saved a subscription id; that id is moved to
 * its slot once the SIM is in the phone, and honored until then.
 */
object PreferredSim {
    const val NONE = -1

    /** The slot to save for an old subscription id preference, or null when nothing should be written. */
    fun migratedSlot(savedSlot: Int, legacySubscriptionId: Int, legacySlot: Int?): Int? = when {
        savedSlot != NONE -> null
        legacySubscriptionId == NONE -> null
        else -> SimReport.usableSlotIndex(legacySlot)
    }

    /** The preferred slot, or [NONE]. Moves an old preference to its slot on the way. */
    @JvmStatic
    fun slot(context: Context): Int {
        val saved = SharedPreferenceHelper.getSharedPreferenceInt(
            context, AppConstants.SHARED_PREFS_PREFERRED_SIM_SLOT_KEY, NONE
        )
        if (saved != NONE) return saved
        val legacy = legacySubscriptionId(context)
        val legacySlot = if (legacy == NONE) null else activeSlotFor(context, legacy)
        val migrated = migratedSlot(saved, legacy, legacySlot) ?: return NONE
        SharedPreferenceHelper.setSharedPreferenceInt(
            context, AppConstants.SHARED_PREFS_PREFERRED_SIM_SLOT_KEY, migrated
        )
        return migrated
    }

    /** The subscription to send from, or null when no preference is set or its SIM is not in the phone. */
    fun subscriptionId(context: Context): Int? {
        val slot = slot(context)
        if (slot != NONE) return SimLookup.activeSubscriptionIdForSlot(context, slot)
        val legacy = legacySubscriptionId(context)
        return if (legacy != NONE && TextbeeUtils.isValidSubscriptionId(context, legacy)) legacy else null
    }

    /**
     * The id to keep under the old key, so an older build still finds the choice,
     * or null to clear it: for the system default or a slot with no active SIM.
     */
    fun legacyIdToSave(slot: Int, slotSubscriptionId: Int?): Int? =
        if (slot == NONE) null else slotSubscriptionId

    /** Saves a slot, or [NONE] for the system default. This build reads the old key only while no slot is saved. */
    @JvmStatic
    fun save(context: Context, slot: Int) {
        SharedPreferenceHelper.setSharedPreferenceInt(
            context, AppConstants.SHARED_PREFS_PREFERRED_SIM_SLOT_KEY, slot
        )
        val slotSubscriptionId = if (slot == NONE) null else SimLookup.activeSubscriptionIdForSlot(context, slot)
        val legacyId = legacyIdToSave(slot, slotSubscriptionId)
        if (legacyId != null) {
            SharedPreferenceHelper.setSharedPreferenceInt(context, AppConstants.SHARED_PREFS_PREFERRED_SIM_KEY, legacyId)
        } else {
            SharedPreferenceHelper.clearSharedPreference(context, AppConstants.SHARED_PREFS_PREFERRED_SIM_KEY)
        }
    }

    private fun legacySubscriptionId(context: Context): Int = SharedPreferenceHelper.getSharedPreferenceInt(
        context, AppConstants.SHARED_PREFS_PREFERRED_SIM_KEY, NONE
    )

    private fun activeSlotFor(context: Context, subscriptionId: Int): Int? = try {
        TextbeeUtils.getAvailableSimSlots(context)
            .firstOrNull { it.subscriptionId == subscriptionId }
            ?.let { SimReport.usableSlotIndex(it.simSlotIndex) }
    } catch (e: Exception) {
        null
    }
}
