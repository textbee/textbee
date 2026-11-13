package com.vernu.sms.ui.dashboard

import android.app.Application
import android.content.SharedPreferences
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.vernu.sms.ApiManagerKt
import com.vernu.sms.AppConstants
import com.vernu.sms.TextbeeUtils
import com.vernu.sms.dtos.RegisterDeviceInputDTO
import com.vernu.sms.dtos.SimInfoDTO
import com.vernu.sms.dtos.SubscriptionResponse
import com.vernu.sms.dtos.UserProfile
import com.vernu.sms.helpers.ApiKeyStatus
import com.vernu.sms.helpers.AppNotice
import com.vernu.sms.helpers.HeartbeatManager
import com.vernu.sms.helpers.NoticeNotifier
import com.vernu.sms.helpers.Notices
import com.vernu.sms.helpers.SharedPreferenceHelper
import com.vernu.sms.helpers.serverErrorMessage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class DashboardState(
    val deviceName: String = "",
    val deviceId: String = "",
    val isGatewayEnabled: Boolean = false,
    val lastHeartbeatMs: Long? = null,
    val isTogglingGateway: Boolean = false,
    val subscription: SubscriptionResponse? = null,
    val isSubscriptionLoading: Boolean = true,
    val subscriptionUnavailable: Boolean = false,
    val userProfile: UserProfile? = null,
    val availableSims: List<SimInfoDTO> = emptyList(),
    val isReceiveSmsEnabled: Boolean = false,
    val notices: List<AppNotice> = emptyList(),
    val isApiKeyRejected: Boolean = false,
    val userMessage: String? = null
)

class DashboardViewModel(app: Application) : AndroidViewModel(app) {

    private val context get() = getApplication<Application>().applicationContext

    private val _state = MutableStateFlow(DashboardState())
    val state: StateFlow<DashboardState> = _state.asStateFlow()

    // Held here because SharedPreferences keeps only a weak reference
    private val bannerListener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
        when (key) {
            in BANNER_KEYS -> loadBanners()
            AppConstants.SHARED_PREFS_API_KEY_KEY -> {
                // What the old key showed belongs to it, so it goes before the new replies arrive
                _state.update { it.copy(userProfile = null, subscription = null) }
                fetchSubscription()
                fetchUserProfile()
            }
            AppConstants.SHARED_PREFS_RECEIVE_SMS_ENABLED_KEY -> _state.update {
                it.copy(isReceiveSmsEnabled = SharedPreferenceHelper.getSharedPreferenceBoolean(
                    context, AppConstants.SHARED_PREFS_RECEIVE_SMS_ENABLED_KEY, false
                ))
            }
        }
    }

    init {
        loadLocalState()
        fetchSubscription()
        fetchUserProfile()
        SharedPreferenceHelper.preferences(context).registerOnSharedPreferenceChangeListener(bannerListener)
    }

    override fun onCleared() {
        SharedPreferenceHelper.preferences(context).unregisterOnSharedPreferenceChangeListener(bannerListener)
    }

    // The banners change when a heartbeat or an upload runs in the background, and notices expire
    fun loadBanners() {
        val notices = Notices.visible(context)
        _state.update {
            it.copy(notices = notices, isApiKeyRejected = ApiKeyStatus.rejectedAt(context) > 0L)
        }
        // A notification goes with its banner
        NoticeNotifier.cancelHidden(context)
    }

    fun closeNotice(id: String) {
        Notices.close(context, id)
        loadBanners()
    }

    fun refresh() {
        loadLocalState()
        fetchSubscription()
        fetchUserProfile()
    }

    private fun loadLocalState() {
        val deviceName = SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_DEVICE_NAME_KEY, ""
        ) ?: ""
        val deviceId = SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_DEVICE_ID_KEY, ""
        ) ?: ""
        val isEnabled = SharedPreferenceHelper.getSharedPreferenceBoolean(
            context, AppConstants.SHARED_PREFS_GATEWAY_ENABLED_KEY, false
        )
        val lastHeartbeatStr = SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_LAST_HEARTBEAT_MS_KEY, ""
        )
        val lastHeartbeatMs = lastHeartbeatStr?.toLongOrNull()

        val sims = try {
            TextbeeUtils.collectSimInfo(context)
        } catch (e: Exception) {
            emptyList<SimInfoDTO>()
        }
        val isReceiveSms = SharedPreferenceHelper.getSharedPreferenceBoolean(
            context, AppConstants.SHARED_PREFS_RECEIVE_SMS_ENABLED_KEY, false
        )

        _state.update {
            it.copy(
                deviceName = deviceName,
                deviceId = deviceId,
                isGatewayEnabled = isEnabled,
                lastHeartbeatMs = lastHeartbeatMs,
                availableSims = sims,
                isReceiveSmsEnabled = isReceiveSms
            )
        }
        loadBanners()

        // Restarted on every launch, since the OS kills the service on modern Android
        if (isEnabled) {
            TextbeeUtils.startStickyNotificationService(context)
            if (deviceId.isNotEmpty()) HeartbeatManager.scheduleHeartbeat(context)
        }
    }

    private fun currentApiKey(): String =
        SharedPreferenceHelper.getSharedPreferenceString(context, AppConstants.SHARED_PREFS_API_KEY_KEY, "") ?: ""

    // A reply made with a replaced key must not overwrite the newer one
    private fun isStale(apiKey: String) = !ApiKeyStatus.isCurrentKey(apiKey, currentApiKey())

    private fun fetchUserProfile() {
        val apiKey = currentApiKey()
        if (apiKey.isEmpty()) return
        viewModelScope.launch {
            try {
                val response = ApiManagerKt.getApiService().whoAmI(apiKey)
                ApiKeyStatus.record(context, response.code(), apiKey)
                if (isStale(apiKey)) return@launch
                if (response.isSuccessful) {
                    _state.update { it.copy(userProfile = response.body()?.data) }
                }
            } catch (e: Exception) {
                TextbeeUtils.logException(e, "User profile fetch failed")
            }
        }
    }

    private fun fetchSubscription() {
        val apiKey = currentApiKey()
        if (apiKey.isEmpty()) {
            _state.update { it.copy(isSubscriptionLoading = false, subscriptionUnavailable = true) }
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(isSubscriptionLoading = true, subscriptionUnavailable = false) }
            try {
                val response = ApiManagerKt.getApiService().getCurrentSubscription(apiKey)
                ApiKeyStatus.record(context, response.code(), apiKey)
                if (isStale(apiKey)) return@launch
                if (response.isSuccessful) {
                    _state.update { it.copy(isSubscriptionLoading = false, subscription = response.body()) }
                } else {
                    _state.update { it.copy(isSubscriptionLoading = false, subscriptionUnavailable = true) }
                }
            } catch (e: Exception) {
                if (!isStale(apiKey)) _state.update { it.copy(isSubscriptionLoading = false, subscriptionUnavailable = true) }
                TextbeeUtils.logException(e, "Subscription fetch failed")
            }
        }
    }

    companion object {
        private val BANNER_KEYS = setOf(
            AppConstants.SHARED_PREFS_CONFIG_NOTICE_KEY,
            AppConstants.SHARED_PREFS_CONFIG_NOTICES_SAVED_AT_KEY,
            AppConstants.SHARED_PREFS_NOTICE_CLOSED_IDS_KEY,
            AppConstants.SHARED_PREFS_API_KEY_REJECTED_AT_KEY,
        )
    }

    fun consumeUserMessage() {
        _state.update { it.copy(userMessage = null) }
    }

    fun setReceiveSms(enabled: Boolean) {
        SharedPreferenceHelper.setSharedPreferenceBoolean(
            context, AppConstants.SHARED_PREFS_RECEIVE_SMS_ENABLED_KEY, enabled
        )
        _state.update { it.copy(isReceiveSmsEnabled = enabled) }
        HeartbeatManager.triggerHeartbeat(context)
    }

    fun toggleGateway(enabled: Boolean) {
        val deviceId = _state.value.deviceId
        val apiKey = SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_API_KEY_KEY, ""
        ) ?: ""
        if (deviceId.isEmpty() || apiKey.isEmpty()) return

        viewModelScope.launch {
            _state.update { it.copy(isTogglingGateway = true) }
            try {
                val input = RegisterDeviceInputDTO().apply { this.enabled = enabled }
                val response = ApiManagerKt.getApiService().updateDevice(deviceId, apiKey, input)
                ApiKeyStatus.record(context, response.code(), apiKey)
                if (response.isSuccessful) {
                    SharedPreferenceHelper.setSharedPreferenceBoolean(
                        context, AppConstants.SHARED_PREFS_GATEWAY_ENABLED_KEY, enabled
                    )
                    _state.update { it.copy(isGatewayEnabled = enabled) }
                    try {
                        if (enabled) {
                            if (SharedPreferenceHelper.getSharedPreferenceBoolean(
                                    context, AppConstants.SHARED_PREFS_STICKY_NOTIFICATION_ENABLED_KEY, false
                                )
                            ) {
                                TextbeeUtils.startStickyNotificationService(context)
                            }
                            HeartbeatManager.scheduleHeartbeat(context)
                        } else {
                            TextbeeUtils.stopStickyNotificationService(context)
                            HeartbeatManager.cancelHeartbeat(context)
                        }
                    } catch (e: Exception) {
                        TextbeeUtils.logException(e, "Gateway service toggle failed")
                    }
                    _state.update {
                        it.copy(
                            userMessage = if (enabled) "Gateway enabled" else "Gateway disabled"
                        )
                    }
                } else {
                    // Surface the server's reason (e.g. device-limit 429) so the
                    // toggle doesn't silently snap back with no explanation.
                    val message = response.serverErrorMessage()
                        ?: if (response.code() == 429) {
                            "You've reached your plan's device limit. Disable or remove another device, or upgrade your plan."
                        } else {
                            "Couldn't update the gateway. Please try again."
                        }
                    _state.update { it.copy(userMessage = message) }
                }
            } catch (e: Exception) {
                TextbeeUtils.logException(e, "Gateway toggle failed")
                _state.update { it.copy(userMessage = "Couldn't update the gateway. Please check your connection.") }
            } finally {
                _state.update { it.copy(isTogglingGateway = false) }
            }
        }
    }
}
