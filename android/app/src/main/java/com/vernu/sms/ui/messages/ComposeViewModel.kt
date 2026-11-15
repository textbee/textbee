package com.vernu.sms.ui.messages

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.vernu.sms.ApiManagerKt
import com.vernu.sms.AppConstants
import com.vernu.sms.dtos.SendSmsRequest
import com.vernu.sms.helpers.ApiKeyStatus
import com.vernu.sms.helpers.SharedPreferenceHelper
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONObject
import retrofit2.Response

data class ComposeState(
    val recipients: List<String> = emptyList(),
    val message: String = "",
    val isSending: Boolean = false,
    val sendError: String? = null,
    val upgradeUrl: String? = null,
    val sendSuccess: Boolean = false
)

const val UPGRADE_URL = "https://textbee.dev/pricing?ref=android-quota"

class ComposeViewModel(app: Application) : AndroidViewModel(app) {

    private val context get() = getApplication<Application>().applicationContext

    private val _state = MutableStateFlow(ComposeState())
    val state: StateFlow<ComposeState> = _state.asStateFlow()

    fun addRecipient(number: String) {
        _state.update { it.copy(recipients = it.recipients + number) }
    }

    fun removeRecipient(number: String) {
        _state.update { it.copy(recipients = it.recipients - number) }
    }

    fun setMessage(msg: String) {
        _state.update { it.copy(message = msg) }
    }

    fun clearError() {
        _state.update { it.copy(sendError = null, upgradeUrl = null) }
    }

    fun clearSuccess() {
        _state.update { it.copy(sendSuccess = false, message = "") }
    }

    private fun extractErrorMessage(response: Response<*>): String {
        return try {
            val body = response.errorBody()?.string()
            if (!body.isNullOrBlank()) {
                val json = JSONObject(body)
                json.optString("message").takeIf { it.isNotBlank() }
                    ?: json.optString("error").takeIf { it.isNotBlank() }
                    ?: "Failed to send (${response.code()})"
            } else {
                "Failed to send (${response.code()})"
            }
        } catch (e: Exception) {
            "Failed to send (${response.code()})"
        }
    }

    fun sendSms() {
        val apiKey = SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_API_KEY_KEY, ""
        ) ?: ""
        val deviceId = SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_DEVICE_ID_KEY, ""
        ) ?: ""
        if (apiKey.isEmpty() || deviceId.isEmpty()) return

        val s = _state.value
        if (s.recipients.isEmpty() || s.message.isEmpty()) return

        viewModelScope.launch {
            _state.update { it.copy(isSending = true, sendError = null) }
            try {
                val response = ApiManagerKt.getApiService().sendSms(
                    deviceId, apiKey, SendSmsRequest(s.message, s.recipients)
                )
                ApiKeyStatus.record(context, response.code(), apiKey)
                if (response.isSuccessful) {
                    _state.update { it.copy(isSending = false, sendSuccess = true) }
                } else {
                    _state.update {
                        it.copy(
                            isSending = false,
                            sendError = extractErrorMessage(response),
                            upgradeUrl = if (response.code() == 429) UPGRADE_URL else null
                        )
                    }
                }
            } catch (e: Exception) {
                _state.update {
                    it.copy(isSending = false, sendError = "Network error. Please try again.", upgradeUrl = null)
                }
            }
        }
    }
}
