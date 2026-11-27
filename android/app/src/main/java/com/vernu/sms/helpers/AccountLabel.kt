package com.vernu.sms.helpers

// The account name the Settings "Account" row shows. The server owns it and may change it.
object AccountLabel {
    // A very long single line cannot be laid out in the row
    const val MAX_LENGTH = 200

    /** The label to save from a who-am-i answer, or null to keep the saved one. Never clears it. */
    fun toSave(fromServer: String?, saved: String?): String? {
        val label = fromServer?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        return DeviceLink.cut(label, MAX_LENGTH).takeIf { it != saved }
    }
}
