package com.vernu.sms.helpers

import org.junit.Assert.assertEquals
import org.junit.Test

class CallbackPartTest {
    @Test
    fun extrasGiveThePart() {
        assertEquals(CallbackPart(1, 3), CallbackPart.lookup(1, 3, "textbee-sent://m1/1"))
        assertEquals(CallbackPart(0, 1), CallbackPart.lookup(0, 1, null))
    }

    @Test
    fun extrasWinOverTheUri() {
        assertEquals(CallbackPart(2, 3), CallbackPart.lookup(2, 3, "textbee-delivery://m1/0"))
    }

    @Test
    fun theUriHoldsIndexAndCount() {
        assertEquals("textbee-sent://m1/1/3", CallbackPart.uri(CallbackPart.SENT_URI_SCHEME, "m1", 1, 3))
        assertEquals("textbee-delivery://m1/0/1", CallbackPart.uri(CallbackPart.DELIVERY_URI_SCHEME, "m1", 0, 1))
    }

    @Test
    fun withoutExtrasTheUriGivesTheIndexAndCount() {
        assertEquals(CallbackPart(2, 3), CallbackPart.lookup(null, null, "textbee-sent://m1/2/3"))
        assertEquals(CallbackPart(0, 1), CallbackPart.lookup(null, null, "textbee-delivery://m1/0/1"))
    }

    // Delivery intents of 2.9.0 have the index only
    @Test
    fun anOldDeliveryUriGivesTheIndexOnly() {
        assertEquals(CallbackPart(2, null), CallbackPart.lookup(null, null, "textbee-delivery://m1/2"))
    }

    @Test
    fun withNeitherThePartStaysUnknown() {
        assertEquals(CallbackPart(null, null), CallbackPart.lookup(null, null, null))
    }

    @Test
    fun aCountWithoutAnIndexIsDropped() {
        assertEquals(CallbackPart(null, null), CallbackPart.lookup(null, 3, null))
    }

    @Test
    fun aForeignOrBrokenUriIsIgnored() {
        assertEquals(CallbackPart(null, null), CallbackPart.lookup(null, null, "content://m1/2"))
        assertEquals(CallbackPart(null, null), CallbackPart.lookup(null, null, "textbee-sent://m1/abc"))
        assertEquals(CallbackPart(null, null), CallbackPart.lookup(null, null, "textbee-sent://m1/-1/3"))
        assertEquals(CallbackPart(1, null), CallbackPart.lookup(null, null, "textbee-sent://m1/1/0"))
    }

    @Test
    fun invalidExtrasFallBack() {
        assertEquals(CallbackPart(1, 3), CallbackPart.lookup(-1, 0, "textbee-sent://m1/1/3"))
    }

    @Test
    fun sentDetailIsRaw() {
        assertEquals("part 2 of 3, result -1", CallbackPart.sentDetail(CallbackPart(1, 3), -1, null))
        assertEquals("part 1 of 1, result 1, error code 5", CallbackPart.sentDetail(CallbackPart(0, 1), 1, 5))
        assertEquals("part unknown, result -1", CallbackPart.sentDetail(CallbackPart(null, null), -1, null))
        assertEquals("part 3, result -1", CallbackPart.sentDetail(CallbackPart(2, null), -1, null))
    }

    @Test
    fun deliveryDetailIsRaw() {
        assertEquals("part 2 of 3, carrier status 0x00", CallbackPart.deliveryDetail(CallbackPart(1, 3), true, -1, "3gpp", 0))
        assertEquals("part 1 of 1, carrier status 0x41", CallbackPart.deliveryDetail(CallbackPart(0, 1), true, -1, "3gpp", 0x41))
        assertEquals("part 1 of 1, no carrier status", CallbackPart.deliveryDetail(CallbackPart(0, 1), true, -1, "3gpp", null))
        assertEquals(
            "part unknown, no carrier status, result 0",
            CallbackPart.deliveryDetail(CallbackPart(null, null), false, 0, null, null),
        )
    }

    @Test
    fun a3gpp2StatusIsSplitIntoClassAndCause() {
        assertEquals(
            "part 1 of 1, carrier status class 2 cause 0x00",
            CallbackPart.deliveryDetail(CallbackPart(0, 1), true, -1, "3gpp2", 0x02000000),
        )
        assertEquals(
            "part 2 of 2, carrier status class 3 cause 0x21",
            CallbackPart.deliveryDetail(CallbackPart(1, 2), true, -1, "3gpp2", (3 shl 24) or (0x21 shl 16)),
        )
    }

    @Test
    fun detailsPassTheLogRedactionUnchanged() {
        listOf(
            CallbackPart.sentDetail(CallbackPart(1, 3), -1, null),
            CallbackPart.sentDetail(CallbackPart(254, 255), 1, 65535),
            CallbackPart.deliveryDetail(CallbackPart(1, 3), true, -1, "3gpp", 0xFF),
            CallbackPart.deliveryDetail(CallbackPart(0, 1), true, -1, "3gpp2", 0x02000000),
            CallbackPart.deliveryDetail(CallbackPart(0, 1), true, -1, "3gpp2", (3 shl 24) or (0xFF shl 16)),
            CallbackPart.deliveryDetail(CallbackPart(null, null), false, 0, null, null),
        ).forEach { assertEquals(it, DeviceLog.redact(it)) }
    }
}
