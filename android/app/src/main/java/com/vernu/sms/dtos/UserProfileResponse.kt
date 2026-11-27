package com.vernu.sms.dtos

import com.google.gson.JsonElement
import com.google.gson.annotations.SerializedName

data class UserProfileWrapper(
    @SerializedName("data") val data: UserProfile? = null
)

data class UserProfile(
    @SerializedName("name") val name: String? = null,
    @SerializedName("email") val email: String? = null,
    // Read as any JSON value, so a later change of its type can never fail the whole answer
    @SerializedName("accountLabel") val accountLabelValue: JsonElement? = null
) {
    /** What the Settings "Account" row shows. Null when missing (older servers) or not a text or number. */
    val accountLabel: String?
        get() = accountLabelValue
            ?.takeIf { it.isJsonPrimitive && !it.asJsonPrimitive.isBoolean }
            ?.asString
}
