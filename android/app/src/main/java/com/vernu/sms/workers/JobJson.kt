package com.vernu.sms.workers

import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.vernu.sms.dtos.SMSDTO

// Job input JSON without HTML escaping, so < > & = ' take one byte; older escaped input reads the same
object JobJson {
    private val gson: Gson = GsonBuilder().disableHtmlEscaping().create()

    fun toJson(sms: SMSDTO): String = gson.toJson(sms)

    fun fromJson(json: String): SMSDTO = gson.fromJson(json, SMSDTO::class.java)
}
