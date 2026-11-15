package com.vernu.sms.services

// What the sticky notification service does with one start request
object StickyStart {
    /**
     * Android wants startForeground after each startForegroundService call, also when the
     * service already runs or is about to stop. Returns true when the service stays up.
     */
    fun handle(wanted: Boolean, enterForeground: () -> Boolean, leaveForeground: () -> Unit): Boolean {
        val inForeground = enterForeground()
        if (inForeground && wanted) return true
        if (inForeground) leaveForeground()
        return false
    }
}
