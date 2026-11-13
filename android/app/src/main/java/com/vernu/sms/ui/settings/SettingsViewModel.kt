package com.vernu.sms.ui.settings

import android.app.Application
import android.os.Build
import android.telephony.SubscriptionManager
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.vernu.sms.ApiManagerKt
import com.vernu.sms.AppConstants
import com.vernu.sms.BuildConfig
import com.vernu.sms.TextbeeUtils
import com.vernu.sms.dtos.RegisterDeviceInputDTO
import com.vernu.sms.helpers.ApiKeyStatus
import com.vernu.sms.helpers.HeartbeatManager
import com.vernu.sms.helpers.PreferredSim
import com.vernu.sms.helpers.SharedPreferenceHelper
import com.vernu.sms.helpers.SimReport
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONObject
import retrofit2.Response

/** One active SIM. [slot] is zero-based. */
data class SimOption(val slot: Int, val label: String)

data class SettingsState(
    val deviceId: String = "",
    val apiKey: String = "",
    val deviceName: String = "",
    val isGatewayEnabled: Boolean = false,
    val isReceiveSmsEnabled: Boolean = false,
    val isStickyNotificationEnabled: Boolean = false,
    val smsSendDelaySeconds: Int = AppConstants.DEFAULT_SMS_SEND_DELAY_SECONDS,
    val preferredSimSlot: Int = PreferredSim.NONE,
    val availableSims: List<SimOption> = emptyList(),
    val appVersionName: String = BuildConfig.VERSION_NAME,
    val appVersionCode: Int = BuildConfig.VERSION_CODE,
    val isSavingDeviceName: Boolean = false,
    val healthIssueCount: Int = 0,
    val isApiKeyRejected: Boolean = false,
    val snackbarMessage: String? = null
)

class SettingsViewModel(app: Application) : AndroidViewModel(app) {

    private val context get() = getApplication<Application>().applicationContext

    private val _state = MutableStateFlow(SettingsState())
    val state: StateFlow<SettingsState> = _state.asStateFlow()

    init {
        loadSettings()
    }

    private fun loadSettings() {
        val deviceId = SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_DEVICE_ID_KEY, ""
        ) ?: ""
        val apiKey = SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_API_KEY_KEY, ""
        ) ?: ""
        val deviceName = SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_DEVICE_NAME_KEY, ""
        ) ?: ""
        val isGatewayEnabled = SharedPreferenceHelper.getSharedPreferenceBoolean(
            context, AppConstants.SHARED_PREFS_GATEWAY_ENABLED_KEY, false
        )
        val isReceiveSms = SharedPreferenceHelper.getSharedPreferenceBoolean(
            context, AppConstants.SHARED_PREFS_RECEIVE_SMS_ENABLED_KEY, false
        )
        val isSticky = SharedPreferenceHelper.getSharedPreferenceBoolean(
            context, AppConstants.SHARED_PREFS_STICKY_NOTIFICATION_ENABLED_KEY, false
        )
        val smsDelay = SharedPreferenceHelper.getSharedPreferenceInt(
            context, AppConstants.SHARED_PREFS_SMS_SEND_DELAY_SECONDS_KEY,
            AppConstants.DEFAULT_SMS_SEND_DELAY_SECONDS
        )
        val preferredSlot = PreferredSim.slot(context)

        val sims = try {
            TextbeeUtils.getAvailableSimSlots(context).mapNotNull { info ->
                val slot = SimReport.usableSlotIndex(info.simSlotIndex) ?: return@mapNotNull null
                val carrier = (info.carrierName ?: info.displayName)?.toString()
                SimOption(slot = slot, label = SimReport.slotLabel(slot, carrier))
            }
                .distinctBy { it.slot }
                .sortedBy { it.slot }
        } catch (e: Exception) {
            emptyList()
        }

        _state.update {
            it.copy(
                deviceId = deviceId,
                apiKey = apiKey,
                deviceName = deviceName.ifEmpty { "${Build.BRAND} ${Build.MODEL}" },
                isGatewayEnabled = isGatewayEnabled,
                isReceiveSmsEnabled = isReceiveSms,
                isStickyNotificationEnabled = isSticky,
                smsSendDelaySeconds = smsDelay,
                preferredSimSlot = preferredSlot,
                availableSims = sims,
                healthIssueCount = DeviceHealthViewModel.issueCount(context),
                isApiKeyRejected = ApiKeyStatus.rejectedAt(context) > 0L
            )
        }
    }

    fun refresh() = loadSettings()

    fun setGatewayEnabled(enabled: Boolean) {
        val deviceId = _state.value.deviceId
        val apiKey = _state.value.apiKey
        if (deviceId.isEmpty() || apiKey.isEmpty()) return

        viewModelScope.launch {
            try {
                val input = RegisterDeviceInputDTO().apply { this.enabled = enabled }
                val response = ApiManagerKt.getApiService().updateDevice(deviceId, apiKey, input)
                ApiKeyStatus.record(context, response.code(), apiKey)
                _state.update { it.copy(isApiKeyRejected = ApiKeyStatus.rejectedAt(context) > 0L) }
                if (response.isSuccessful) {
                    SharedPreferenceHelper.setSharedPreferenceBoolean(
                        context, AppConstants.SHARED_PREFS_GATEWAY_ENABLED_KEY, enabled
                    )
                    _state.update { it.copy(isGatewayEnabled = enabled, healthIssueCount = DeviceHealthViewModel.issueCount(context)) }
                    if (enabled) {
                        TextbeeUtils.startStickyNotificationService(context)
                        HeartbeatManager.scheduleHeartbeat(context)
                    } else {
                        TextbeeUtils.stopStickyNotificationService(context)
                        HeartbeatManager.cancelHeartbeat(context)
                    }
                } else {
                    _state.update { it.copy(snackbarMessage = extractErrorMessage(response, "Failed to update gateway status")) }
                }
            } catch (e: Exception) {
                _state.update { it.copy(snackbarMessage = "Network error. Try again.") }
                TextbeeUtils.logException(e, "Gateway toggle from settings failed")
            }
        }
    }

    fun setReceiveSms(enabled: Boolean) {
        SharedPreferenceHelper.setSharedPreferenceBoolean(
            context, AppConstants.SHARED_PREFS_RECEIVE_SMS_ENABLED_KEY, enabled
        )
        _state.update { it.copy(isReceiveSmsEnabled = enabled) }
        HeartbeatManager.triggerHeartbeat(context)
    }

    fun setStickyNotification(enabled: Boolean) {
        SharedPreferenceHelper.setSharedPreferenceBoolean(
            context, AppConstants.SHARED_PREFS_STICKY_NOTIFICATION_ENABLED_KEY, enabled
        )
        try {
            if (enabled) TextbeeUtils.startStickyNotificationService(context)
            else TextbeeUtils.stopStickyNotificationService(context)
        } catch (e: Exception) {
            TextbeeUtils.logException(e, "Sticky notification toggle failed")
            _state.update { it.copy(snackbarMessage = "Could not start notification service") }
        }
        _state.update { it.copy(isStickyNotificationEnabled = enabled, healthIssueCount = DeviceHealthViewModel.issueCount(context)) }
        HeartbeatManager.triggerHeartbeat(context)
    }

    fun setSmsSendDelay(seconds: Int) {
        val clamped = seconds.coerceIn(0, 3600)
        SharedPreferenceHelper.setSharedPreferenceInt(
            context, AppConstants.SHARED_PREFS_SMS_SEND_DELAY_SECONDS_KEY, clamped
        )
        _state.update { it.copy(smsSendDelaySeconds = clamped) }
        HeartbeatManager.triggerHeartbeat(context)
    }

    fun setPreferredSim(slot: Int) {
        PreferredSim.save(context, slot)
        _state.update { it.copy(preferredSimSlot = slot) }
    }

    fun saveDeviceName(name: String) {
        val deviceId = _state.value.deviceId
        val apiKey = _state.value.apiKey
        if (deviceId.isEmpty() || apiKey.isEmpty() || name.isBlank()) return

        viewModelScope.launch {
            _state.update { it.copy(isSavingDeviceName = true) }
            try {
                val input = RegisterDeviceInputDTO().apply { this.name = name.trim() }
                val response = ApiManagerKt.getApiService().updateDevice(deviceId, apiKey, input)
                if (response.isSuccessful) {
                    SharedPreferenceHelper.setSharedPreferenceString(
                        context, AppConstants.SHARED_PREFS_DEVICE_NAME_KEY, name.trim()
                    )
                    _state.update { it.copy(deviceName = name.trim(), snackbarMessage = "Device name saved") }
                } else {
                    _state.update { it.copy(snackbarMessage = extractErrorMessage(response, "Failed to save device name")) }
                }
            } catch (e: Exception) {
                _state.update { it.copy(snackbarMessage = "Network error. Try again.") }
                TextbeeUtils.logException(e, "Save device name failed")
            } finally {
                _state.update { it.copy(isSavingDeviceName = false) }
            }
        }
    }

    fun clearSnackbar() = _state.update { it.copy(snackbarMessage = null) }

    private fun extractErrorMessage(response: Response<*>, fallback: String): String {
        return try {
            val body = response.errorBody()?.string()
            if (!body.isNullOrBlank()) {
                val json = JSONObject(body)
                json.optString("message").takeIf { it.isNotBlank() }
                    ?: json.optString("error").takeIf { it.isNotBlank() }
                    ?: fallback
            } else {
                fallback
            }
        } catch (e: Exception) {
            fallback
        }
    }
}
