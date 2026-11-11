package com.vernu.sms.database

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SendMarkerStoreTest {
    private class MemoryBuckets : MarkerBuckets {
        val files = LinkedHashMap<String, MutableMap<String, String>>()
        var commitWorks = true
        var listingWorks = true
        var legacyDay = 0L

        private fun dayOf(name: String): Long =
            if (name == SendMarkerStore.LEGACY_BUCKET) legacyDay else name.substringAfterLast('_').toLong()

        override fun list(today: Long): BucketListing =
            if (listingWorks) BucketListing(files.keys.associateWith { dayOf(it) }, true)
            else BucketListing(mapOf(SendMarkerStore.bucketName(today) to today), false)

        override fun get(bucket: String, key: String): String? = files[bucket]?.get(key)

        override fun commit(bucket: String, key: String, value: String): Boolean {
            // Like SharedPreferences: memory changes even when the disk write fails
            files.getOrPut(bucket) { LinkedHashMap() }[key] = value
            return commitWorks
        }

        override fun apply(bucket: String, key: String, value: String) {
            files.getOrPut(bucket) { LinkedHashMap() }[key] = value
        }

        override fun delete(bucket: String) { files.remove(bucket) }
    }

    private val day = SendMarkerStore.DAY_MS
    private val startDay = 20_000L
    private var now = startDay * day + 1_000
    private val buckets = MemoryBuckets()
    private val store = SendMarkerStore(buckets) { now }
    private val phone = "+15550100"

    private fun bucket(offsetDays: Long) = SendMarkerStore.bucketName(startDay + offsetDays)

    @Test
    fun firstBeginStartsAndTheSecondIsADuplicate() {
        assertEquals(SendMarkerStore.Begin.STARTED, store.begin("a", phone))
        assertEquals(SendMarkerStore.Begin.DUPLICATE, store.begin("a", phone))
        assertEquals(SendMarkerStore.SENDING, store.find("a", phone)?.state)
    }

    @Test
    fun anotherRecipientOfTheSameMessageIsNotBlocked() {
        store.begin("a", phone)
        assertFalse(store.exists("a", "+15550101"))
        assertEquals(SendMarkerStore.Begin.STARTED, store.begin("a", "+15550101"))
    }

    @Test
    fun everyStateBlocksASecondSend() {
        store.begin("a", phone)
        store.finish("a", phone, SendMarkerStore.SENT)
        assertEquals("${SendMarkerStore.SENT}|$now", buckets.files[bucket(0)]!!["a:$phone"])
        assertEquals(SendMarkerStore.Begin.DUPLICATE, store.begin("a", phone))
        store.finish("a", phone, SendMarkerStore.FAILED, "1", "No service | try again")
        assertEquals(SendMarkerStore.Begin.DUPLICATE, store.begin("a", phone))
        val marker = store.find("a", phone)!!
        assertEquals(SendMarkerStore.FAILED, marker.state)
        assertEquals("1", marker.errorCode)
        assertEquals("No service | try again", marker.errorMessage)
    }

    @Test
    fun aFailedDiskWriteDoesNotStartAndStaysBlocked() {
        buckets.commitWorks = false
        assertEquals(SendMarkerStore.Begin.WRITE_FAILED, store.begin("a", phone))
        assertEquals(SendMarkerStore.FAILED, store.find("a", phone)?.state)
        buckets.commitWorks = true
        assertEquals(SendMarkerStore.Begin.DUPLICATE, store.begin("a", phone))
    }

    @Test
    fun aFailedPartKeepsTheMessageFailed() {
        store.begin("a", phone)
        store.finish("a", phone, SendMarkerStore.FAILED, "1", "Generic failure")
        store.finish("a", phone, SendMarkerStore.SENT)
        val marker = store.find("a", phone)
        assertEquals(SendMarkerStore.FAILED, marker?.state)
        assertEquals("1", marker?.errorCode)
    }

    @Test
    fun finishWithoutAMarkerWritesNothing() {
        store.finish("a", phone, SendMarkerStore.SENT)
        assertNull(store.find("a", phone))
        assertTrue(buckets.files.isEmpty())
    }

    @Test
    fun anUnreadableValueStillBlocks() {
        buckets.files[bucket(0)] = mutableMapOf("a:$phone" to "garbage")
        assertTrue(store.exists("a", phone))
        assertEquals(SendMarkerStore.Begin.DUPLICATE, store.begin("a", phone))
    }

    @Test
    fun aMarkerIsFoundInAnOlderBucket() {
        store.begin("a", phone)
        now += 3 * day
        store.begin("b", phone)
        assertEquals(setOf(bucket(0), bucket(3)), buckets.files.keys)
        assertTrue(store.exists("a", phone))
        assertEquals(SendMarkerStore.SENDING, store.find("a", phone)?.state)
        assertEquals(SendMarkerStore.Begin.DUPLICATE, store.begin("a", phone))
    }

    @Test
    fun finishLandsInTheBucketThatHoldsTheMarker() {
        store.begin("a", phone)
        now += 2 * day
        store.begin("b", phone)
        store.finish("a", phone, SendMarkerStore.SENT)
        assertEquals("${SendMarkerStore.SENT}|$now", buckets.files[bucket(0)]!!["a:$phone"])
        assertFalse(buckets.files[bucket(2)]!!.containsKey("a:$phone"))
    }

    @Test
    fun theOldSingleFileIsReadAsABucket() {
        buckets.legacyDay = startDay - 1
        buckets.files[SendMarkerStore.LEGACY_BUCKET] = mutableMapOf("a:$phone" to "${SendMarkerStore.SENT}|1")
        assertEquals(SendMarkerStore.Begin.DUPLICATE, store.begin("a", phone))
        store.finish("a", phone, SendMarkerStore.FAILED, "1")
        assertEquals(SendMarkerStore.FAILED, store.find("a", phone)?.state)
        assertTrue(buckets.files[SendMarkerStore.LEGACY_BUCKET]!!["a:$phone"]!!.startsWith(SendMarkerStore.FAILED))
    }

    @Test
    fun markersAreKeptEightDaysWithDailySends() {
        store.begin("first", phone)
        for (i in 1..8) {
            now += day
            store.begin("day$i", phone)
        }
        assertTrue(store.exists("first", phone))

        now += day
        store.begin("day9", phone)
        assertFalse(store.exists("first", phone))
        assertTrue(store.exists("day1", phone))
        assertEquals(SendMarkerStore.KEEP_BUCKETS, buckets.files.size)
    }

    @Test
    fun anOldBucketStaysWhileFewNewerOnesExist() {
        store.begin("first", phone)
        now += 20 * day
        store.begin("later", phone)
        assertTrue(store.exists("first", phone))
        assertEquals(SendMarkerStore.Begin.DUPLICATE, store.begin("first", phone))
    }

    @Test
    fun aForwardClockJumpKeepsTheNewestNineBuckets() {
        store.begin("day0", phone)
        for (i in 1..8) {
            now += day
            store.begin("day$i", phone)
        }
        now += 30 * day
        assertEquals(SendMarkerStore.Begin.STARTED, store.begin("jump", phone))
        for (i in 1..8) assertTrue("day$i", store.exists("day$i", phone))
        assertTrue(store.exists("jump", phone))
        assertEquals(SendMarkerStore.KEEP_BUCKETS, buckets.files.size)
    }

    @Test
    fun aBackwardClockJumpStillFindsTheMarker() {
        store.begin("a", phone)
        now -= 400 * day
        assertTrue(store.exists("a", phone))
        assertEquals(SendMarkerStore.Begin.DUPLICATE, store.begin("a", phone))
        assertEquals(SendMarkerStore.Begin.STARTED, store.begin("b", phone))
        assertTrue(store.exists("a", phone))
        assertTrue(store.exists("b", phone))
    }

    @Test
    fun nothingIsDeletedWhenTheFilesCannotBeListed() {
        for (i in 0..8) {
            store.begin("day$i", phone)
            now += day
        }
        buckets.listingWorks = false
        now += 30 * day
        store.begin("blind", phone)
        assertEquals(SendMarkerStore.KEEP_BUCKETS + 1, buckets.files.size)
    }
}
