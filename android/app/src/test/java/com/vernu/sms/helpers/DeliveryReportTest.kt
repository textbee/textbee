package com.vernu.sms.helpers

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DeliveryReportTest {
    private fun failed(code: String, message: String) = DeliveryVerdict.Failed(code, message)

    @Test
    fun completedStatusesAreDelivered() {
        for (status in listOf(0x00, 0x01, 0x02, 0x10, 0x1F)) {
            assertEquals("0x%02X".format(status), DeliveryVerdict.Delivered, DeliveryReport.gsmVerdict(status))
        }
    }

    @Test
    fun carrierStillTryingIsPending() {
        for (status in listOf(0x20, 0x21, 0x25, 0x30, 0x3F)) {
            assertEquals("0x%02X".format(status), DeliveryVerdict.Pending, DeliveryReport.gsmVerdict(status))
        }
    }

    @Test
    fun permanentErrorsFailWithTheStatusCode() {
        assertEquals(
            failed("CARRIER_0x40", "The carrier could not deliver the message and stopped trying (TP-Status 0x40)."),
            DeliveryReport.gsmVerdict(0x40),
        )
        assertEquals(
            failed("CARRIER_0x4A", "The carrier could not deliver the message and stopped trying (TP-Status 0x4A)."),
            DeliveryReport.gsmVerdict(0x4A),
        )
        assertEquals("CARRIER_0x5F", (DeliveryReport.gsmVerdict(0x5F) as DeliveryVerdict.Failed).code)
    }

    @Test
    fun temporaryErrorsTheCarrierGaveUpOnFail() {
        assertEquals(
            failed("CARRIER_0x62", "The carrier stopped trying to deliver the message after a temporary error (TP-Status 0x62)."),
            DeliveryReport.gsmVerdict(0x62),
        )
        assertEquals("CARRIER_0x7F", (DeliveryReport.gsmVerdict(0x7F) as DeliveryVerdict.Failed).code)
    }

    @Test
    fun reservedHighValuesFailLikeTheFramework() {
        assertEquals("CARRIER_0x80", (DeliveryReport.gsmVerdict(0x80) as DeliveryVerdict.Failed).code)
        assertEquals("CARRIER_0xFF", (DeliveryReport.gsmVerdict(0xFF) as DeliveryVerdict.Failed).code)
    }

    @Test
    fun valuesOutsideOneByteAreNotRead() {
        assertNull(DeliveryReport.gsmVerdict(-1))
        assertNull(DeliveryReport.gsmVerdict(0x100))
        assertNull(DeliveryReport.gsmVerdict(2 shl 16))
    }

    @Test
    fun cdmaErrorClassDecides() {
        // class 0, cause 2: delivered (the value SmsMessage.getStatus documents)
        assertEquals(DeliveryVerdict.Delivered, DeliveryReport.cdmaVerdict(2 shl 16))
        assertEquals(DeliveryVerdict.Pending, DeliveryReport.cdmaVerdict((2 shl 24) or (0x21 shl 16)))
        assertEquals(
            failed("CARRIER_3GPP2_0x05", "The carrier could not deliver the message and stopped trying (3GPP2 status 0x05)."),
            DeliveryReport.cdmaVerdict((3 shl 24) or (0x05 shl 16)),
        )
        // class 1 is reserved; the framework counts it as failed
        assertEquals("CARRIER_3GPP2_0x00", (DeliveryReport.cdmaVerdict(1 shl 24) as DeliveryVerdict.Failed).code)
    }

    @Test
    fun formatPicksTheRule() {
        assertEquals(DeliveryVerdict.Pending, DeliveryReport.verdict("3gpp", 0x20))
        assertEquals(DeliveryVerdict.Delivered, DeliveryReport.verdict("3gpp2", 0x20))
        assertNull(DeliveryReport.verdict("unknown", 0x00))
    }

    @Test
    fun aMissingPduIsNotRead() {
        assertNull(DeliveryReport.read(null, "3gpp"))
        assertNull(DeliveryReport.read(ByteArray(0), "3gpp"))
        assertNull(DeliveryReport.read(byteArrayOf(0x00), null))
    }
}
