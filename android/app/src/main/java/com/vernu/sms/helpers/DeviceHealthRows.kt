package com.vernu.sms.helpers

import android.Manifest
import java.text.DateFormat
import java.util.Date

enum class HealthStatus { GREEN, AMBER, RED }

enum class HealthAction {
    NONE, GRANT_SMS, GRANT_PHONE_STATE, GRANT_NOTIFICATIONS, OPEN_BATTERY_SETTINGS, TOGGLE_STICKY,
    OPEN_APP_SETTINGS, SEND_HEARTBEAT, ADD_API_KEY
}

enum class AppPermission { SEND_SMS, RECEIVE_SMS, PHONE_STATE, NOTIFICATIONS }

// Which home screen card shows a missing permission
enum class HomeCard { NONE, RED, AMBER }

// What a home card's button does: ask for these permissions, or open the app settings
sealed class CardAction {
    data class Ask(val permissions: List<String>) : CardAction()
    object OpenSettings : CardAction()
}

data class PermissionItem(
    val permission: AppPermission,
    val title: String,
    val granted: Boolean,
    val status: HealthStatus,
    val detail: String,
    val homeCard: HomeCard,
)

data class HealthRow(
    val id: String,
    val title: String,
    val detail: String,
    val status: HealthStatus,
    val action: HealthAction = HealthAction.NONE,
    val actionLabel: String? = null,
    val countsAsIssue: Boolean = true,
)

data class HealthInputs(
    val snapshot: DeviceHealthSnapshot,
    val ignoringBatteryOptimizations: Boolean?,
    val powerSaveMode: Boolean,
    val deviceIdleMode: Boolean,
    val sendDelaySeconds: Int,
    val lastHeartbeatMs: Long?,
    val nowMs: Long,
    val manufacturer: String,
    val gatewayEnabled: Boolean,
    val periodMinutes: Int,
    val sdkInt: Int = 0,
    val receiveSmsEnabled: Boolean = false,
    // 0 while the key works
    val apiKeyRejectedAtMs: Long = 0L,
    val timeText: (Long) -> String = DeviceHealthRows::timeText,
)

// The checks behind the Device health screen. Pure, so each row is testable.
object DeviceHealthRows {
    private const val MINUTE = 60_000L
    private const val HOUR = 60 * MINUTE

    fun build(i: HealthInputs): List<HealthRow> {
        val rows = ArrayList<HealthRow>()
        val s = i.snapshot

        rows += apiKeyRow(i.apiKeyRejectedAtMs, i.timeText)
        rows += permissionItems(s, i.receiveSmsEnabled).map { permissionRow(it, i.sdkInt) }

        rows += when (i.ignoringBatteryOptimizations) {
            true -> HealthRow("battery", "Battery usage", "Unrestricted", HealthStatus.GREEN)
            false -> HealthRow("battery", "Battery usage",
                "Android may pause textbee in the background and hold messages for minutes or hours. Set battery usage to Unrestricted.",
                HealthStatus.AMBER, HealthAction.OPEN_BATTERY_SETTINGS, "Open settings")
            null -> HealthRow("battery", "Battery usage", "Could not read", HealthStatus.AMBER, countsAsIssue = false)
        }

        rows += if (s.stickyNotificationEnabled) {
            HealthRow("sticky", "Sticky notification", "On. A permanent notification tells Android to keep textbee running.", HealthStatus.GREEN)
        } else {
            HealthRow("sticky", "Sticky notification",
                "Off. Turning it on keeps a permanent notification, which is what tells Android not to shut the app down.",
                HealthStatus.AMBER, HealthAction.TOGGLE_STICKY, "Turn on")
        }

        val powerNow = listOfNotNull(
            "power saving".takeIf { i.powerSaveMode },
            "idle".takeIf { i.deviceIdleMode },
        )
        rows += if (powerNow.isEmpty()) {
            HealthRow("power", "Power saving right now", "Off", HealthStatus.GREEN, countsAsIssue = false)
        } else {
            HealthRow("power", "Power saving right now",
                "The phone is in ${powerNow.joinToString(" and ")} mode. Current state, not a setting. Messages may wait until the phone wakes.",
                HealthStatus.AMBER, countsAsIssue = false)
        }

        rows += sendDelayRow(i.sendDelaySeconds)
        rows += heartbeatRow(i.lastHeartbeatMs, i.nowMs, i.gatewayEnabled, i.periodMinutes)

        oemTips(i.manufacturer)?.let { (brand, tips) ->
            rows += HealthRow("oem", "Tips for $brand phones", tips, HealthStatus.GREEN,
                HealthAction.OPEN_APP_SETTINGS, "Open app settings", countsAsIssue = false)
        }
        return rows
    }

    // The one place that decides how each permission shows on the home screen, Device health and the Settings badge
    fun permissionItems(s: DeviceHealthSnapshot, receiveSmsEnabled: Boolean): List<PermissionItem> {
        fun item(permission: AppPermission, title: String, granted: Boolean, status: HealthStatus, detail: String, homeCard: HomeCard) =
            if (granted) PermissionItem(permission, title, true, HealthStatus.GREEN, "Allowed", HomeCard.NONE)
            else PermissionItem(permission, title, false, status, detail, homeCard)
        return listOf(
            item(AppPermission.SEND_SMS, "Send SMS", s.hasSendSmsPermission, HealthStatus.RED,
                "Not allowed. textbee cannot send SMS.", HomeCard.RED),
            if (receiveSmsEnabled) {
                item(AppPermission.RECEIVE_SMS, "Receive SMS", s.hasReceiveSmsPermission, HealthStatus.RED,
                    "Not allowed. textbee cannot receive SMS.", HomeCard.RED)
            } else {
                item(AppPermission.RECEIVE_SMS, "Receive SMS", s.hasReceiveSmsPermission, HealthStatus.AMBER,
                    "Not allowed. Needed only when receive SMS is on.", HomeCard.NONE)
            },
            item(AppPermission.PHONE_STATE, "Phone state", s.hasReadPhoneStatePermission, HealthStatus.AMBER,
                "Not allowed. Needed to choose a SIM and to report which SIM was used.", HomeCard.AMBER),
            item(AppPermission.NOTIFICATIONS, "Notifications", s.hasPostNotificationsPermission, HealthStatus.AMBER,
                "Not allowed. textbee cannot show that it is running, and Android stops it sooner in the background.", HomeCard.NONE),
        )
    }

    fun androidPermission(permission: AppPermission): String = when (permission) {
        AppPermission.SEND_SMS -> Manifest.permission.SEND_SMS
        AppPermission.RECEIVE_SMS -> Manifest.permission.RECEIVE_SMS
        AppPermission.PHONE_STATE -> Manifest.permission.READ_PHONE_STATE
        AppPermission.NOTIFICATIONS -> "android.permission.POST_NOTIFICATIONS"
    }

    // The Android permissions of a home screen card: only the items shown on it
    fun homeRequest(card: HomeCard, items: List<PermissionItem>): List<String> =
        if (card == HomeCard.NONE) emptyList()
        else items.filter { it.homeCard == card }.map { androidPermission(it.permission) }

    // Asks for every permission Android can still ask for; the app settings only when none is left. Null when the card has none.
    fun cardAction(permissions: List<String>, blocked: Set<String>): CardAction? {
        if (permissions.isEmpty()) return null
        val askable = permissions.filter { it !in blocked }
        return if (askable.isEmpty()) CardAction.OpenSettings else CardAction.Ask(askable)
    }

    // Only red permission rows count toward the Settings badge
    fun permissionRow(item: PermissionItem, sdkInt: Int = 0): HealthRow {
        val id = "permission_${item.permission.name.lowercase()}"
        if (item.granted) return HealthRow(id, item.title, item.detail, HealthStatus.GREEN)
        val action = when (item.permission) {
            AppPermission.SEND_SMS, AppPermission.RECEIVE_SMS -> HealthAction.GRANT_SMS
            AppPermission.PHONE_STATE -> HealthAction.GRANT_PHONE_STATE
            AppPermission.NOTIFICATIONS -> HealthAction.GRANT_NOTIFICATIONS
        }
        val restricted = if (item.permission == AppPermission.SEND_SMS && sdkInt >= 35)
            " On Android 15 and newer, allow restricted settings first (App info > menu > Allow restricted settings)." else ""
        return HealthRow(id, item.title, item.detail + restricted, item.status, action, "Allow",
            countsAsIssue = item.status == HealthStatus.RED)
    }

    fun apiKeyRow(rejectedAtMs: Long, timeText: (Long) -> String = ::timeText): HealthRow =
        if (rejectedAtMs <= 0L) {
            HealthRow("api_key", "API key", "Working", HealthStatus.GREEN)
        } else {
            HealthRow("api_key", "API key",
                "Rejected since ${timeText(rejectedAtMs)}. Create a new API key in the dashboard and add it here.",
                HealthStatus.RED, HealthAction.ADD_API_KEY, "Add API key")
        }

    fun timeText(ms: Long): String =
        DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(ms))

    // The period the job really runs on, when one was applied
    fun healthPeriodMinutes(appliedMinutes: Int?, configuredMinutes: Int): Int =
        appliedMinutes?.takeIf { it > 0 } ?: configuredMinutes

    fun issueCount(rows: List<HealthRow>) = rows.count { it.countsAsIssue && it.status != HealthStatus.GREEN }

    fun sendDelayRow(delaySeconds: Int): HealthRow {
        if (delaySeconds <= 0) {
            return HealthRow("delay", "Send delay", "No gap between messages. Carriers may block a phone that sends too fast.",
                HealthStatus.AMBER, countsAsIssue = false)
        }
        val perMinute = 60 / delaySeconds
        val fiveHundred = 500L * delaySeconds
        val rate = if (perMinute >= 1) "about $perMinute messages a minute" else "less than one message a minute"
        return HealthRow("delay", "Send delay",
            "At $delaySeconds seconds, $rate. 500 recipients takes ${formatDuration(fiveHundred * 1000)}.",
            HealthStatus.GREEN, countsAsIssue = false)
    }

    fun heartbeatRow(
        lastHeartbeatMs: Long?, nowMs: Long, gatewayEnabled: Boolean, periodMinutes: Int,
    ): HealthRow {
        val send = HealthAction.SEND_HEARTBEAT
        if (!gatewayEnabled) {
            return HealthRow("heartbeat", "Heartbeat", "Gateway is off", HealthStatus.AMBER, countsAsIssue = false)
        }
        if (lastHeartbeatMs == null || lastHeartbeatMs <= 0) {
            return HealthRow("heartbeat", "Heartbeat", "Never. Send one to check the connection.",
                HealthStatus.RED, send, "Send heartbeat")
        }
        val age = nowMs - lastHeartbeatMs
        if (age < 0) {
            return HealthRow("heartbeat", "Heartbeat",
                "The last one is dated in the future, so the phone clock changed. The next one clears this.",
                HealthStatus.AMBER, send, "Send heartbeat", countsAsIssue = false)
        }
        val ago = "${formatDuration(age)} ago"
        val period = periodMinutes * MINUTE
        val late = period + 15 * MINUTE
        return when {
            age < late -> HealthRow("heartbeat", "Heartbeat", ago, HealthStatus.GREEN, send, "Send heartbeat")
            // A long period moves the red limit out with it
            age < maxOf(3 * HOUR, 2 * late) -> HealthRow("heartbeat", "Heartbeat", "$ago. Expected every ${everyText(periodMinutes)}.",
                HealthStatus.AMBER, send, "Send heartbeat")
            else -> HealthRow("heartbeat", "Heartbeat",
                "$ago. Android or the phone maker is probably stopping the app in the background.",
                HealthStatus.RED, send, "Send heartbeat")
        }
    }

    // "hour", "2 hours", "90 minutes"
    fun everyText(minutes: Int): String = when {
        minutes == 60 -> "hour"
        minutes > 0 && minutes % 60 == 0 -> "${minutes / 60} hours"
        else -> "$minutes minutes"
    }

    fun formatDuration(ms: Long): String {
        val minutes = ms / MINUTE
        return when {
            ms < MINUTE -> "under a minute"
            minutes < 60 -> "$minutes minute${if (minutes == 1L) "" else "s"}"
            else -> {
                val hours = minutes / 60
                val rest = minutes % 60
                val h = "$hours hour${if (hours == 1L) "" else "s"}"
                if (rest == 0L) h else "$h $rest min"
            }
        }
    }

    // Steps from the support playbook, one entry per app killer we get tickets about
    fun oemTips(manufacturer: String): Pair<String, String>? {
        val m = manufacturer.lowercase()
        return when {
            "xiaomi" in m || "redmi" in m || "poco" in m -> "Xiaomi" to
                "Settings > Apps > Manage apps > textbee: turn on Autostart, and under Battery saver choose No restrictions. Then in Security > Boost speed > Lock apps, lock textbee."
            "huawei" in m || "honor" in m -> "Huawei" to
                "Settings > Battery > App launch > textbee: turn off automatic management and allow Auto-launch, Secondary launch and Run in background."
            "samsung" in m -> "Samsung" to
                "Settings > Battery and device care > Battery > Background usage limits: add textbee to Never sleeping apps, and make sure Put unused apps to sleep does not include it."
            "oppo" in m || "realme" in m -> "OPPO" to
                "Settings > Battery > App battery management > textbee: allow background activity. Also enable Auto-launch under App management."
            "vivo" in m || "iqoo" in m -> "vivo" to
                "Settings > Battery > Background power consumption management: allow textbee. Then in iManager > App manager > Autostart, enable textbee."
            "oneplus" in m -> "OnePlus" to
                "Settings > Battery > Battery optimization > textbee: Don't optimize. Also turn off Advanced optimization and Sleep standby optimization."
            "tecno" in m || "infinix" in m || "itel" in m -> "Tecno and Infinix" to
                "Settings > Battery > App power management: allow textbee. In Phone Master > Auto-start management, enable textbee."
            else -> null
        }
    }
}
