package com.vernu.sms.helpers

import com.google.gson.Gson
import com.vernu.sms.dtos.SimUsedDTO

/**
 * The SIM a send uses: [subscriptionId] (null for the system default) and why.
 * A non-null [errorCode] means the message must fail without sending.
 */
data class SimDecision(
    val subscriptionId: Int?,
    val selection: String,
    val errorCode: String? = null,
)

/** The SIM a send went through and why it was picked. Carried through the status pending intents. */
data class SimReport(
    val simUsed: SimUsedDTO? = null,
    val selection: String? = null,
) {
    fun toJson(): String = Gson().toJson(this)

    companion object {
        const val SELECTION_REQUESTED = "requested"
        const val SELECTION_REQUESTED_INVALID_FALLBACK = "requested_invalid_fallback"
        const val SELECTION_APP_PREFERRED = "app_preferred"
        const val SELECTION_SYSTEM_DEFAULT = "system_default"
        const val SELECTION_REQUESTED_SLOT = "requested_slot"
        const val SELECTION_REQUESTED_SLOT_EMPTY = "requested_slot_empty"

        const val ERROR_PERMISSION_DENIED = "PERMISSION_DENIED"
        const val ERROR_SIM_SLOT_EMPTY = "SIM_SLOT_EMPTY"

        // Android sentinels: -1 is INVALID_SUBSCRIPTION_ID, Int.MAX_VALUE is DEFAULT_SUBSCRIPTION_ID
        private const val MAX_SLOT_INDEX = 7

        /** A real subscription id, or null for the sentinels Android uses for "none" and "default". */
        fun usableSubscriptionId(id: Int?): Int? =
            if (id == null || id < 0 || id == Int.MAX_VALUE) null else id

        /** A real slot index, or null for "unknown". */
        fun usableSlotIndex(slot: Int?): Int? =
            if (slot == null || slot < 0 || slot > MAX_SLOT_INDEX) null else slot

        /**
         * Why the send used the SIM it did. A requested id that matched no active
         * SIM is a fallback whatever the device fell back to.
         */
        fun selectionFor(requestedId: Int?, requestedValid: Boolean, preferredValid: Boolean): String = when {
            requestedId != null && requestedValid -> SELECTION_REQUESTED
            requestedId != null -> SELECTION_REQUESTED_INVALID_FALLBACK
            preferredValid -> SELECTION_APP_PREFERRED
            else -> SELECTION_SYSTEM_DEFAULT
        }

        /**
         * Which SIM a send uses. A requested slot wins over a requested id and is
         * never replaced by another SIM: without phone access or a SIM in that
         * slot the message fails. The SIM lookups are done by the caller.
         */
        fun decide(
            requestedSlot: Int?,
            phonePermission: Boolean,
            slotSubscriptionId: Int?,
            requestedId: Int?,
            requestedValid: Boolean,
            preferredId: Int?,
        ): SimDecision = when {
            requestedSlot != null && !phonePermission ->
                SimDecision(null, SELECTION_REQUESTED_SLOT, ERROR_PERMISSION_DENIED)
            requestedSlot != null && slotSubscriptionId == null ->
                SimDecision(null, SELECTION_REQUESTED_SLOT_EMPTY, ERROR_SIM_SLOT_EMPTY)
            requestedSlot != null -> SimDecision(slotSubscriptionId, SELECTION_REQUESTED_SLOT)
            requestedId != null && requestedValid -> SimDecision(requestedId, selectionFor(requestedId, true, false))
            else -> SimDecision(preferredId, selectionFor(requestedId, false, preferredId != null))
        }

        /** What the SIM Cards copy button puts on the clipboard, ready to paste into a request body. */
        fun slotRequestField(slot: Int): String = "\"simSlotIndex\": $slot"

        /** "SIM 2 · Smart", or "SIM 2" when the carrier is unknown. Same style as the SIM filter. */
        fun slotLabel(slot: Int, carrier: String?): String {
            val name = carrier?.trim()?.takeIf { it.isNotEmpty() }
            return if (name != null) "SIM ${slot + 1} · $name" else "SIM ${slot + 1}"
        }

        private val MCC = Regex("^[0-9]{3}$")
        private val MNC = Regex("^[0-9]{2,3}$")

        // ASCII digits only; "000" is what some phones report for unknown
        fun mccOrNull(value: String?): String? =
            value?.trim()?.takeIf { MCC.matches(it) && it != "000" }

        fun mncOrNull(value: String?): String? = value?.trim()?.takeIf { MNC.matches(it) }

        /** "310260" to ("310", "260"). Anything else gives nulls. */
        fun splitOperator(operator: String?): Pair<String?, String?> {
            val code = operator?.trim() ?: return null to null
            if (code.length !in 5..6) return null to null
            val mcc = mccOrNull(code.substring(0, 3)) ?: return null to null
            return mcc to mncOrNull(code.substring(3))
        }

        /** Nothing worth sending becomes null, so the upload stays as it was. */
        fun compact(dto: SimUsedDTO?): SimUsedDTO? =
            if (dto == null || dto.isEmpty()) null else dto

        fun fromJson(json: String?): SimReport? {
            if (json.isNullOrBlank()) return null
            return try {
                // An empty simUsed is kept: it tells the server the SIM is unknown
                Gson().fromJson(json, SimReport::class.java)
            } catch (e: Exception) {
                null
            }
        }
    }
}
