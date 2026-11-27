package com.vernu.sms.dtos

import com.google.gson.Gson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// The current-subscription answer, read with Gson as the app does. The dashboard card reads
// plan.name, usage.dailyLimit, usage.dailyUsagePercentage, usage.monthlyLimit,
// usage.monthlyUsagePercentage and currentPeriodEnd.
class SubscriptionResponseJsonTest {
    private val gson = Gson()

    private fun parse(json: String): SubscriptionResponse = gson.fromJson(json, SubscriptionResponse::class.java)

    private val usage = """"usage":{"processedSmsToday":12,"processedSmsLastMonth":340,""" +
        """"monthlyPeriodStart":"2026-11-01T00:00:00.000Z","monthlyResetAt":"2026-12-01T00:00:00.000Z",""" +
        """"dailyLimit":500,"monthlyLimit":5000,"bulkSendLimit":-1,"deviceLimit":3,"webhookLimit":10,""" +
        """"paymentHold":null,"dailyRemaining":488,"monthlyRemaining":4660,""" +
        """"dailyUsagePercentage":2,"monthlyUsagePercentage":7}"""

    @Test
    fun aPaidSubscriptionIsRead() {
        val json = """{"_id":"6650a1b2c3d4e5f6a7b8c9d0","user":"665f1c2ab3d4e5f6a7b8c9d0",""" +
            """"plan":{"_id":"6650a1b2c3d4e5f6a7b8c9d1","name":"pro","displayName":"Pro","monthlyPrice":690,"dailyLimit":500,"isActive":true},""" +
            """"isActive":true,"currentPeriodStart":"2026-11-01T00:00:00.000Z","currentPeriodEnd":"2026-12-01T00:00:00.000Z",""" +
            "$usage}"
        val subscription = parse(json)
        assertEquals("pro", subscription.plan?.name)
        assertEquals("Pro", subscription.plan?.displayName)
        assertEquals(true, subscription.isActive)
        assertEquals("2026-12-01T00:00:00.000Z", subscription.currentPeriodEnd)
        val read = subscription.usage!!
        assertEquals(500, read.dailyLimit)
        assertEquals(5000, read.monthlyLimit)
        assertEquals(2, read.dailyUsagePercentage)
        assertEquals(7, read.monthlyUsagePercentage)
        assertEquals(12, read.processedSmsToday)
        assertEquals(4660, read.monthlyRemaining)
    }

    @Test
    fun theFreePlanWithoutASubscriptionIsRead() {
        // No subscription record: the plan, isActive and usage only, no period dates
        val json = """{"plan":{"_id":"6650a1b2c3d4e5f6a7b8c9d2","name":"free","dailyLimit":50},"isActive":true,$usage}"""
        val subscription = parse(json)
        assertEquals("free", subscription.plan?.name)
        assertNull(subscription.plan?.displayName)
        assertNull(subscription.currentPeriodEnd)
        assertTrue(subscription.usage != null)
    }

    @Test
    fun unlimitedPlansReadMinusOne() {
        val json = """{"plan":{"name":"custom-acme"},"usage":{"dailyLimit":-1,"monthlyLimit":-1,""" +
            """"dailyRemaining":-1,"monthlyRemaining":-1,"dailyUsagePercentage":0,"monthlyUsagePercentage":0}}"""
        val read = parse(json).usage!!
        assertEquals(-1, read.dailyLimit)
        assertEquals(-1, read.monthlyLimit)
        assertEquals(0, read.dailyUsagePercentage)
    }

    @Test
    fun missingPartsReadAsNull() {
        val subscription = parse("{}")
        assertNull(subscription.plan)
        assertNull(subscription.usage)
        assertNull(subscription.currentPeriodEnd)
    }
}
