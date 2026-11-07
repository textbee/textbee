package com.vernu.sms.database

import com.vernu.sms.helpers.DeliveryVerdict
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MultipartDeliveryTrackerTest {
    private class MemoryStorage : DedupeStorage {
        val map = LinkedHashMap<String, String>()
        override fun all(): Map<String, String> = map.toMap()
        override fun put(key: String, value: String) { map[key] = value }
        override fun remove(key: String) { map.remove(key) }
    }

    private var now = 1_000_000L
    private val storage = MemoryStorage()
    private val tracker = MultipartDeliveryTracker(storage) { now }
    private val delivered = DeliveryVerdict.Delivered
    private val pending = DeliveryVerdict.Pending
    private val failed = DeliveryVerdict.Failed("CARRIER_0x41", "gave up")

    @Test
    fun aSinglePartReportDecidesAtOnce() {
        assertEquals(DeliveryOutcome.Delivered, tracker.record("a", 0, 1, delivered))
        assertEquals(DeliveryOutcome.Wait, tracker.record("a", 0, 1, pending))
        assertEquals(DeliveryOutcome.Failed("CARRIER_0x41", "gave up"), tracker.record("a", 0, 1, failed))
        assertTrue(storage.map.isEmpty())
    }

    @Test
    fun deliveredOnlyAfterEveryPart() {
        assertEquals(DeliveryOutcome.Wait, tracker.record("a", 0, 3, delivered))
        assertEquals(DeliveryOutcome.Wait, tracker.record("a", 2, 3, delivered))
        assertEquals(DeliveryOutcome.Delivered, tracker.record("a", 1, 3, delivered))
    }

    @Test
    fun theSamePartTwiceDoesNotCountAsAnother() {
        assertEquals(DeliveryOutcome.Wait, tracker.record("a", 0, 2, delivered))
        assertEquals(DeliveryOutcome.Wait, tracker.record("a", 0, 2, delivered))
        assertEquals(DeliveryOutcome.Delivered, tracker.record("a", 1, 2, delivered))
    }

    @Test
    fun anyFailedPartFailsTheMessageOnce() {
        assertEquals(DeliveryOutcome.Wait, tracker.record("a", 0, 3, delivered))
        assertEquals(DeliveryOutcome.Failed("CARRIER_0x41", "gave up"), tracker.record("a", 1, 3, failed))
        assertEquals(DeliveryOutcome.Wait, tracker.record("a", 2, 3, delivered))
        assertEquals(DeliveryOutcome.Wait, tracker.record("a", 2, 3, failed))
    }

    @Test
    fun aFailedFirstPartFailsAtOnce() {
        assertEquals(DeliveryOutcome.Failed("CARRIER_0x41", "gave up"), tracker.record("a", 0, 2, failed))
        assertEquals(DeliveryOutcome.Wait, tracker.record("a", 1, 2, delivered))
    }

    @Test
    fun pendingWaitsForTheFinalReport() {
        assertEquals(DeliveryOutcome.Wait, tracker.record("a", 0, 2, pending))
        assertEquals(DeliveryOutcome.Wait, tracker.record("a", 0, 2, delivered))
        assertEquals(DeliveryOutcome.Wait, tracker.record("a", 1, 2, pending))
        assertEquals(DeliveryOutcome.Delivered, tracker.record("a", 1, 2, delivered))
    }

    @Test
    fun nothingIsReportedAfterTheMessageIsDelivered() {
        tracker.record("a", 0, 2, delivered)
        tracker.record("a", 1, 2, delivered)
        assertEquals(DeliveryOutcome.Wait, tracker.record("a", 1, 2, failed))
    }

    @Test
    fun messagesAreTrackedApart() {
        assertEquals(DeliveryOutcome.Wait, tracker.record("a", 0, 2, delivered))
        assertEquals(DeliveryOutcome.Wait, tracker.record("b", 1, 2, delivered))
        assertEquals(DeliveryOutcome.Delivered, tracker.record("a", 1, 2, delivered))
        assertEquals(DeliveryOutcome.Delivered, tracker.record("b", 0, 2, delivered))
    }

    @Test
    fun stateSurvivesANewTracker() {
        tracker.record("a", 0, 2, delivered)
        val restarted = MultipartDeliveryTracker(storage) { now }
        assertEquals(DeliveryOutcome.Delivered, restarted.record("a", 1, 2, delivered))
    }

    @Test
    fun anIndexOutsideThePartsDecidesAlone() {
        assertEquals(DeliveryOutcome.Delivered, tracker.record("a", 5, 2, delivered))
        assertTrue(storage.map.isEmpty())
    }

    @Test
    fun entriesOlderThanSevenDaysArePruned() {
        tracker.record("old", 0, 2, delivered)
        now += MultipartDeliveryTracker.TTL_MS + 1
        tracker.record("new", 0, 2, delivered)
        assertEquals(setOf("new"), storage.map.keys)
    }

    @Test
    fun brokenEntriesArePruned() {
        storage.map["bad"] = "nonsense"
        tracker.record("a", 0, 2, delivered)
        assertEquals(setOf("a"), storage.map.keys)
    }
}
