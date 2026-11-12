package com.vernu.sms.helpers

import android.content.Context
import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.vernu.sms.AppConstants

enum class NoticeLevel { INFO, WARNING }

// The one banner the server can show at the top of the home screen
data class AppNotice(
    val id: String,
    val level: NoticeLevel,
    val text: String,
    val actionLabel: String? = null,
    val actionUrl: String? = null,
    val dismissible: Boolean = true,
)

object Notices {
    const val MAX_TEXT = 200
    const val MAX_LABEL = 30
    const val MAX_CLOSED = 10

    // Null when the value is not a usable notice
    fun parse(value: JsonElement?): AppNotice? {
        val obj = value?.takeIf { it.isJsonObject }?.asJsonObject ?: return null
        val id = DeviceConfig.stringOf(obj, "id")?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        val text = DeviceConfig.stringOf(obj, "text")?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        val label = DeviceConfig.stringOf(obj, "actionLabel")?.trim()?.takeIf { it.isNotEmpty() }
        val url = DeviceConfig.stringOf(obj, "actionUrl")?.trim()?.takeIf { it.startsWith("https://") }
        val hasAction = label != null && url != null
        return AppNotice(
            id = id,
            level = if (DeviceConfig.stringOf(obj, "level") == "warning") NoticeLevel.WARNING else NoticeLevel.INFO,
            text = cut(text, MAX_TEXT),
            actionLabel = if (hasAction) cut(label!!, MAX_LABEL) else null,
            actionUrl = if (hasAction) url else null,
            dismissible = DeviceConfig.boolOf(obj, "dismissible") ?: true,
        )
    }

    // Never ends on half of an emoji
    fun cut(text: String, max: Int): String {
        if (text.length <= max) return text
        val end = if (Character.isHighSurrogate(text[max - 1])) max - 1 else max
        return text.substring(0, end)
    }

    fun isVisible(notice: AppNotice?, closedIds: Collection<String>): Boolean =
        notice != null && !(notice.dismissible && notice.id in closedIds)

    // The newest last, at most MAX_CLOSED
    fun closedAfter(closedIds: List<String>, id: String): List<String> =
        (closedIds.filter { it != id } + id).takeLast(MAX_CLOSED)

    fun toJson(notice: AppNotice): String = JsonObject().apply {
        addProperty("id", notice.id)
        addProperty("level", notice.level.name.lowercase())
        addProperty("text", notice.text)
        notice.actionLabel?.let { addProperty("actionLabel", it) }
        notice.actionUrl?.let { addProperty("actionUrl", it) }
        addProperty("dismissible", notice.dismissible)
    }.toString()

    fun fromJson(json: String?): AppNotice? = try {
        if (json.isNullOrEmpty()) null else parse(JsonParser.parseString(json))
    } catch (e: Exception) {
        null
    }

    fun save(context: Context, notice: AppNotice?) {
        if (notice == null) {
            SharedPreferenceHelper.clearSharedPreference(context, AppConstants.SHARED_PREFS_CONFIG_NOTICE_KEY)
        } else {
            SharedPreferenceHelper.setSharedPreferenceString(
                context, AppConstants.SHARED_PREFS_CONFIG_NOTICE_KEY, toJson(notice)
            )
        }
    }

    fun current(context: Context): AppNotice? =
        fromJson(SharedPreferenceHelper.getSharedPreferenceString(context, AppConstants.SHARED_PREFS_CONFIG_NOTICE_KEY, null))

    fun closedIdsFromJson(json: String?): List<String> = try {
        if (json.isNullOrEmpty()) emptyList()
        else JsonParser.parseString(json).asJsonArray.mapNotNull { e ->
            e.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }?.asString
        }
    } catch (e: Exception) {
        emptyList()
    }

    fun closedIdsToJson(ids: List<String>): String = JsonArray().apply { ids.forEach { add(it) } }.toString()

    fun closedIds(context: Context): List<String> =
        closedIdsFromJson(SharedPreferenceHelper.getSharedPreferenceString(context, AppConstants.SHARED_PREFS_NOTICE_CLOSED_IDS_KEY, null))

    fun close(context: Context, id: String) =
        SharedPreferenceHelper.setSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_NOTICE_CLOSED_IDS_KEY, closedIdsToJson(closedAfter(closedIds(context), id))
        )

    // The notice to show now, or null
    fun visible(context: Context): AppNotice? = current(context)?.takeIf { isVisible(it, closedIds(context)) }
}
