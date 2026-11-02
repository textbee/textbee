package com.vernu.sms.helpers

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.telephony.SubscriptionInfo
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import android.util.Log
import androidx.core.content.ContextCompat
import com.vernu.sms.dtos.SimUsedDTO

/**
 * Describes one SIM for a message report. Every read is optional: a missing
 * permission, an old Android version or a telephony error leaves that part
 * null, and nothing here ever throws into the caller.
 */
object SimLookup {
    private const val TAG = "SimLookup"

    // Extras the framework puts on SMS_RECEIVED. The named constants arrived
    // in API 26; the plain keys are what older frameworks set.
    private val SUBSCRIPTION_EXTRAS = listOf("android.telephony.extra.SUBSCRIPTION_INDEX", "subscription")
    // "phone" is the phone id, which equals the logical slot.
    private val SLOT_EXTRAS = listOf("android.telephony.extra.SLOT_INDEX", "slot", "phone")

    /** The SIM an incoming message arrived on, or null when the intent does not say. */
    fun fromReceivedIntent(context: Context, intent: Intent): SimUsedDTO? {
        return try {
            val subscriptionId = SimReport.usableSubscriptionId(firstIntExtra(intent, SUBSCRIPTION_EXTRAS))
            val slotIndex = SimReport.usableSlotIndex(firstIntExtra(intent, SLOT_EXTRAS))
                ?: slotForSubscription(subscriptionId)
            describe(context, subscriptionId, slotIndex)
        } catch (e: Exception) {
            Log.w(TAG, "Could not read the SIM of a received SMS: ${e.message}")
            null
        }
    }

    /** The SIM behind a subscription id, with whatever details Android exposes. */
    fun describe(context: Context, subscriptionId: Int?, slotIndex: Int? = null): SimUsedDTO? {
        val dto = SimUsedDTO()
        dto.subscriptionId = SimReport.usableSubscriptionId(subscriptionId)
        dto.slotIndex = SimReport.usableSlotIndex(slotIndex)
        val id = dto.subscriptionId
        if (id != null) {
            try {
                activeSubscription(context, id)?.let { fill(context, dto, it) }
            } catch (e: Exception) {
                Log.d(TAG, "Could not describe subscription $id: ${e.message}")
            }
        }
        return SimReport.compact(dto)
    }

    /** The subscription Android sends SMS from when none is chosen, or null when unknown. */
    fun defaultSmsSubscriptionId(): Int? = try {
        SimReport.usableSubscriptionId(SubscriptionManager.getDefaultSmsSubscriptionId())
    } catch (e: Exception) {
        null
    }

    // Needs no permission, so the SIM filter works with phone access denied.
    private fun slotForSubscription(subscriptionId: Int?): Int? {
        if (subscriptionId == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null
        return runCatching { SimReport.usableSlotIndex(SubscriptionManager.getSlotIndex(subscriptionId)) }
            .getOrNull()
    }

    private fun firstIntExtra(intent: Intent, keys: List<String>): Int? {
        for (key in keys) {
            if (intent.hasExtra(key)) {
                val value = intent.getIntExtra(key, -1)
                if (value != -1) return value
            }
        }
        return null
    }

    // Q and up have the codes as strings. Before Q the int getters drop the
    // leading zeros of the mnc, so the operator string "MCCMNC" is used instead.
    private fun networkCodes(context: Context, info: SubscriptionInfo): Pair<String?, String?> {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val mcc = runCatching { info.mccString }.getOrNull()
            val mnc = runCatching { info.mncString }.getOrNull()
            return SimReport.mccOrNull(mcc) to SimReport.mncOrNull(mnc)
        }
        val operator = runCatching {
            val telephony = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
            telephony?.createForSubscriptionId(info.subscriptionId)?.simOperator
        }.getOrNull()
        return SimReport.splitOperator(operator)
    }

    private fun activeSubscription(context: Context, subscriptionId: Int): SubscriptionInfo? {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE) ==
            PackageManager.PERMISSION_GRANTED
        if (!granted) return null
        val manager = context.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as? SubscriptionManager
            ?: return null
        return manager.getActiveSubscriptionInfo(subscriptionId)
    }

    private fun fill(context: Context, dto: SimUsedDTO, info: SubscriptionInfo) {
        if (dto.slotIndex == null) {
            dto.slotIndex = runCatching { SimReport.usableSlotIndex(info.simSlotIndex) }.getOrNull()
        }
        dto.carrierName = runCatching { info.carrierName?.toString()?.trim()?.takeIf { it.isNotEmpty() } }.getOrNull()
        dto.displayName = runCatching { info.displayName?.toString()?.trim()?.takeIf { it.isNotEmpty() } }.getOrNull()
        dto.countryIso = runCatching { info.countryIso?.trim()?.lowercase()?.takeIf { it.isNotEmpty() } }.getOrNull()
        val (mcc, mnc) = networkCodes(context, info)
        dto.mcc = mcc
        dto.mnc = mnc
    }
}
