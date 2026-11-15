package com.vernu.sms.helpers

import android.content.Context
import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.vernu.sms.AppConstants
import com.vernu.sms.BuildConfig
import java.math.BigDecimal
import java.math.RoundingMode

enum class NoticeLevel { INFO, WARNING, ERROR }

// What a notice button opens; the app links are a fixed list
sealed class NoticeAction {
    abstract val url: String

    data class Web(override val url: String) : NoticeAction()
    object DeviceHealth : NoticeAction() { override val url = "textbee://device-health" }
    object AddApiKey : NoticeAction() { override val url = "textbee://add-api-key" }
    object BatterySettings : NoticeAction() { override val url = "textbee://battery-settings" }

    companion object {
        // Null for any other link
        fun of(url: String): NoticeAction? = when {
            url.startsWith("https://") -> Web(url)
            url == DeviceHealth.url -> DeviceHealth
            url == AddApiKey.url -> AddApiKey
            url == BatterySettings.url -> BatterySettings
            else -> null
        }
    }
}

// One banner the server can show at the top of the home screen
data class AppNotice(
    val id: String,
    val level: NoticeLevel,
    val text: String,
    val title: String? = null,
    val actionLabel: String? = null,
    val action: NoticeAction? = null,
    val dismissible: Boolean = true,
    val maxAgeHours: Int? = null,
    val notify: Boolean = false,
)

object Notices {
    const val MAX_TEXT = 500
    const val MAX_TITLE = 80
    const val MAX_LABEL = 40
    const val MAX_ID = 64
    const val MAX_URL = 2048
    const val MAX_READ = 10
    const val MAX_SHOWN = 3
    const val MAX_CLOSED = 50
    const val MAX_AGE_HOURS = 8760
    private const val HOUR_MS = 3_600_000L

    // Not an array means no notices; invalid elements and repeated ids are dropped
    fun parseList(value: JsonElement?): List<AppNotice> {
        val array = value?.takeIf { it.isJsonArray }?.asJsonArray ?: return emptyList()
        val seen = HashSet<String>()
        return array.take(MAX_READ).mapNotNull { parse(it) }.filter { seen.add(it.id) }
    }

    // Null when the value is not a usable notice
    fun parse(value: JsonElement?): AppNotice? {
        val obj = value?.takeIf { it.isJsonObject }?.asJsonObject ?: return null
        val id = DeviceConfig.stringOf(obj, "id")?.trim()?.takeIf { it.isNotEmpty() && it.length <= MAX_ID } ?: return null
        val text = DeviceConfig.stringOf(obj, "text")?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        val title = DeviceConfig.stringOf(obj, "title")?.trim()?.takeIf { it.isNotEmpty() }
        val label = DeviceConfig.stringOf(obj, "actionLabel")?.trim()?.takeIf { it.isNotEmpty() }
        val action = DeviceConfig.stringOf(obj, "actionUrl")?.trim()?.takeIf { it.length <= MAX_URL }?.let { NoticeAction.of(it) }
        val hasAction = label != null && action != null
        return AppNotice(
            id = id,
            level = when (DeviceConfig.stringOf(obj, "level")) {
                "warning" -> NoticeLevel.WARNING
                "error" -> NoticeLevel.ERROR
                else -> NoticeLevel.INFO
            },
            text = cut(text, MAX_TEXT),
            title = title?.let { cut(it, MAX_TITLE) },
            actionLabel = if (hasAction) cut(label!!, MAX_LABEL) else null,
            action = if (hasAction) action else null,
            dismissible = DeviceConfig.boolOf(obj, "dismissible") ?: true,
            maxAgeHours = maxAgeHoursOf(obj),
            notify = DeviceConfig.boolOf(obj, "notify") ?: false,
        )
    }

    // A whole number only; below 1 means no limit. Compared before any conversion, so a huge exponent stays cheap.
    private fun maxAgeHoursOf(obj: JsonObject): Int? {
        val hours = DeviceConfig.numberOf(obj, "maxAgeHours") ?: return null
        return when {
            hours < BigDecimal.ONE -> null
            !isWhole(hours) -> null
            hours > BigDecimal.valueOf(MAX_AGE_HOURS.toLong()) -> MAX_AGE_HOURS
            else -> hours.intValueExact()
        }
    }

    // For a value of at least 1 the division is bounded by the input length; stripTrailingZeros is not
    private fun isWhole(value: BigDecimal): Boolean =
        value.scale() <= 0 || value.setScale(0, RoundingMode.DOWN).compareTo(value) == 0

    // Never ends on half of an emoji
    fun cut(text: String, max: Int): String {
        if (text.length <= max) return text
        val end = if (Character.isHighSurrogate(text[max - 1])) max - 1 else max
        return text.substring(0, end)
    }

    // A negative age, from a clock moved back, counts as 0
    fun isExpired(notice: AppNotice, savedAt: Long, now: Long): Boolean {
        val hours = notice.maxAgeHours ?: return false
        return (now - savedAt).coerceAtLeast(0L) > hours * HOUR_MS
    }

    // The stored list counts only for the build that saved it
    fun storedOf(json: String?, savedBuild: Int, installedBuild: Int): List<AppNotice> =
        if (savedBuild != installedBuild) emptyList() else fromJson(json)

    fun visibleOf(stored: List<AppNotice>, closedIds: Collection<String>, savedAt: Long, now: Long): List<AppNotice> =
        stored.filter { !(it.dismissible && it.id in closedIds) && !isExpired(it, savedAt, now) }.take(MAX_SHOWN)

    // The newest last, at most max
    fun idsAfter(ids: List<String>, id: String, max: Int): List<String> =
        (ids.filter { it != id } + id).takeLast(max)

    fun closedAfter(closedIds: List<String>, id: String): List<String> = idsAfter(closedIds, id, MAX_CLOSED)

    fun toJson(notice: AppNotice): JsonObject = JsonObject().apply {
        addProperty("id", notice.id)
        addProperty("level", notice.level.name.lowercase())
        addProperty("text", notice.text)
        notice.title?.let { addProperty("title", it) }
        notice.actionLabel?.let { addProperty("actionLabel", it) }
        notice.action?.let { addProperty("actionUrl", it.url) }
        addProperty("dismissible", notice.dismissible)
        notice.maxAgeHours?.let { addProperty("maxAgeHours", it) }
        addProperty("notify", notice.notify)
    }

    fun listToJson(notices: List<AppNotice>): String = JsonArray().apply { notices.forEach { add(toJson(it)) } }.toString()

    // Any stored value that is not a list, including the single object of earlier dev builds, reads as empty
    fun fromJson(json: String?): List<AppNotice> = try {
        if (json.isNullOrEmpty()) emptyList() else parseList(JsonParser.parseString(json))
    } catch (e: Exception) {
        emptyList()
    }

    // Written together, so the list never pairs with another save's time or build
    fun save(context: Context, notices: List<AppNotice>) {
        val edit = SharedPreferenceHelper.preferences(context).edit()
            .putLong(AppConstants.SHARED_PREFS_CONFIG_NOTICES_SAVED_AT_KEY, System.currentTimeMillis())
            .putInt(AppConstants.SHARED_PREFS_CONFIG_NOTICES_SAVED_BUILD_KEY, BuildConfig.VERSION_CODE)
        if (notices.isEmpty()) edit.remove(AppConstants.SHARED_PREFS_CONFIG_NOTICE_KEY)
        else edit.putString(AppConstants.SHARED_PREFS_CONFIG_NOTICE_KEY, listToJson(notices))
        edit.apply()
    }

    fun idsFromJson(json: String?): List<String> = try {
        if (json.isNullOrEmpty()) emptyList()
        else JsonParser.parseString(json).asJsonArray.mapNotNull { e ->
            e.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }?.asString
        }
    } catch (e: Exception) {
        emptyList()
    }

    fun idsToJson(ids: List<String>): String = JsonArray().apply { ids.forEach { add(it) } }.toString()

    fun closedIds(context: Context): List<String> =
        idsFromJson(SharedPreferenceHelper.getSharedPreferenceString(context, AppConstants.SHARED_PREFS_NOTICE_CLOSED_IDS_KEY, null))

    fun close(context: Context, id: String) =
        SharedPreferenceHelper.setSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_NOTICE_CLOSED_IDS_KEY, idsToJson(closedAfter(closedIds(context), id))
        )

    // The notices to show now, in the order received, read from one snapshot of the prefs
    fun visible(context: Context): List<AppNotice> {
        val prefs = SharedPreferenceHelper.preferences(context).all
        return visibleOf(
            storedOf(
                prefs[AppConstants.SHARED_PREFS_CONFIG_NOTICE_KEY] as? String,
                prefs[AppConstants.SHARED_PREFS_CONFIG_NOTICES_SAVED_BUILD_KEY] as? Int ?: 0,
                BuildConfig.VERSION_CODE,
            ),
            idsFromJson(prefs[AppConstants.SHARED_PREFS_NOTICE_CLOSED_IDS_KEY] as? String),
            prefs[AppConstants.SHARED_PREFS_CONFIG_NOTICES_SAVED_AT_KEY] as? Long ?: 0L,
            System.currentTimeMillis(),
        )
    }
}
