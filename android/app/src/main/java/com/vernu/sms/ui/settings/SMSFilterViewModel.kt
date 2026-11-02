package com.vernu.sms.ui.settings

import android.Manifest
import android.app.Application
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import java.util.concurrent.atomic.AtomicInteger
import androidx.lifecycle.viewModelScope
import com.vernu.sms.TextbeeUtils
import com.vernu.sms.helpers.SMSFilterHelper
import com.vernu.sms.models.SMSFilterRule
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** One active SIM in the phone. [slot] is zero-based. */
data class FilterSimOption(val slot: Int, val carrier: String?)

data class FilterSimState(
    // False until the first read, so the screen does not flash the
    // permission prompt while the SIMs load.
    val loaded: Boolean = false,
    // True while a read runs. Taps wait, so they never use a stale SIM list.
    val refreshing: Boolean = true,
    val permissionGranted: Boolean = false,
    // SIM slots the phone hardware supports. Readable without permission.
    val modemCount: Int = 1,
    val sims: List<FilterSimOption> = emptyList()
)

class SMSFilterViewModel(app: Application) : AndroidViewModel(app) {

    private val _config = MutableStateFlow(SMSFilterHelper.loadFilterConfig(app))
    val config: StateFlow<SMSFilterHelper.FilterConfig> = _config.asStateFlow()

    private val _simState = MutableStateFlow(FilterSimState())
    val simState: StateFlow<FilterSimState> = _simState.asStateFlow()

    // The screen calls refreshSims on every resume, including the first.
    private val refreshGeneration = AtomicInteger()

    fun refreshSims() {
        val generation = refreshGeneration.incrementAndGet()
        _simState.update { it.copy(refreshing = true) }
        // Telephony reads can be slow, so they stay off the main thread.
        viewModelScope.launch(Dispatchers.IO) {
            val next = loadSims()
            // An older read never replaces a newer one.
            if (generation == refreshGeneration.get()) _simState.value = next
        }
    }

    private fun loadSims(): FilterSimState {
        val context = getApplication<Application>()
        val granted = ContextCompat.checkSelfPermission(
            context, Manifest.permission.READ_PHONE_STATE
        ) == PackageManager.PERMISSION_GRANTED
        val sims = if (granted) {
            runCatching { TextbeeUtils.collectSimInfo(context) }.getOrDefault(emptyList())
                .mapNotNull { info ->
                    val slot = info.simSlotIndex?.takeIf { it >= 0 } ?: return@mapNotNull null
                    val carrier = (info.carrierName ?: info.displayName)?.trim()?.takeIf { it.isNotEmpty() }
                    FilterSimOption(slot, carrier)
                }
                .distinctBy { it.slot }
                .sortedBy { it.slot }
        } else {
            emptyList()
        }
        return FilterSimState(
            loaded = true,
            refreshing = false,
            permissionGranted = granted,
            modemCount = modemCount(context),
            sims = sims
        )
    }

    fun setEnabled(enabled: Boolean) = mutate { it.enabled = enabled }

    fun setMode(mode: SMSFilterHelper.FilterMode) = mutate { it.mode = mode }

    fun addRule(rule: SMSFilterRule) = mutate { it.rules.add(rule) }

    fun updateRule(index: Int, rule: SMSFilterRule) = mutate { it.rules[index] = rule }

    fun deleteRule(index: Int) = mutate { it.rules.removeAt(index) }

    /** Returns false when the tap would untick the last SIM. */
    fun toggleSimSlot(slot: Int): Boolean {
        if (_simState.value.refreshing) return true
        val next = SMSFilterHelper.toggleSimSlot(
            _config.value.allowedSimSlots.orEmpty(),
            _simState.value.sims.map { it.slot },
            slot
        ) ?: return false
        mutate { it.allowedSimSlots = next.toMutableList() }
        return true
    }

    fun allowAllSims() = mutate { it.allowedSimSlots = mutableListOf() }

    private fun mutate(block: (SMSFilterHelper.FilterConfig) -> Unit) {
        val current = _config.value
        val copy = SMSFilterHelper.FilterConfig().apply {
            enabled = current.enabled
            mode = current.mode
            rules = ArrayList(current.rules)
            allowedSimSlots = ArrayList(current.allowedSimSlots.orEmpty())
        }
        block(copy)
        _config.value = copy
        SMSFilterHelper.saveFilterConfig(getApplication(), copy)
    }

    private fun modemCount(context: Context): Int = runCatching {
        val telephony = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
            ?: return@runCatching 1
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            telephony.activeModemCount
        } else {
            @Suppress("DEPRECATION")
            telephony.phoneCount
        }
    }.getOrDefault(1)
}
