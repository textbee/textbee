package com.vernu.sms.dtos

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.vernu.sms.workers.SMSStatusUpdateWorker
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class SMSDTOJsonTest {
    private fun json(dto: SMSDTO): JsonObject = Gson().toJsonTree(dto).asJsonObject

    @Test
    fun aReportBeforeTheRadioHasNoPartFields() {
        val body = json(SMSDTO().apply {
            smsId = "m1"
            status = "FAILED"
            errorCode = "PERMISSION_DENIED"
        })
        listOf("partIndex", "partCount", "resultCode", "radioErrorCode", "deliveryReport").forEach {
            assertFalse(it, body.has(it))
        }
        assertEquals("FAILED", body.get("status").asString)
    }

    @Test
    fun aSentCallbackCarriesThePartAndResult() {
        val body = json(SMSDTO().apply {
            smsId = "m1"
            status = "FAILED"
            partIndex = 1
            partCount = 3
            resultCode = 1
            radioErrorCode = 5
        })
        assertEquals(1, body.get("partIndex").asInt)
        assertEquals(3, body.get("partCount").asInt)
        assertEquals(1, body.get("resultCode").asInt)
        assertEquals(5, body.get("radioErrorCode").asInt)
        assertFalse(body.has("deliveryReport"))
    }

    @Test
    fun aDeliveryCallbackNestsTheReportAndOmitsUnknownValues() {
        val body = json(SMSDTO().apply {
            smsId = "m1"
            status = "DELIVERED"
            partIndex = 0
            partCount = 1
            resultCode = -1
            deliveryReport = DeliveryReportDTO().apply { format = "3gpp"; status = 0; pdu = "0700" }
        })
        assertFalse(body.has("radioErrorCode"))
        val report = body.getAsJsonObject("deliveryReport")
        assertEquals("3gpp", report.get("format").asString)
        assertEquals(0, report.get("status").asInt)
        assertEquals("0700", report.get("pdu").asString)

        val unread = json(SMSDTO().apply {
            deliveryReport = DeliveryReportDTO().apply { format = "3gpp" }
        }).getAsJsonObject("deliveryReport")
        assertFalse(unread.has("status"))
        assertFalse(unread.has("pdu"))
    }

    // Worker input queued by 2.9.0 before the update
    @Test
    fun aJobWrittenBy290StillParsesAndUploadsWithTheLegacyName() {
        val stored = """{"message":"","receivedAtInMillis":0,"smsId":"m1","smsBatchId":"b1",""" +
            """"status":"DELIVERED","sentAtInMillis":0,"deliveredAtInMillis":1700000000000,""" +
            """"failedAtInMillis":0,"pushReceivedAtInMillis":0,"sendAttemptedAtInMillis":0,"reportAttempt":1}"""
        val dto = Gson().fromJson(stored, SMSDTO::class.java)

        assertEquals("DELIVERED", dto.status)
        assertEquals(1700000000000L, dto.deliveredAtInMillis)
        assertEquals("sms_status_m1_DELIVERED", SMSStatusUpdateWorker.workName(dto, false))
        val body = json(dto)
        listOf("partIndex", "partCount", "resultCode", "radioErrorCode", "deliveryReport").forEach {
            assertFalse(it, body.has(it))
        }
    }
}
