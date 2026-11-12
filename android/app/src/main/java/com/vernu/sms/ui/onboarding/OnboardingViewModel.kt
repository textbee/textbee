package com.vernu.sms.ui.onboarding

import android.content.Context
import android.os.Build
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vernu.sms.ApiManagerKt
import com.vernu.sms.AppConstants
import com.vernu.sms.BuildConfig
import com.vernu.sms.TextbeeUtils
import com.vernu.sms.dtos.RegisterDeviceInputDTO
import com.vernu.sms.dtos.SimInfoCollectionDTO
import com.vernu.sms.helpers.ApiKeyStatus
import com.vernu.sms.helpers.Diagnostics
import com.vernu.sms.helpers.HeartbeatManager
import com.vernu.sms.helpers.InstallId
import com.vernu.sms.helpers.InstallSource
import com.vernu.sms.helpers.PushToken
import com.vernu.sms.helpers.RegistrationChecks
import com.vernu.sms.helpers.SharedPreferenceHelper
import com.vernu.sms.helpers.serverErrorMessage
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.suspendCoroutine

data class OnboardingState(
    val apiKey: String = "",
    val deviceId: String = "",
    val deviceName: String = "${Build.BRAND} ${Build.MODEL}",
    val isReturningUser: Boolean = false,
    val useExistingDeviceId: Boolean = false,
    val isQrScanned: Boolean = false,
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
    val registeredDeviceId: String? = null,
    val registeredDeviceName: String? = null,
    // Only the key changes; the device and its settings stay
    val isAddingApiKey: Boolean = false
)

class OnboardingViewModel(private val saved: SavedStateHandle) : ViewModel() {

    // The mode and the device survive process death, so a restored screen never registers a second device
    private val _state = MutableStateFlow(
        OnboardingState(
            deviceId = saved[KEY_DEVICE_ID] ?: "",
            isReturningUser = saved[KEY_RETURNING] ?: false,
            useExistingDeviceId = saved[KEY_USE_EXISTING] ?: false,
            isAddingApiKey = saved[KEY_ADDING_API_KEY] ?: false
        )
    )
    val state: StateFlow<OnboardingState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            _state.collect {
                saved[KEY_DEVICE_ID] = it.deviceId
                saved[KEY_RETURNING] = it.isReturningUser
                saved[KEY_USE_EXISTING] = it.useExistingDeviceId
                saved[KEY_ADDING_API_KEY] = it.isAddingApiKey
            }
        }
    }

    companion object {
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_RETURNING = "returning_user"
        private const val KEY_USE_EXISTING = "use_existing_device_id"
        private const val KEY_ADDING_API_KEY = "adding_api_key"
    }

    private val _registrationSuccess = Channel<Unit>(Channel.CONFLATED)
    val registrationSuccess = _registrationSuccess.receiveAsFlow()

    fun setApiKey(key: String) {
        _state.update { it.copy(apiKey = key.trim(), errorMessage = null, isQrScanned = false) }
    }

    fun onQrScanned(key: String) {
        _state.update { it.copy(apiKey = key.trim(), errorMessage = null, isQrScanned = true) }
    }

    fun setDeviceId(id: String) {
        _state.update { it.copy(deviceId = id.trim(), errorMessage = null) }
    }

    fun setDeviceName(name: String) {
        _state.update { it.copy(deviceName = name) }
    }

    fun setReturningUser(returning: Boolean) {
        _state.update { it.copy(isReturningUser = returning, useExistingDeviceId = returning) }
    }

    fun startAddApiKey(deviceId: String) {
        _state.update {
            it.copy(isAddingApiKey = true, isReturningUser = true, useExistingDeviceId = true, deviceId = deviceId)
        }
    }

    fun setUseExistingDeviceId(use: Boolean) {
        _state.update { it.copy(useExistingDeviceId = use, deviceId = if (!use) "" else it.deviceId) }
    }

    fun clearError() {
        _state.update { it.copy(errorMessage = null) }
    }

    fun registerOrUpdateDevice(context: Context) {
        val current = _state.value
        val apiKey = current.apiKey
        val storedDeviceId = SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_DEVICE_ID_KEY, ""
        ) ?: ""
        val request = RegistrationChecks.deviceRequest(
            current.isAddingApiKey, storedDeviceId,
            current.isReturningUser, current.useExistingDeviceId, current.deviceId
        )
        if (request == null) {
            _state.update { it.copy(errorMessage = "This phone is not connected to a device yet.") }
            return
        }
        val deviceId = request.deviceId
        val shouldUpdate = request.update

        if (apiKey.isEmpty()) {
            _state.update { it.copy(errorMessage = "Please enter your API key.") }
            return
        }
        if (!current.isAddingApiKey && (current.isReturningUser || current.useExistingDeviceId) && deviceId.isEmpty()) {
            _state.update { it.copy(errorMessage = "Please enter your Device ID.") }
            return
        }
        if (shouldUpdate && !RegistrationChecks.isValidDeviceId(deviceId)) {
            _state.update { it.copy(errorMessage = RegistrationChecks.INVALID_DEVICE_ID) }
            return
        }

        viewModelScope.launch {
            _state.update { it.copy(isLoading = true, errorMessage = null) }
            try {
                val fcmToken = try {
                    getFcmToken(context)
                } catch (e: Exception) {
                    _state.update {
                        it.copy(
                            isLoading = false,
                            errorMessage = RegistrationChecks.pushTokenFailureMessage(context)
                        )
                    }
                    TextbeeUtils.logException(e, "Onboarding push token request failed")
                    return@launch
                }
                val collectedSimInfo = SimInfoCollectionDTO().apply {
                    lastUpdated = System.currentTimeMillis()
                    sims = TextbeeUtils.collectSimInfo(context)
                }
                val input = RegisterDeviceInputDTO().apply {
                    this.fcmToken = fcmToken
                    // Adding a key leaves the gateway switch and the name as they are
                    enabled = if (current.isAddingApiKey) null else true
                    brand = Build.BRAND
                    manufacturer = Build.MANUFACTURER
                    model = Build.MODEL
                    buildId = Build.ID
                    os = "Android"
                    osVersion = Build.VERSION.RELEASE
                    osApiLevel = Build.VERSION.SDK_INT
                    osBuildFingerprint = Build.VERSION.BASE_OS
                    appVersionCode = BuildConfig.VERSION_CODE
                    appVersionName = BuildConfig.VERSION_NAME
                    name = if (current.isAddingApiKey) null else current.deviceName.ifEmpty { "${Build.BRAND} ${Build.MODEL}" }
                    simInfo = collectedSimInfo
                    if (current.isAddingApiKey) installId = InstallId.get(context)
                    InstallSource.applyTo(this, context)
                }

                val response = if (shouldUpdate) {
                    ApiManagerKt.getApiService().updateDevice(deviceId, apiKey, input)
                } else {
                    ApiManagerKt.getApiService().registerDevice(apiKey, input)
                }

                if (response.isSuccessful) {
                    val data = response.body()?.data
                        ?: throw IllegalStateException("missing_response")
                    val registeredId = data["_id"] as? String
                        ?: throw IllegalStateException("missing_id")
                    val name = data["name"] as? String ?: ""

                    SharedPreferenceHelper.setSharedPreferenceString(
                        context, AppConstants.SHARED_PREFS_DEVICE_ID_KEY, registeredId
                    )
                    SharedPreferenceHelper.setSharedPreferenceString(
                        context, AppConstants.SHARED_PREFS_API_KEY_KEY, apiKey
                    )
                    ApiKeyStatus.clear(context)
                    val resolvedName = name.ifEmpty { current.deviceName }
                    if (!current.isAddingApiKey || name.isNotEmpty()) {
                        SharedPreferenceHelper.setSharedPreferenceString(
                            context, AppConstants.SHARED_PREFS_DEVICE_NAME_KEY, resolvedName
                        )
                    }
                    if (current.isAddingApiKey) {
                        HeartbeatManager.triggerHeartbeat(context)
                    } else {
                        SharedPreferenceHelper.setSharedPreferenceBoolean(
                            context, AppConstants.SHARED_PREFS_GATEWAY_ENABLED_KEY, true
                        )
                        HeartbeatManager.scheduleHeartbeat(context)
                    }
                    Diagnostics.identify(context)

                    _state.update {
                        it.copy(
                            isLoading = false,
                            registeredDeviceId = registeredId,
                            registeredDeviceName = resolvedName
                        )
                    }
                    _registrationSuccess.send(Unit)
                } else {
                    _state.update {
                        it.copy(
                            isLoading = false,
                            errorMessage = when (response.code()) {
                                // The ID format is checked before the request, so a 400 is about another field.
                                400 -> response.serverErrorMessage() ?: "Request failed (400). Please try again."
                                401 -> if (current.isAddingApiKey) "This API key is not valid. Check it and try again."
                                       else "Invalid API key. Go back and check your key."
                                404 -> if (current.isAddingApiKey) "This API key belongs to a different account than this device."
                                       else "Device ID not found. Verify it in your dashboard."
                                429 -> response.serverErrorMessage()
                                    ?: "You've reached your plan's device limit. Disable or remove another device, or upgrade your plan."
                                in 500..599 -> "Server error. Please try again in a moment."
                                else -> "Request failed (${response.code()}). Please try again."
                            }
                        )
                    }
                }
            } catch (e: Exception) {
                val message = when {
                    e.message == "missing_id" -> "Unexpected server response. Please try again."
                    e.message?.contains("Unable to resolve host") == true ||
                    e.message?.contains("timeout") == true ||
                    e.message?.contains("connect") == true ->
                        "No internet connection. Check your network and retry."
                    else -> "Something went wrong. Please try again."
                }
                _state.update { it.copy(isLoading = false, errorMessage = message) }
                TextbeeUtils.logException(e, "Onboarding device registration failed")
            }
        }
    }

    private suspend fun getFcmToken(context: Context): String = suspendCoroutine { cont ->
        PushToken.get(context)
            .addOnSuccessListener { token -> cont.resume(token) }
            .addOnFailureListener { e -> cont.resumeWithException(e) }
    }
}
