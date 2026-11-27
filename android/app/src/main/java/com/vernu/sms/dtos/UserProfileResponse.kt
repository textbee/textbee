package com.vernu.sms.dtos

import com.google.gson.annotations.SerializedName

data class UserProfileWrapper(
    @SerializedName("data") val data: UserProfile? = null
)

data class UserProfile(
    @SerializedName("name") val name: String? = null,
    @SerializedName("email") val email: String? = null,
    // What the Settings "Account" row shows. Missing on older servers.
    @SerializedName("accountLabel") val accountLabel: String? = null
)
