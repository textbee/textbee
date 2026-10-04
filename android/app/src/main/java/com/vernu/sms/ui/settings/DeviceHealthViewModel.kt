package com.vernu.sms.ui.settings

import android.app.Application
import android.content.Context
import android.os.Build
import android.os.PowerManager
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.vernu.sms.AppConstants
import com.vernu.sms.TextbeeUtils
import com.vernu.sms.helpers.DeviceHealth
import com.vernu.sms.helpers.DeviceHealthRows
import com.vernu.sms.helpers.HealthInputs
import com.vernu.sms.helpers.HealthRow
import com.vernu.sms.helpers.HeartbeatHelper
import com.vernu.sms.helpers.HeartbeatManager
import com.vernu.sms.helpers.SharedPreferenceHelper
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Result of the manual heartbeat button, shown on the button itself. */
enum class HeartbeatSend { IDLE, SENDING, SENT, FAILED }

class DeviceHealthViewModel(app: Application) : AndroidViewModel(app) {
    private val context get() = getApplication<Application>().applicationContext

    private val _rows = MutableStateFlow<List<HealthRow>>(emptyList())
    val rows: StateFlow<List<HealthRow>> = _rows.asStateFlow()

    private val _heartbeatSend = MutableStateFlow(HeartbeatSend.IDLE)
    val heartbeatSend: StateFlow<HeartbeatSend> = _heartbeatSend.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        _rows.value = DeviceHealthRows.build(collect(context))
    }

    /** Sends one heartbeat off the main thread. The helper stores the new timestamp. */
    fun sendHeartbeatNow() {
        if (_heartbeatSend.value == HeartbeatSend.SENDING) return
        _heartbeatSend.value = HeartbeatSend.SENDING
        viewModelScope.launch {
            val ok = withContext(Dispatchers.IO) {
                try {
                    val deviceId = SharedPreferenceHelper.getSharedPreferenceString(
                        context, AppConstants.SHARED_PREFS_DEVICE_ID_KEY, ""
                    ) ?: ""
                    val apiKey = SharedPreferenceHelper.getSharedPreferenceString(
                        context, AppConstants.SHARED_PREFS_API_KEY_KEY, ""
                    ) ?: ""
                    HeartbeatHelper.sendHeartbeat(context, deviceId, apiKey)
                } catch (e: Exception) {
                    TextbeeUtils.logException(e, "Manual heartbeat failed")
                    false
                }
            }
            _heartbeatSend.value = if (ok) HeartbeatSend.SENT else HeartbeatSend.FAILED
            refresh()
        }
    }

    fun setStickyNotification(enabled: Boolean) {
        SharedPreferenceHelper.setSharedPreferenceBoolean(
            context, AppConstants.SHARED_PREFS_STICKY_NOTIFICATION_ENABLED_KEY, enabled
        )
        try {
            if (enabled) TextbeeUtils.startStickyNotificationService(context)
            else TextbeeUtils.stopStickyNotificationService(context)
        } catch (e: Exception) {
            TextbeeUtils.logException(e, "Sticky notification toggle from health screen failed")
        }
        HeartbeatManager.triggerHeartbeat(context)
        refresh()
    }

    companion object {
        fun collect(context: Context): HealthInputs {
            val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
            val ignoring = try {
                power?.isIgnoringBatteryOptimizations(context.packageName)
            } catch (e: Exception) {
                null
            }
            return HealthInputs(
                snapshot = DeviceHealth.evaluate(context),
                ignoringBatteryOptimizations = ignoring,
                powerSaveMode = power?.isPowerSaveMode ?: false,
                deviceIdleMode = power?.isDeviceIdleMode ?: false,
                sendDelaySeconds = SharedPreferenceHelper.getSharedPreferenceInt(
                    context, AppConstants.SHARED_PREFS_SMS_SEND_DELAY_SECONDS_KEY,
                    AppConstants.DEFAULT_SMS_SEND_DELAY_SECONDS
                ),
                lastHeartbeatMs = SharedPreferenceHelper.getSharedPreferenceString(
                    context, AppConstants.SHARED_PREFS_LAST_HEARTBEAT_MS_KEY, ""
                )?.toLongOrNull(),
                nowMs = System.currentTimeMillis(),
                manufacturer = Build.MANUFACTURER ?: "",
                gatewayEnabled = SharedPreferenceHelper.getSharedPreferenceBoolean(
                    context, AppConstants.SHARED_PREFS_GATEWAY_ENABLED_KEY, false
                ),
                sdkInt = Build.VERSION.SDK_INT,
            )
        }

        fun issueCount(context: Context): Int =
            DeviceHealthRows.issueCount(DeviceHealthRows.build(collect(context)))
    }
}
