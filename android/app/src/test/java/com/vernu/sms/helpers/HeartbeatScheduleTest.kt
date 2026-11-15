package com.vernu.sms.helpers

import androidx.work.ExistingPeriodicWorkPolicy
import com.vernu.sms.workers.HeartbeatWorker
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HeartbeatScheduleTest {
    @Test
    fun theSamePeriodKeepsTheJob() {
        for (afterRun in listOf(false, true)) {
            assertEquals(
                ScheduleDecision(ExistingPeriodicWorkPolicy.KEEP, 30, 0),
                HeartbeatManager.scheduleDecision(30, 30, afterRun),
            )
        }
    }

    @Test
    fun aNewPeriodAfterARunReplacesTheJobAndStartsItOnePeriodLater() {
        assertEquals(
            ScheduleDecision(ExistingPeriodicWorkPolicy.REPLACE, 60, 60),
            HeartbeatManager.scheduleDecision(60, 30, afterRun = true),
        )
        assertEquals(
            ScheduleDecision(ExistingPeriodicWorkPolicy.REPLACE, 30, 30),
            HeartbeatManager.scheduleDecision(30, null, afterRun = true),
        )
    }

    @Test
    fun aOneShotRunMovesThePeriodicJobOnlyWhenThePeriodChanged() {
        // A one-shot reschedules with afterRun, since it just sent a heartbeat
        assertEquals(
            ScheduleDecision(ExistingPeriodicWorkPolicy.KEEP, 30, 0),
            HeartbeatManager.scheduleDecision(30, 30, afterRun = true),
        )
        assertEquals(
            ScheduleDecision(ExistingPeriodicWorkPolicy.REPLACE, 120, 120),
            HeartbeatManager.scheduleDecision(120, 30, afterRun = true),
        )
    }

    @Test
    fun otherCallersReplaceTheJobWithNoDelay() {
        assertEquals(
            ScheduleDecision(ExistingPeriodicWorkPolicy.REPLACE, 60, 0),
            HeartbeatManager.scheduleDecision(60, 30, afterRun = false),
        )
        // A fresh install runs the job at once
        assertEquals(
            ScheduleDecision(ExistingPeriodicWorkPolicy.REPLACE, 30, 0),
            HeartbeatManager.scheduleDecision(30, null, afterRun = false),
        )
    }

    @Test
    fun theWantedPeriodIsClamped() {
        assertEquals(
            ScheduleDecision(ExistingPeriodicWorkPolicy.REPLACE, 15, 15),
            HeartbeatManager.scheduleDecision(5, 30, afterRun = true),
        )
        assertEquals(
            ScheduleDecision(ExistingPeriodicWorkPolicy.KEEP, 240, 0),
            HeartbeatManager.scheduleDecision(1_000, 240, afterRun = true),
        )
        // A stored applied value outside the range never matches, so the job is replaced once
        assertEquals(
            ScheduleDecision(ExistingPeriodicWorkPolicy.REPLACE, 15, 0),
            HeartbeatManager.scheduleDecision(15, 10, afterRun = false),
        )
    }

    // Applies to periodic and one-shot runs alike
    @Test
    fun onlyARunningEligibleJobQueuesItselfAgain() {
        assertTrue(HeartbeatWorker.reschedulesAfterRun(stopped = false, eligible = true))
        assertFalse(HeartbeatWorker.reschedulesAfterRun(stopped = true, eligible = true))
        assertFalse(HeartbeatWorker.reschedulesAfterRun(stopped = false, eligible = false))
        assertFalse(HeartbeatWorker.reschedulesAfterRun(stopped = true, eligible = false))
    }
}
