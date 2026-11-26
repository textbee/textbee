package com.vernu.sms.ui.onboarding

import android.app.Application
import android.content.Context
import android.os.Build
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.google.android.gms.common.GoogleApiAvailability
import com.vernu.sms.ApiManagerKt
import com.vernu.sms.AppConstants
import com.vernu.sms.BuildConfig
import com.vernu.sms.TextbeeUtils
import com.vernu.sms.dtos.DeviceLinkInputDTO
import com.vernu.sms.dtos.RegisterDeviceInputDTO
import com.vernu.sms.dtos.SimInfoCollectionDTO
import com.vernu.sms.helpers.ApiKeyStatus
import com.vernu.sms.helpers.DeviceLink
import com.vernu.sms.helpers.DeviceLinkSession
import com.vernu.sms.helpers.DeviceLinkStore
import com.vernu.sms.helpers.Diagnostics
import com.vernu.sms.helpers.HeartbeatManager
import com.vernu.sms.helpers.InstallId
import com.vernu.sms.helpers.InstallSource
import com.vernu.sms.helpers.PushToken
import com.vernu.sms.helpers.RegistrationChecks
import com.vernu.sms.helpers.SharedPreferenceHelper
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import retrofit2.Response
import java.util.Locale
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

enum class SignInPhase { IDLE, CREATING, WAITING, FINISHING, DONE, FINISH_FAILED, ENDED }

const val GET_NEW_CODE = "Get a new code"
const val TRY_AGAIN = "Try again"
const val SIGN_IN_AGAIN = "Sign in with textbee"

// Google Play services can hang; the screen must not wait for ever
private const val PUSH_TOKEN_LIMIT_MS = 30_000L

data class SignInState(
    val phase: SignInPhase = SignInPhase.IDLE,
    val displayCode: String = "",
    val manualUrl: String = DeviceLink.FALLBACK_MANUAL_URL,
    val linkUrl: String? = null,
    val browserOpened: Boolean = false,
    val noBrowser: Boolean = false,
    val message: String? = null,
    // The button of an ended sign-in
    val actionLabel: String = GET_NEW_CODE,
    val accountEmail: String? = null,
    val deviceId: String? = null,
    val deviceName: String? = null,
    val reconnected: Boolean = false,
    // Sign-in cannot be used: the API key tabs open with this text
    val keyFallback: String? = null,
)

// Sign in with textbee: get a code, wait for the approval, then send the push address with the new key
class SignInViewModel(app: Application) : AndroidViewModel(app) {

    private val context: Context get() = getApplication<Application>().applicationContext

    private var session: DeviceLinkSession? =
        DeviceLinkStore.load(context)?.takeIf { it.canResume(System.currentTimeMillis()) }

    private val _state = MutableStateFlow(SignInState())
    val state: StateFlow<SignInState> = _state.asStateFlow()

    private val _openBrowser = Channel<String>(Channel.BUFFERED)
    val openBrowser = _openBrowser.receiveAsFlow()

    private var visible = false
    // The poll token of the request that is out, if any; its answer is always read
    private var pollInFlightFor: String? = null
    // The approval is only in memory: its save failed, so a restart would lose it
    private var approvalUnsaved = false
    private var pollSeconds: Double? = null
    private var createJob: Job? = null
    private var pollJob: Job? = null
    private var finishJob: Job? = null

    /** A sign-in that was in progress when the app was stopped. */
    val hasActiveSession: Boolean get() = session != null

    init {
        val restored = session
        if (restored == null) {
            DeviceLinkStore.clear(context)
        } else {
            pollSeconds = restored.pollSeconds
            _state.value = stateOf(restored, if (restored.isApproved) SignInPhase.FINISHING else SignInPhase.WAITING)
            if (restored.isApproved) finish()
        }
    }

    fun start() {
        if (_state.value.phase == SignInPhase.CREATING) return
        stopAll()
        _state.value = SignInState(phase = SignInPhase.CREATING)
        createJob = viewModelScope.launch {
            if (pushTokenOrNull() == null) {
                _state.value = SignInState(
                    phase = SignInPhase.ENDED,
                    message = RegistrationChecks.pushTokenFailureMessage(context),
                    actionLabel = TRY_AGAIN
                )
                return@launch
            }
            val (code, body) = call { ApiManagerKt.getApiService().createDeviceLink(createInput()) }
            ensureActive()
            when (val result = DeviceLink.createResult(code, body)) {
                is DeviceLink.CreateResult.Ready -> {
                    val request = result.request
                    val started = DeviceLinkSession(
                        displayCode = request.displayCode,
                        linkUrl = request.linkUrl,
                        manualUrl = request.manualUrl,
                        pollToken = request.pollToken,
                        pollSeconds = request.pollSeconds,
                        startedAtMs = System.currentTimeMillis(),
                    )
                    // Without the saved state the sign-in cannot survive the browser, so the code is not shown
                    if (!DeviceLinkStore.save(context, started)) {
                        DeviceLinkStore.clear(context)
                        _state.value = SignInState(
                            phase = SignInPhase.ENDED, message = DeviceLink.NOT_SAVED, actionLabel = TRY_AGAIN
                        )
                        return@launch
                    }
                    session = started
                    pollSeconds = request.pollSeconds
                    _state.value = stateOf(started, SignInPhase.WAITING)
                    if (request.autoOpenBrowser && request.linkUrl != null) _openBrowser.trySend(request.linkUrl)
                    maybePoll()
                }
                is DeviceLink.CreateResult.UseApiKey ->
                    _state.value = SignInState(phase = SignInPhase.IDLE, keyFallback = result.message)
                is DeviceLink.CreateResult.Failed ->
                    _state.value = SignInState(phase = SignInPhase.ENDED, message = result.message, actionLabel = TRY_AGAIN)
            }
        }
    }

    fun cancel() {
        stopAll()
        _state.value = SignInState()
    }

    fun clearKeyFallback() = _state.update { it.copy(keyFallback = null) }

    /** Polls only while the waiting screen is visible, and at once each time it becomes visible. */
    fun setVisible(isVisible: Boolean) {
        visible = isVisible
        val inFlight = DeviceLink.isSameAttempt(session?.pollToken, pollInFlightFor.orEmpty())
        val step = DeviceLink.visibilityStep(isVisible, pollJob?.isActive == true, inFlight)
        when (step) {
            DeviceLink.VisibilityStep.START -> maybePoll()
            DeviceLink.VisibilityStep.POLL_NOW -> {
                pollJob?.cancel()
                maybePoll()
            }
            DeviceLink.VisibilityStep.STOP -> pollJob?.cancel()
            // A poll that is out finishes; the loop then stops if the screen is hidden
            DeviceLink.VisibilityStep.KEEP -> Unit
        }
    }

    fun onBrowserResult(opened: Boolean) {
        val current = session ?: return
        if (opened && !current.browserOpened) {
            session = current.copy(browserOpened = true).also { DeviceLinkStore.save(context, it) }
        }
        _state.update { it.copy(browserOpened = it.browserOpened || opened, noBrowser = !opened) }
    }

    /** Repeats only the last step with the saved key and Device ID. */
    fun finish() {
        val approved = session?.takeIf { it.isApproved } ?: return
        if (finishJob?.isActive == true) return
        if (approvalUnsaved && DeviceLinkStore.save(context, approved)) approvalUnsaved = false
        val failureText = { message: String? -> DeviceLink.finishFailureText(!approvalUnsaved, message) }
        _state.update { it.copy(phase = SignInPhase.FINISHING, message = null) }
        finishJob = viewModelScope.launch {
            val token = pushTokenOrNull()
            if (token == null) {
                _state.update {
                    it.copy(phase = SignInPhase.FINISH_FAILED, message = failureText(RegistrationChecks.pushTokenFailureMessage(context)))
                }
                return@launch
            }
            val response = try {
                ApiManagerKt.getApiService().updateDevice(approved.deviceId!!, approved.apiKey!!, finishInput(token, approved.enable))
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                null
            }
            ensureActive()
            if (!DeviceLink.isSameAttempt(session?.takeIf { it.isApproved }?.pollToken, approved.pollToken)) return@launch
            val result = DeviceLink.finishResult(response?.code(), response?.takeIf { !it.isSuccessful }?.errorBody()?.string())
            when (result.step) {
                DeviceLink.FinishStep.DONE -> {
                    val name = saveConnection(approved, response?.body()?.data)
                    if (name == null) {
                        // The approved sign-in stays, so "Try again" can save it
                        _state.update { it.copy(phase = SignInPhase.FINISH_FAILED, message = failureText(DeviceLink.CONNECTION_NOT_SAVED)) }
                        return@launch
                    }
                    endSession()
                    _state.update { it.copy(phase = SignInPhase.DONE, deviceName = name, message = null) }
                }
                DeviceLink.FinishStep.RETRY ->
                    _state.update { it.copy(phase = SignInPhase.FINISH_FAILED, message = failureText(result.message)) }
                DeviceLink.FinishStep.END -> {
                    endSession()
                    _state.update {
                        it.copy(phase = SignInPhase.ENDED, message = result.message, actionLabel = SIGN_IN_AGAIN)
                    }
                }
            }
        }
    }

    private fun maybePoll() {
        val current = session ?: return
        if (!visible || current.isApproved || _state.value.phase != SignInPhase.WAITING) return
        if (pollJob?.isActive == true) return
        pollJob = viewModelScope.launch {
            while (visible) {
                // Checked only between polls, so an answer that is out is never dropped as expired
                if (DeviceLink.waitTimeUp(current.startedAtMs, System.currentTimeMillis())) {
                    end(DeviceLink.EXPIRED)
                    return@launch
                }
                // A started poll is always read to the end, so an approval is never lost
                pollInFlightFor = current.pollToken
                val result = try {
                    withContext(NonCancellable) {
                        val (code, body) = call {
                            ApiManagerKt.getApiService().pollDeviceLink(mapOf("pollToken" to current.pollToken))
                        }
                        DeviceLink.pollResult(code, body).also { settle(current, it) }
                    }
                } finally {
                    if (pollInFlightFor == current.pollToken) pollInFlightFor = null
                }
                if (!visible) return@launch
                when (result.step) {
                    DeviceLink.PollStep.WAIT -> {
                        result.pollSeconds?.let { pollSeconds = it }
                        delay(DeviceLink.pollDelayMs(pollSeconds))
                    }
                    DeviceLink.PollStep.SLOW_DOWN -> delay(DeviceLink.pollDelayMs(pollSeconds, slowDown = true))
                    else -> return@launch
                }
            }
        }
    }

    private fun settle(polled: DeviceLinkSession, result: DeviceLink.PollResult) {
        // An answer for a sign-in the user cancelled must not touch the one that replaced it
        if (!DeviceLink.isSameAttempt(session?.pollToken, polled.pollToken)) return
        when (result.step) {
            DeviceLink.PollStep.WAIT, DeviceLink.PollStep.SLOW_DOWN -> Unit
            DeviceLink.PollStep.APPROVED -> {
                val approved = result.approved ?: return
                val current = session ?: return
                val updated = current.copy(
                    apiKey = approved.apiKey,
                    deviceId = approved.deviceId,
                    deviceName = approved.deviceName,
                    accountEmail = approved.accountEmail,
                    reconnected = approved.reconnected,
                    enable = approved.enable,
                )
                session = updated
                // On a failed save the approval is finished from memory. The file is cleared, so a restart
                // never shows the old code as pending.
                approvalUnsaved = !DeviceLinkStore.save(context, updated)
                if (approvalUnsaved) DeviceLinkStore.clear(context)
                _state.value = stateOf(updated, SignInPhase.FINISHING)
                finish()
            }
            else -> end(result.message ?: DeviceLink.UNEXPECTED)
        }
    }

    private fun end(message: String) {
        endSession()
        _state.update { it.copy(phase = SignInPhase.ENDED, message = message, actionLabel = GET_NEW_CODE) }
    }

    private fun endSession() {
        approvalUnsaved = false
        pollJob?.cancel()
        session = null
        DeviceLinkStore.clear(context)
    }

    private fun stopAll() {
        createJob?.cancel()
        finishJob?.cancel()
        endSession()
    }

    // Stores the connection the way the API key path does. Returns the device name to show, or null when it was not saved.
    private fun saveConnection(approved: DeviceLinkSession, device: Map<String, Any?>?): String? {
        val name = approved.deviceName
            ?: (device?.get("name") as? String)?.takeIf { it.isNotBlank() }
            ?: "${Build.BRAND} ${Build.MODEL}"
        val prefs = SharedPreferenceHelper.preferences(context)
        // A device the user turned off stays off unless the server asked to turn it on
        val gatewayOn = approved.enable || (device?.get("enabled") as? Boolean
            ?: prefs.getBoolean(AppConstants.SHARED_PREFS_GATEWAY_ENABLED_KEY, false))
        val edit = prefs.edit()
            .putString(AppConstants.SHARED_PREFS_DEVICE_ID_KEY, approved.deviceId)
            .putString(AppConstants.SHARED_PREFS_API_KEY_KEY, approved.apiKey)
            .putString(AppConstants.SHARED_PREFS_DEVICE_NAME_KEY, name)
            .putBoolean(AppConstants.SHARED_PREFS_GATEWAY_ENABLED_KEY, gatewayOn)
        if (approved.accountEmail != null) edit.putString(AppConstants.SHARED_PREFS_ACCOUNT_EMAIL_KEY, approved.accountEmail)
        else edit.remove(AppConstants.SHARED_PREFS_ACCOUNT_EMAIL_KEY)
        if (!edit.commit()) return null
        ApiKeyStatus.clear(context)
        if (gatewayOn) {
            HeartbeatManager.scheduleHeartbeat(context)
            HeartbeatManager.triggerHeartbeat(context)
        }
        Diagnostics.identify(context)
        return name
    }

    private fun stateOf(session: DeviceLinkSession, phase: SignInPhase) = SignInState(
        phase = phase,
        displayCode = session.displayCode,
        manualUrl = session.manualUrl,
        linkUrl = session.linkUrl,
        browserOpened = session.browserOpened,
        accountEmail = session.accountEmail,
        deviceId = session.deviceId,
        deviceName = session.deviceName,
        reconnected = session.reconnected,
    )

    private fun createInput(): DeviceLinkInputDTO {
        val storedDeviceId = SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_DEVICE_ID_KEY, ""
        ).orEmpty()
        val storedKey = SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_API_KEY_KEY, ""
        ).orEmpty()
        return DeviceLinkInputDTO().apply {
            // The server accepts 1 to 60 characters per field
            deviceName = DeviceLink.cut("${Build.BRAND} ${Build.MODEL}".trim(), 60)
            brand = Build.BRAND?.trim()?.let { DeviceLink.cut(it, 60) }
            manufacturer = Build.MANUFACTURER?.trim()?.let { DeviceLink.cut(it, 60) }
            model = Build.MODEL?.trim()?.let { DeviceLink.cut(it, 60) }
            appVersionCode = BuildConfig.VERSION_CODE
            appVersionName = BuildConfig.VERSION_NAME
            osApiLevel = Build.VERSION.SDK_INT
            locale = Locale.getDefault().toLanguageTag()
            deviceId = storedDeviceId.takeIf { RegistrationChecks.isValidDeviceId(it) }
            installerPackage = InstallSource.get(context)?.installerPackage
            playServicesStatus = try {
                GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context)
            } catch (e: Exception) {
                null
            }
            hasStoredKey = storedKey.isNotEmpty()
            keyRejected = ApiKeyStatus.rejectedAt(context) > 0L
            clientProtocol = 1
        }
    }

    // The push address and the phone's facts, without a name: the name was chosen on the web page
    private fun finishInput(token: String, enable: Boolean) = RegisterDeviceInputDTO().apply {
        fcmToken = token
        if (enable) enabled = true
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
        simInfo = SimInfoCollectionDTO().apply {
            lastUpdated = System.currentTimeMillis()
            sims = TextbeeUtils.collectSimInfo(context)
        }
        installId = InstallId.get(context)
        InstallSource.applyTo(this, context)
    }

    // The HTTP code and body text, or nulls when no answer arrived
    private suspend fun call(request: suspend () -> Response<okhttp3.ResponseBody>): Pair<Int?, String?> = try {
        val response = request()
        val body = if (response.isSuccessful) response.body()?.string() else response.errorBody()?.string()
        response.code() to body
    } catch (e: Exception) {
        if (e is CancellationException) throw e
        null to null
    }

    // Null when no token comes within the limit. A Cancel stops the wait at once.
    private suspend fun pushTokenOrNull(): String? = try {
        withTimeoutOrNull(PUSH_TOKEN_LIMIT_MS) {
            suspendCancellableCoroutine<String> { cont ->
                PushToken.get(context)
                    .addOnSuccessListener { token -> if (cont.isActive) cont.resume(token) }
                    .addOnFailureListener { e -> if (cont.isActive) cont.resumeWithException(e) }
            }
        }
    } catch (e: Exception) {
        if (e is CancellationException) throw e
        TextbeeUtils.logException(e, "Sign-in push token request failed")
        null
    }
}
