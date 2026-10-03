package com.vernu.sms.helpers

enum class HealthStatus { GREEN, AMBER, RED }

enum class HealthAction { NONE, GRANT_SMS, GRANT_NOTIFICATIONS, OPEN_BATTERY_SETTINGS, TOGGLE_STICKY, OPEN_APP_SETTINGS, SEND_HEARTBEAT }

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
    val sdkInt: Int = 0,
)

// The checks behind the Device health screen. Pure, so each row is testable.
object DeviceHealthRows {
    private const val MINUTE = 60_000L
    private const val HOUR = 60 * MINUTE

    fun build(i: HealthInputs): List<HealthRow> {
        val rows = ArrayList<HealthRow>()
        val s = i.snapshot

        val missing = listOfNotNull(
            "Send SMS".takeIf { !s.hasSendSmsPermission },
            "Receive SMS".takeIf { !s.hasReceiveSmsPermission },
            "Phone state".takeIf { !s.hasReadPhoneStatePermission },
        )
        rows += if (missing.isEmpty()) {
            HealthRow("sms", "SMS permissions", "Granted", HealthStatus.GREEN)
        } else {
            val restricted = if (!s.hasSendSmsPermission && i.sdkInt >= 35)
                " On Android 15 and newer, allow restricted settings first (App info > menu > Allow restricted settings)." else ""
            HealthRow("sms", "SMS permissions", "Missing: ${missing.joinToString(", ")}. The gateway cannot work without them.$restricted",
                HealthStatus.RED, HealthAction.GRANT_SMS, "Grant")
        }

        rows += if (s.hasPostNotificationsPermission) {
            HealthRow("notifications", "Notifications", "Allowed", HealthStatus.GREEN)
        } else {
            HealthRow("notifications", "Notifications",
                "Not allowed. textbee cannot show that it is running, and Android stops it sooner in the background.",
                HealthStatus.AMBER, HealthAction.GRANT_NOTIFICATIONS, "Allow")
        }

        rows += when (i.ignoringBatteryOptimizations) {
            true -> HealthRow("battery", "Battery usage", "Unrestricted", HealthStatus.GREEN)
            false -> HealthRow("battery", "Battery usage",
                "Android may pause textbee in the background and hold messages for minutes or hours. Set battery usage to Unrestricted.",
                HealthStatus.AMBER, HealthAction.OPEN_BATTERY_SETTINGS, "Open settings")
            null -> HealthRow("battery", "Battery usage", "Could not read", HealthStatus.AMBER, countsAsIssue = false)
        }

        rows += if (s.stickyNotificationEnabled && !s.hasReceiveSmsPermission) {
            HealthRow("sticky", "Sticky notification",
                "On, but it cannot start until the Receive SMS permission is granted.",
                HealthStatus.AMBER, countsAsIssue = false)
        } else if (s.stickyNotificationEnabled) {
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
        rows += heartbeatRow(i.lastHeartbeatMs, i.nowMs, i.gatewayEnabled)

        oemTips(i.manufacturer)?.let { (brand, tips) ->
            rows += HealthRow("oem", "Tips for $brand phones", tips, HealthStatus.GREEN,
                HealthAction.OPEN_APP_SETTINGS, "Open app settings", countsAsIssue = false)
        }
        return rows
    }

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

    fun heartbeatRow(lastHeartbeatMs: Long?, nowMs: Long, gatewayEnabled: Boolean): HealthRow {
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
        return when {
            age < 45 * MINUTE -> HealthRow("heartbeat", "Heartbeat", ago, HealthStatus.GREEN, send, "Send heartbeat")
            age < 3 * HOUR -> HealthRow("heartbeat", "Heartbeat", "$ago. Expected every 30 minutes.",
                HealthStatus.AMBER, send, "Send heartbeat")
            else -> HealthRow("heartbeat", "Heartbeat",
                "$ago. Android or the phone maker is probably stopping the app in the background.",
                HealthStatus.RED, send, "Send heartbeat")
        }
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
