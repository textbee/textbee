package com.vernu.sms.helpers

import android.content.Context
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability

// The request a setup submit makes: update this device ID, or register a new device
data class DeviceRequest(val update: Boolean, val deviceId: String = "")

object RegistrationChecks {
    // The dashboard shows device ids as 24-character hex strings.
    private val DEVICE_ID_PATTERN = Regex("^[0-9a-fA-F]{24}$")

    const val INVALID_DEVICE_ID =
        "This Device ID is not valid. A Device ID has 24 characters, only 0-9 and a-f. Copy it from your textbee dashboard."

    const val PUSH_TOKEN_FAILED =
        "Could not connect to Google Play services. Check your internet connection and try again."

    @JvmStatic
    fun isValidDeviceId(id: String): Boolean = DEVICE_ID_PATTERN.matches(id.trim())

    // A push naming another device reached a token this phone used before; no id means this phone
    fun isForOtherDevice(pushDeviceId: String?, storedDeviceId: String?): Boolean =
        !pushDeviceId.isNullOrEmpty() && pushDeviceId != storedDeviceId

    // Work tied to a device id runs only for the stored one; no id (older input) runs as before
    @JvmStatic
    fun isCurrentDevice(workDeviceId: String?, storedDeviceId: String?): Boolean =
        workDeviceId == null || (!storedDeviceId.isNullOrEmpty() && workDeviceId == storedDeviceId)

    // A rejected key is still a registration; only a missing id or key stops sending
    @JvmStatic
    fun hasRegistration(deviceId: String?, apiKey: String?): Boolean =
        !deviceId.isNullOrEmpty() && !apiKey.isNullOrEmpty()

    // Adding an API key always updates the stored device and never registers a new one. Null when no device is stored.
    fun deviceRequest(
        addingApiKey: Boolean, storedDeviceId: String,
        returningUser: Boolean, useExistingDeviceId: Boolean, enteredDeviceId: String,
    ): DeviceRequest? = when {
        addingApiKey -> storedDeviceId.takeIf { it.isNotEmpty() }?.let { DeviceRequest(true, it) }
        returningUser || (useExistingDeviceId && enteredDeviceId.isNotEmpty()) -> DeviceRequest(true, enteredDeviceId)
        else -> DeviceRequest(false)
    }

    /** Why this phone cannot get push messages, or null when Google Play services is usable. */
    @JvmStatic
    fun playServicesProblem(context: Context): String? = try {
        playServicesMessage(GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context))
    } catch (e: Exception) {
        null
    }

    @JvmStatic
    fun playServicesMessage(status: Int): String? = when (status) {
        ConnectionResult.SUCCESS -> null
        ConnectionResult.SERVICE_VERSION_UPDATE_REQUIRED, ConnectionResult.SERVICE_UPDATING ->
            "Google Play services is out of date on this phone. Update it in the Play Store, then try again."
        ConnectionResult.SERVICE_DISABLED ->
            "Google Play services is turned off on this phone. Turn it on in Settings > Apps, then try again."
        ConnectionResult.SERVICE_MISSING ->
            "This phone does not have Google Play services. textbee needs it to get messages to send, so it cannot work on this phone."
        ConnectionResult.SERVICE_INVALID ->
            "Google Play services on this phone is not genuine or is damaged. Reinstall or update it from the Play Store, then try again."
        else ->
            "Google Play services is not ready on this phone. Restart the phone and try again."
    }

    /** The message to show when the push token request fails. */
    @JvmStatic
    fun pushTokenFailureMessage(context: Context): String =
        playServicesProblem(context) ?: PUSH_TOKEN_FAILED
}
