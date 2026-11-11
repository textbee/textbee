package com.vernu.sms.database

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SendMarkerStoreTest {
    private class MemoryStorage : MarkerStorage {
        val map = LinkedHashMap<String, String>()
        var commitWorks = true
        override fun get(key: String): String? = map[key]
        override fun all(): Map<String, String> = map.toMap()
        override fun commit(put: Map<String, String>, remove: Collection<String>): Boolean {
            // Like SharedPreferences: memory changes even when the disk write fails
            remove.forEach { map.remove(it) }
            map.putAll(put)
            return commitWorks
        }
        override fun apply(key: String, value: String) { map[key] = value }
    }

    private var now = 1_000_000_000L
    private val storage = MemoryStorage()
    private val store = SendMarkerStore(storage) { now }

    @Test
    fun firstBeginStartsAndTheSecondIsADuplicate() {
        assertEquals(SendMarkerStore.Begin.STARTED, store.begin("a", "+15550100"))
        assertEquals(SendMarkerStore.Begin.DUPLICATE, store.begin("a", "+15550100"))
        assertEquals(SendMarkerStore.SENDING, store.find("a", "+15550100")?.state)
    }

    @Test
    fun anotherRecipientOfTheSameMessageIsNotBlocked() {
        store.begin("a", "+15550100")
        assertFalse(store.exists("a", "+15550101"))
        assertEquals(SendMarkerStore.Begin.STARTED, store.begin("a", "+15550101"))
    }

    @Test
    fun everyStateBlocksASecondSend() {
        store.begin("a", "+15550100")
        store.finish("a", "+15550100", SendMarkerStore.SENT)
        assertEquals(SendMarkerStore.Begin.DUPLICATE, store.begin("a", "+15550100"))
        store.finish("a", "+15550100", SendMarkerStore.FAILED, "1", "No service | try again")
        assertEquals(SendMarkerStore.Begin.DUPLICATE, store.begin("a", "+15550100"))
        val marker = store.find("a", "+15550100")!!
        assertEquals(SendMarkerStore.FAILED, marker.state)
        assertEquals("1", marker.errorCode)
        assertEquals("No service | try again", marker.errorMessage)
    }

    @Test
    fun aFailedDiskWriteDoesNotStartAndStaysBlocked() {
        storage.commitWorks = false
        assertEquals(SendMarkerStore.Begin.WRITE_FAILED, store.begin("a", "+15550100"))
        assertEquals(SendMarkerStore.FAILED, store.find("a", "+15550100")?.state)
        storage.commitWorks = true
        assertEquals(SendMarkerStore.Begin.DUPLICATE, store.begin("a", "+15550100"))
    }

    @Test
    fun finishWithoutAMarkerWritesNothing() {
        store.finish("a", "+15550100", SendMarkerStore.SENT)
        assertNull(store.find("a", "+15550100"))
        assertFalse(store.exists("a", "+15550100"))
    }

    @Test
    fun anUnreadableValueStillBlocks() {
        storage.map["a:+15550100"] = "garbage"
        assertTrue(store.exists("a", "+15550100"))
        assertEquals(SendMarkerStore.Begin.DUPLICATE, store.begin("a", "+15550100"))
    }

    @Test
    fun markersAreKeptEightDaysInEveryState() {
        store.begin("sending", "+15550100")
        store.begin("sent", "+15550100")
        store.finish("sent", "+15550100", SendMarkerStore.SENT)

        now += SendMarkerStore.TTL_MS - 1
        store.begin("later", "+15550100")
        assertTrue(store.exists("sending", "+15550100"))
        assertTrue(store.exists("sent", "+15550100"))

        now += SendMarkerStore.PRUNE_EVERY_MS
        store.begin("last", "+15550100")
        assertFalse(store.exists("sending", "+15550100"))
        assertFalse(store.exists("sent", "+15550100"))
        assertTrue(store.exists("later", "+15550100"))
    }

    @Test
    fun pruningDoesNotRunOnEverySend() {
        store.begin("old", "+15550100")
        now += SendMarkerStore.TTL_MS + 1
        store.begin("b", "+15550100")
        assertFalse(store.exists("old", "+15550100"))

        storage.map["stale:+15550100"] = "${SendMarkerStore.SENT}|1"
        now += 1_000
        store.begin("c", "+15550100")
        assertTrue(store.exists("stale", "+15550100"))
    }
}
