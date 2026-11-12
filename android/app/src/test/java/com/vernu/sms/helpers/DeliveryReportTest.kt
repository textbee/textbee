package com.vernu.sms.helpers

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DeliveryReportTest {
    @Test
    fun hexIsLowercaseAndKeepsEveryByte() {
        assertEquals("00017f80ff", DeliveryReport.hex(byteArrayOf(0x00, 0x01, 0x7F, 0x80.toByte(), 0xFF.toByte())))
    }

    @Test
    fun hexOfExactly600CharactersIsKept() {
        val hex = DeliveryReport.hex(ByteArray(300) { 0xAB.toByte() })
        assertEquals(600, hex!!.length)
        assertEquals("ab".repeat(300), hex)
    }

    @Test
    fun hexLongerThan600CharactersIsLeftOut() {
        assertNull(DeliveryReport.hex(ByteArray(301)))
    }

    @Test
    fun hexOfNothingIsLeftOut() {
        assertNull(DeliveryReport.hex(null))
        assertNull(DeliveryReport.hex(ByteArray(0)))
    }

    @Test
    fun aMissingPduIsNotRead() {
        assertNull(DeliveryReport.readStatus(null, "3gpp"))
        assertNull(DeliveryReport.readStatus(ByteArray(0), "3gpp"))
        assertNull(DeliveryReport.readStatus(byteArrayOf(0x00), null))
    }

    @Test
    fun aCallbackWithoutAPduHasNoReport() {
        assertNull(DeliveryReport.from(null, "3gpp"))
        assertNull(DeliveryReport.from(ByteArray(0), "3gpp"))
    }

    @Test
    fun aPduWithoutAFormatIsSentRawWithNoStatus() {
        val report = DeliveryReport.from(byteArrayOf(0x07, 0x00), null)!!
        assertNull(report.format)
        assertNull(report.status)
        assertEquals("0700", report.pdu)
    }

    @Test
    fun aLongPduKeepsTheReportWithoutTheHex() {
        val report = DeliveryReport.from(ByteArray(400), null)!!
        assertNull(report.pdu)
    }
}
