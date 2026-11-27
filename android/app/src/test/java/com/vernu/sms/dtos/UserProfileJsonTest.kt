package com.vernu.sms.dtos

import com.google.gson.Gson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

// The who-am-i answer, read with Gson as the app does
class UserProfileJsonTest {
    private val gson = Gson()

    private fun parse(json: String): UserProfile? = gson.fromJson(json, UserProfileWrapper::class.java).data

    @Test
    fun aLabelIsRead() {
        val profile = parse("""{"data":{"name":"Jane","email":"jane@example.com","accountLabel":"Acme Inc"}}""")!!
        assertEquals("Jane", profile.name)
        assertEquals("jane@example.com", profile.email)
        assertEquals("Acme Inc", profile.accountLabel)
    }

    @Test
    fun anAnswerWithoutALabelStillReads() {
        val profile = parse("""{"data":{"name":"Jane","email":"jane@example.com"}}""")!!
        assertEquals("Jane", profile.name)
        assertNull(profile.accountLabel)
    }

    @Test
    fun aNullNameOrEmailIsRead() {
        val noName = parse("""{"data":{"name":null,"email":"jane@example.com","accountLabel":"jane@example.com"}}""")!!
        assertNull(noName.name)
        assertEquals("jane@example.com", noName.accountLabel)
        val noEmail = parse("""{"data":{"name":"Acme Inc","email":null}}""")!!
        assertEquals("Acme Inc", noEmail.name)
        assertNull(noEmail.email)
        assertNull(noEmail.accountLabel)
    }

    @Test
    fun theFullUserOfAHandMadeKeyIsRead() {
        // A hand-made key gets the whole user record; unknown fields are ignored
        val json = """{"data":{"_id":"665f1c2ab3d4e5f6a7b8c9d0","name":"Jane","email":"jane@example.com",""" +
            """"role":"REGULAR","emailVerifiedAt":"2026-01-02T03:04:05.000Z","isBanned":false,"createdAt":"2025-12-01T00:00:00.000Z"}}"""
        val profile = parse(json)!!
        assertEquals("Jane", profile.name)
        assertEquals("jane@example.com", profile.email)
        assertNull(profile.accountLabel)
    }

    @Test
    fun aLabelOfAnotherTypeNeverBreaksTheAnswer() {
        for (label in listOf("{\"name\":\"Acme Inc\"}", "[\"Acme Inc\"]", "null", "true")) {
            val profile = parse("""{"data":{"name":"Jane","email":"jane@example.com","accountLabel":$label}}""")!!
            assertEquals(label, "Jane", profile.name)
            assertEquals(label, "jane@example.com", profile.email)
            assertNull(label, profile.accountLabel)
        }
    }

    @Test
    fun aNumberLabelIsReadAsText() {
        val profile = parse("""{"data":{"name":"Jane","email":"jane@example.com","accountLabel":42}}""")!!
        assertEquals("Jane", profile.name)
        assertEquals("jane@example.com", profile.email)
        assertEquals("42", profile.accountLabel)
    }

    @Test
    fun anAnswerWithoutDataReadsAsNoProfile() {
        assertNull(parse("{}"))
    }
}
