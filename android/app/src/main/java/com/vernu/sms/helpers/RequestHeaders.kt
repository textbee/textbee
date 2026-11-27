package com.vernu.sms.helpers

import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.os.Build
import android.provider.Settings
import android.util.Log
import java.security.MessageDigest

// The facts that name this install, this phone and the app's signer, sent with every API call
object RequestHeaders {
    private const val TAG = "RequestHeaders"

    const val INSTALL_ID = "x-install-id"
    const val PHONE_ID = "x-phone-id"
    const val APP_SIGNER = "x-app-signer"

    // Fixed so the server sees the same phone ID from every build
    const val PHONE_ID_PREFIX = "textbee-phone-id:"

    // A value Android gave many phones of one old model
    private const val SHARED_ANDROID_ID = "9774d56d682e549c"

    private const val MAX_VALUE_LENGTH = 64

    @Volatile
    private var appContext: Context? = null

    @Volatile
    private var phoneId: String? = null

    @Volatile
    private var signer: String? = null

    @JvmStatic
    fun init(context: Context) {
        appContext = context.applicationContext
    }

    /** The headers for the next call. Empty before [init]. Never throws. */
    @JvmStatic
    fun current(): Map<String, String> {
        val context = appContext ?: return emptyMap()
        return try {
            build(InstallId.storedOrNull(context), phoneId(context), signer(context))
        } catch (e: Exception) {
            Log.w(TAG, "Headers not read: ${e.message}")
            emptyMap()
        }
    }

    /** Leaves out every value that is missing or that a header cannot carry. */
    fun build(installId: String?, phoneId: String?, signer: String?): Map<String, String> {
        val headers = LinkedHashMap<String, String>()
        listOf(INSTALL_ID to installId, PHONE_ID to phoneId, APP_SIGNER to signer).forEach { (name, raw) ->
            val value = raw?.trim().orEmpty()
            if (value.isNotEmpty() && value.length <= MAX_VALUE_LENGTH && value.all { it.code in 0x21..0x7E }) {
                headers[name] = value
            }
        }
        return headers
    }

    /** The Android ID as the phone ID input, or null when it is missing or not unique to a phone. */
    fun cleanAndroidId(raw: String?): String? {
        val value = raw?.trim()?.lowercase() ?: return null
        return when {
            value.isEmpty() -> null
            value.all { it == '0' } -> null
            value == SHARED_ANDROID_ID || value == "unknown" || value == "null" -> null
            else -> value
        }
    }

    /** A hash of the Android ID. The raw value never leaves the phone. */
    fun phoneIdFrom(androidId: String?): String? =
        cleanAndroidId(androidId)?.let { sha256Hex((PHONE_ID_PREFIX + it).toByteArray(Charsets.UTF_8)) }

    fun sha256Hex(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    @SuppressLint("HardwareIds")
    private fun phoneId(context: Context): String? =
        phoneId ?: try {
            phoneIdFrom(Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID))
                ?.also { phoneId = it }
        } catch (e: Exception) {
            null
        }

    private fun signer(context: Context): String? =
        signer ?: try {
            firstSigner(context)?.let { sha256Hex(it.toByteArray()) }?.also { signer = it }
        } catch (e: Exception) {
            null
        }

    // The first certificate the app was signed with, so a later key rotation keeps the value
    @Suppress("DEPRECATION")
    private fun firstSigner(context: Context): Signature? {
        val pm = context.packageManager
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val info = pm.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo
                ?: return null
            val certs = if (info.hasMultipleSigners()) info.apkContentsSigners else info.signingCertificateHistory
            certs?.firstOrNull()
        } else {
            pm.getPackageInfo(context.packageName, PackageManager.GET_SIGNATURES).signatures?.firstOrNull()
        }
    }
}
