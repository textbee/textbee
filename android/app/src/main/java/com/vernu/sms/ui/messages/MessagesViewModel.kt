package com.vernu.sms.ui.messages

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.vernu.sms.ApiManagerKt
import com.vernu.sms.AppConstants
import com.vernu.sms.dtos.SmsMessage
import com.vernu.sms.helpers.SharedPreferenceHelper
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class MessagesState(
    val messages: List<SmsMessage> = emptyList(),
    val isLoading: Boolean = true,
    val isLoadingMore: Boolean = false,
    val error: String? = null,
    val filter: String = "all",
    val currentPage: Int = 1,
    val totalPages: Int = 1,
    val total: Int = 0
)

const val EVENTS_FILTER = "events"

class MessagesViewModel(app: Application) : AndroidViewModel(app) {

    private val context get() = getApplication<Application>().applicationContext

    private val _state = MutableStateFlow(MessagesState())
    val state: StateFlow<MessagesState> = _state.asStateFlow()

    init {
        fetchMessages(reset = true)
    }

    fun setFilter(filter: String) {
        _state.update { it.copy(filter = filter, currentPage = 1) }
        if (filter != EVENTS_FILTER) fetchMessages(reset = true)
    }

    fun refresh() {
        if (_state.value.filter != EVENTS_FILTER) fetchMessages(reset = true)
    }

    fun loadMore() {
        val s = _state.value
        if (s.isLoadingMore || s.currentPage >= s.totalPages) return
        fetchMessages(reset = false, page = s.currentPage + 1)
    }

    private fun fetchMessages(reset: Boolean, page: Int = 1) {
        val apiKey = SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_API_KEY_KEY, ""
        ) ?: ""
        val deviceId = SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_DEVICE_ID_KEY, ""
        ) ?: ""
        if (apiKey.isEmpty() || deviceId.isEmpty()) {
            _state.update { it.copy(isLoading = false, error = "Device not connected") }
            return
        }

        val filter = _state.value.filter

        viewModelScope.launch {
            if (reset) {
                _state.update { it.copy(isLoading = true, error = null) }
            } else {
                _state.update { it.copy(isLoadingMore = true) }
            }
            try {
                val response = ApiManagerKt.getApiService()
                    .getMessages(deviceId, apiKey, page, 20, filter)
                if (response.isSuccessful) {
                    val body = response.body()
                    val newMessages = body?.data.orEmpty()
                    val meta = body?.meta
                    _state.update {
                        it.copy(
                            messages = if (reset) newMessages else it.messages + newMessages,
                            isLoading = false,
                            isLoadingMore = false,
                            error = null,
                            currentPage = page,
                            totalPages = meta?.totalPages ?: 1,
                            total = meta?.total ?: 0
                        )
                    }
                } else {
                    _state.update {
                        it.copy(isLoading = false, isLoadingMore = false, error = "Failed to load messages")
                    }
                }
            } catch (e: Exception) {
                _state.update {
                    it.copy(isLoading = false, isLoadingMore = false, error = "Network error")
                }
            }
        }
    }
}
