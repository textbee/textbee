package com.vernu.sms.helpers

import android.content.Context
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class LogEntry(val timeMs: Long, val event: String, val detail: String, val smsId: String?)

// A short record of what the app did, kept on the phone for the Activity
// screen and the diagnostics export. Never holds message text or the API
// key, and long digit runs are masked before they are written.
object DeviceLog {
    private const val TAG = "DeviceLog"
    const val MAX_AGE_MS = 14L * 24 * 60 * 60 * 1000
    private const val FILE_NAME = "device-log.txt"
    private const val EXPORT_FILE_NAME = "diagnostics/textbee-diagnostics.txt"
    private const val REWRITE_EVERY = 2_000

    private val lock = Any()
    private val _entries = MutableStateFlow<List<LogEntry>>(emptyList())
    val entries: StateFlow<List<LogEntry>> = _entries.asStateFlow()
    private var loaded = false
    private var appendsSinceRewrite = 0
    // Set from the server config once per process, on first load
    @Volatile
    private var maxEntries = DeviceConfig.DEVICE_LOG_MAX_ENTRIES.default

    // Anything that looks like a phone number, formatted or not
    private val phoneLike = Regex("\\+?\\d[\\d\\s().-]{5,}\\d")

    fun redact(text: String): String =
        phoneLike.replace(text) { m ->
            val digits = m.value.filter { it.isDigit() }
            if (digits.length >= 7) "…" + digits.takeLast(4) else m.value
        }

    fun trim(
        list: List<LogEntry>, nowMs: Long = System.currentTimeMillis(), maxEntries: Int = this.maxEntries,
    ): List<LogEntry> {
        val cutoff = nowMs - MAX_AGE_MS
        val firstFresh = list.indexOfFirst { it.timeMs >= cutoff }.takeIf { it >= 0 } ?: list.size
        val start = maxOf(firstFresh, list.size - maxEntries)
        return if (start <= 0) list else list.subList(start, list.size).toList()
    }

    fun formatLine(e: LogEntry): String =
        listOf(e.timeMs.toString(), e.event, e.smsId ?: "", e.detail.replace('\t', ' ').replace('\n', ' '))
            .joinToString("\t")

    fun parseLine(line: String): LogEntry? {
        val parts = line.split('\t', limit = 4)
        if (parts.size < 2) return null
        val time = parts[0].toLongOrNull() ?: return null
        return LogEntry(time, parts[1], parts.getOrElse(3) { "" }, parts.getOrNull(2)?.takeIf { it.isNotEmpty() })
    }

    fun log(context: Context, event: String, detail: String = "", smsId: String? = null) {
        val entry = LogEntry(System.currentTimeMillis(), event, redact(detail), smsId)
        Diagnostics.breadcrumb(event, smsId)
        try {
            synchronized(lock) {
                ensureLoaded(context)
                val next = trim(_entries.value + entry)
                _entries.value = next
                val file = file(context)
                if (++appendsSinceRewrite >= REWRITE_EVERY) {
                    file.writeText(next.joinToString("\n", postfix = "\n") { formatLine(it) })
                    appendsSinceRewrite = 0
                } else {
                    file.appendText(formatLine(entry) + "\n")
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not write log entry: ${e.message}")
        }
    }

    fun load(context: Context): List<LogEntry> = synchronized(lock) {
        ensureLoaded(context)
        _entries.value
    }

    // Written to a file because the full log is too large for an Intent extra
    fun export(context: Context, header: String): File {
        val fmt = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)
        val out = File(context.cacheDir, EXPORT_FILE_NAME).apply { parentFile?.mkdirs() }
        out.bufferedWriter().use { w ->
            w.write(header + "\n\n")
            load(context).forEach { e ->
                w.write("${fmt.format(Date(e.timeMs))}  ${e.event}${e.smsId?.let { "  [$it]" } ?: ""}  ${e.detail}\n")
            }
        }
        return out
    }

    private fun file(context: Context) = File(context.filesDir, FILE_NAME)

    private fun ensureLoaded(context: Context) {
        if (loaded) return
        loaded = true
        try {
            maxEntries = DeviceConfig.deviceLogMaxEntries(context)
            val f = file(context)
            if (f.exists()) {
                _entries.value = trim(f.readLines().mapNotNull { parseLine(it) })
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not read log: ${e.message}")
        }
    }
}
