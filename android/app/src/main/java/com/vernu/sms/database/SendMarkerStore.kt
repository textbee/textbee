package com.vernu.sms.database

import android.content.Context
import java.io.File

// The marker files, one per day. complete is false when the files could not
// be listed and the names are a guess.
class BucketListing(val days: Map<String, Long>, val complete: Boolean)

interface MarkerBuckets {
    // Every bucket that exists, with the day it belongs to
    fun list(today: Long): BucketListing
    fun get(bucket: String, key: String): String?
    // Synchronous. False when the write did not reach the disk.
    fun commit(bucket: String, key: String, value: String): Boolean
    fun apply(bucket: String, key: String, value: String)
    fun delete(bucket: String)
}

// One marker per radio call, written to disk before the call and kept in
// every state. A message with a marker is never handed to the radio again,
// even when the app stopped before the result arrived. Each day has its own
// file, so a send rewrites only that day's markers.
class SendMarkerStore(
    private val buckets: MarkerBuckets,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    enum class Begin { STARTED, DUPLICATE, WRITE_FAILED }

    data class Marker(
        val state: String,
        val atMs: Long,
        val errorCode: String? = null,
        val errorMessage: String? = null,
    )

    companion object {
        const val SENDING = "sending"
        const val SENT = "sent"
        const val FAILED = "failed"
        const val DAY_MS = 24 * 60 * 60 * 1000L
        // Markers live at least this many days
        const val KEEP_DAYS = 8L
        // The newest buckets are never deleted, whatever the clock says
        const val KEEP_BUCKETS = 9
        // The single file of earlier development builds, read as one more bucket
        const val LEGACY_BUCKET = "sms_send_markers"
        private const val BUCKET_PREFIX = "sms_send_markers_"

        // Shared by every instance, so check and write are one step
        private val lock = Any()

        @Volatile
        private var prefsBuckets: MarkerBuckets? = null

        @JvmStatic
        fun get(context: Context): SendMarkerStore {
            val storage = prefsBuckets ?: synchronized(lock) {
                prefsBuckets ?: PrefsBuckets(context.applicationContext).also { prefsBuckets = it }
            }
            return SendMarkerStore(storage)
        }

        fun bucketName(day: Long) = "$BUCKET_PREFIX$day"

        // value is "<state>|<time>|<error code>|<error message>"
        fun parse(value: String?): Marker? {
            val parts = value?.split('|', limit = 4) ?: return null
            val state = parts[0]
            if (state != SENDING && state != SENT && state != FAILED) return null
            return Marker(
                state,
                parts.getOrNull(1)?.toLongOrNull() ?: 0L,
                parts.getOrNull(2)?.takeIf { it.isNotEmpty() },
                parts.getOrNull(3)?.takeIf { it.isNotEmpty() },
            )
        }
    }

    private fun key(smsId: String, phone: String) = "$smsId:$phone"

    private fun today() = Math.floorDiv(clock(), DAY_MS)

    // Newest first. Today's bucket is always looked at, listed or not.
    private fun lookupOrder(today: Long): List<String> {
        val days = buckets.list(today).days
        val names = days.keys.sortedByDescending { days[it] }
        val todayName = bucketName(today)
        return if (todayName in days) names else listOf(todayName) + names
    }

    // The bucket that holds the key and the stored value
    private fun locate(k: String): Pair<String, String>? {
        for (name in lookupOrder(today())) {
            val value = buckets.get(name, k)
            if (value != null) return name to value
        }
        return null
    }

    // Any stored value counts, even one that cannot be read
    fun exists(smsId: String, phone: String): Boolean = locate(key(smsId, phone)) != null

    fun find(smsId: String, phone: String): Marker? = parse(locate(key(smsId, phone))?.second)

    // Call right before the radio. Only STARTED may go on to send.
    fun begin(smsId: String, phone: String): Begin = synchronized(lock) {
        val k = key(smsId, phone)
        if (locate(k) != null) return@synchronized Begin.DUPLICATE
        val now = clock()
        val today = Math.floorDiv(now, DAY_MS)
        val name = bucketName(today)
        val isNewBucket = name !in buckets.list(today).days
        if (!buckets.commit(name, k, "$SENDING|$now")) {
            // The caller reports a failure, so the marker says the same
            buckets.apply(name, k, "$FAILED|$now|MARKER_WRITE_FAILED")
            return@synchronized Begin.WRITE_FAILED
        }
        if (isNewBucket) prune(today)
        Begin.STARTED
    }

    // Records the radio result in the bucket that holds the marker. Does
    // nothing for a send that has no marker.
    fun finish(smsId: String, phone: String, state: String, errorCode: String? = null, errorMessage: String? = null) {
        synchronized(lock) {
            val k = key(smsId, phone)
            val bucket = locate(k)?.first ?: return
            val code = errorCode.orEmpty().replace('|', ' ')
            val value = "$state|${clock()}|$code|${errorMessage.orEmpty()}".trimEnd('|')
            buckets.apply(bucket, k, value)
        }
    }

    // Runs when a day's first marker is written. A bucket goes only when it
    // is both old by date and behind the newest ones, so a clock that jumps
    // cannot wipe the markers.
    private fun prune(today: Long) {
        val listing = buckets.list(today)
        if (!listing.complete) return
        listing.days.entries
            .sortedByDescending { it.value }
            .drop(KEEP_BUCKETS)
            .filter { it.value < today - KEEP_DAYS }
            .forEach { buckets.delete(it.key) }
    }

    private class PrefsBuckets(private val context: Context) : MarkerBuckets {
        // Dropped when a bucket is created or deleted
        @Volatile
        private var cached: Map<String, Long>? = null

        override fun list(today: Long): BucketListing {
            cached?.let { return BucketListing(it, true) }
            val listed = listFiles()
            if (listed != null) {
                cached = listed
                return BucketListing(listed, true)
            }
            // The files could not be listed: look where markers can still be
            val probe = LinkedHashMap<String, Long>()
            for (day in today downTo today - KEEP_DAYS - 1) probe[bucketName(day)] = day
            probe[LEGACY_BUCKET] = today - KEEP_DAYS - 1
            return BucketListing(probe, false)
        }

        private fun listFiles(): Map<String, Long>? = try {
            val dir = File(context.dataDir, "shared_prefs")
            val files = dir.listFiles()
            when {
                files != null -> files.mapNotNull { file ->
                    if (!file.name.endsWith(".xml")) return@mapNotNull null
                    val name = file.name.removeSuffix(".xml")
                    val day = when {
                        name == LEGACY_BUCKET -> Math.floorDiv(file.lastModified(), DAY_MS)
                        name.startsWith(BUCKET_PREFIX) -> name.removePrefix(BUCKET_PREFIX).toLongOrNull()
                        else -> null
                    }
                    day?.let { name to it }
                }.toMap()
                // No prefs were written yet
                !dir.exists() -> emptyMap()
                else -> null
            }
        } catch (e: Exception) {
            null
        }

        private fun prefs(bucket: String) = context.getSharedPreferences(bucket, 0)

        override fun get(bucket: String, key: String): String? = try {
            prefs(bucket).getString(key, null)
        } catch (e: ClassCastException) {
            "?"
        }

        override fun commit(bucket: String, key: String, value: String): Boolean {
            val ok = prefs(bucket).edit().putString(key, value).commit()
            if (cached?.containsKey(bucket) != true) cached = null
            return ok
        }

        override fun apply(bucket: String, key: String, value: String) =
            prefs(bucket).edit().putString(key, value).apply()

        override fun delete(bucket: String) {
            context.deleteSharedPreferences(bucket)
            cached = null
        }
    }
}
