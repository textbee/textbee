package com.vernu.sms.receivers

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import com.vernu.sms.AppConstants
import com.vernu.sms.dtos.SMSDTO
import com.vernu.sms.helpers.DeviceLog
import com.vernu.sms.helpers.SMSFilterHelper
import com.vernu.sms.helpers.SharedPreferenceHelper
import com.vernu.sms.helpers.SimLookup
import com.vernu.sms.workers.SMSReceivedWorker
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

class SMSBroadcastReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "SMSBroadcastReceiver"
        private val processedFingerprints = ConcurrentHashMap<String, Long>()
        private const val CACHE_TTL_MS = 5000L
    }

    override fun onReceive(context: Context, intent: Intent) {
        Log.d(TAG, "onReceive: ${intent.action}")

        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) {
            Log.d(TAG, "Not Valid intent")
            return
        }

        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: run {
            Log.d(TAG, "No messages found")
            return
        }

        val deviceId = SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_DEVICE_ID_KEY, ""
        ) ?: ""
        val apiKey = SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_API_KEY_KEY, ""
        ) ?: ""
        val receiveSMSEnabled = SharedPreferenceHelper.getSharedPreferenceBoolean(
            context, AppConstants.SHARED_PREFS_RECEIVE_SMS_ENABLED_KEY, false
        )

        if (deviceId.isEmpty() || apiKey.isEmpty() || !receiveSMSEnabled) {
            Log.d(TAG, "Device ID or API Key is empty or Receive SMS Feature is disabled")
            return
        }

        val dto = SMSDTO()
        for (message in messages) {
            dto.message += message.messageBody ?: ""
            dto.sender = message.originatingAddress
            dto.receivedAtInMillis = message.timestampMillis
        }

        // The SIM is read first because the filter can check it.
        dto.simUsed = SimLookup.fromReceivedIntent(context, intent)
        val simSlot = dto.simUsed?.slotIndex

        val sender = dto.sender
        val filterConfig = SMSFilterHelper.loadFilterConfig(context)
        when (SMSFilterHelper.decide(filterConfig, sender, dto.message, simSlot)) {
            SMSFilterHelper.Decision.BLOCKED_BY_SIM -> {
                Log.d(TAG, "SMS from $sender on SIM ${simSlot!! + 1} filtered out by the SIM filter")
                DeviceLog.log(context, "sms_filtered", "from $sender, SIM ${simSlot + 1} not allowed")
                return
            }
            SMSFilterHelper.Decision.BLOCKED_BY_RULES -> {
                Log.d(TAG, "SMS from $sender filtered out by filter rules")
                DeviceLog.log(context, "sms_filtered", "from $sender, by rules")
                return
            }
            SMSFilterHelper.Decision.PROCESS -> {
                if (simSlot == null && SMSFilterHelper.filtersBySim(filterConfig)) {
                    DeviceLog.log(context, "sms_sim_unknown", "from $sender, SIM filter skipped")
                }
            }
        }

        val fingerprint = generateFingerprint(dto.sender, dto.message, dto.receivedAtInMillis)
        dto.fingerprint = fingerprint

        val currentTime = System.currentTimeMillis()
        val lastProcessedTime = processedFingerprints[fingerprint]
        if (lastProcessedTime != null && (currentTime - lastProcessedTime) < CACHE_TTL_MS) {
            Log.d(TAG, "Duplicate SMS detected in cache, skipping: $fingerprint")
            return
        }

        processedFingerprints[fingerprint] = currentTime
        cleanupCache(currentTime)

        DeviceLog.log(context, "sms_received", "from ${dto.sender}")
        SMSReceivedWorker.enqueueWork(context, deviceId, apiKey, dto)
    }

    private fun generateFingerprint(sender: String?, message: String, timestamp: Long): String {
        return try {
            val data = "${sender ?: ""}|$message|$timestamp"
            val hashBytes = MessageDigest.getInstance("MD5").digest(data.toByteArray(Charsets.UTF_8))
            hashBytes.joinToString("") { "%02x".format(it) }
        } catch (e: Exception) {
            Log.e(TAG, "Error generating fingerprint: ${e.message}")
            "${sender ?: ""}_${message}_$timestamp"
        }
    }

    private fun cleanupCache(currentTime: Long) {
        if (processedFingerprints.size > 100) {
            val keysToRemove = processedFingerprints.entries
                .filter { (currentTime - it.value) > CACHE_TTL_MS }
                .map { it.key }
            keysToRemove.forEach { processedFingerprints.remove(it) }
            Log.d(TAG, "Cleaned up ${keysToRemove.size} expired cache entries")
        }
    }
}
