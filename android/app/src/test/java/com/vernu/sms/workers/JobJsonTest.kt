package com.vernu.sms.workers

import com.google.gson.Gson
import com.vernu.sms.dtos.SMSDTO
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class JobJsonTest {
    private val text = "a<b>c&d=e'f"

    @Test
    fun htmlCharactersStayOneByte() {
        val json = JobJson.toJson(SMSDTO().apply { message = text })
        assertTrue(json, json.contains(text))
        // The escaped form takes six bytes per character
        assertTrue(Gson().toJson(SMSDTO().apply { message = text }).length > json.length)
    }

    @Test
    fun escapedInputOfOlderBuildsReadsTheSame() {
        val old = Gson().toJson(SMSDTO().apply { message = text; sender = "+15555550100"; smsId = "m1" })
        assertTrue(old.contains("\\u003c"))
        val read = JobJson.fromJson(old)
        assertEquals(text, read.message)
        assertEquals("+15555550100", read.sender)
        assertEquals("m1", read.smsId)
    }

    @Test
    fun newInputReadsBack() {
        val read = JobJson.fromJson(JobJson.toJson(SMSDTO().apply { message = text; status = "SENT" }))
        assertEquals(text, read.message)
        assertEquals("SENT", read.status)
    }
}
