package com.vernu.sms.helpers

import android.content.Context
import android.util.Log
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.vernu.sms.AppConstants
import com.vernu.sms.models.SMSFilterRule

object SMSFilterHelper {
    private const val TAG = "SMSFilterHelper"

    enum class FilterMode { ALLOW_LIST, BLOCK_LIST }

    class FilterConfig {
        @get:JvmName("isEnabled") var enabled: Boolean = false
        var mode: FilterMode = FilterMode.BLOCK_LIST
        var rules: MutableList<SMSFilterRule> = mutableListOf()

        // Zero-based SIM slots to receive from. Empty means every SIM, so a
        // SIM added later is allowed. Nullable because Gson can write null.
        var allowedSimSlots: MutableList<Int>? = mutableListOf()
    }

    enum class Decision { PROCESS, BLOCKED_BY_SIM, BLOCKED_BY_RULES }

    /**
     * The SIM check runs first, then the rules. A message whose SIM slot is
     * unknown passes the SIM check: dropping it would lose every message on
     * phones that do not report the SIM.
     */
    @JvmStatic
    fun decide(config: FilterConfig, sender: String?, message: String?, simSlot: Int?): Decision {
        if (!config.enabled) return Decision.PROCESS
        val slots = config.allowedSimSlots.orEmpty()
        if (slots.isNotEmpty() && simSlot != null && simSlot !in slots) {
            return Decision.BLOCKED_BY_SIM
        }
        if (config.rules.isEmpty()) return Decision.PROCESS
        val matchesAnyRule = config.rules.any { it.matches(sender, message) }
        val process = if (config.mode == FilterMode.ALLOW_LIST) matchesAnyRule else !matchesAnyRule
        return if (process) Decision.PROCESS else Decision.BLOCKED_BY_RULES
    }

    /** True when a SIM selection is saved and the SIM check needs the slot. */
    @JvmStatic
    fun filtersBySim(config: FilterConfig): Boolean =
        config.enabled && config.allowedSimSlots.orEmpty().isNotEmpty()

    /**
     * The selection to save after the user taps a SIM. [saved] is the stored
     * list and [present] the slots in the phone now. Returns null when the
     * tap would untick the last SIM in the phone. Ticking every SIM in the
     * phone saves an empty list, so a SIM added later is allowed.
     */
    @JvmStatic
    fun toggleSimSlot(saved: List<Int>, present: List<Int>, slot: Int): List<Int>? {
        val ticked = (if (saved.isEmpty()) present else saved).toMutableSet()
        if (!ticked.remove(slot)) ticked.add(slot)
        if (ticked.isEmpty()) return null
        // Leaving only SIMs that are not in the phone would block every SMS.
        if (present.isNotEmpty() && ticked.none { it in present }) return null
        if (present.isNotEmpty() && ticked == present.toSet()) return emptyList()
        return ticked.sorted()
    }

    @JvmStatic
    fun loadFilterConfig(context: Context): FilterConfig {
        val json = SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_SMS_FILTER_CONFIG_KEY, null
        )
        if (json.isNullOrEmpty()) return FilterConfig()
        return try {
            val type = object : TypeToken<FilterConfig>() {}.type
            Gson().fromJson<FilterConfig>(json, type) ?: FilterConfig()
        } catch (e: Exception) {
            Log.e(TAG, "Error loading filter config: ${e.message}")
            FilterConfig()
        }
    }

    @JvmStatic
    fun saveFilterConfig(context: Context, config: FilterConfig) {
        try {
            SharedPreferenceHelper.setSharedPreferenceString(
                context,
                AppConstants.SHARED_PREFS_SMS_FILTER_CONFIG_KEY,
                Gson().toJson(config)
            )
        } catch (e: Exception) {
            Log.e(TAG, "Error saving filter config: ${e.message}")
        }
    }

}
