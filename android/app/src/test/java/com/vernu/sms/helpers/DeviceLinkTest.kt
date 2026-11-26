package com.vernu.sms.helpers

import com.vernu.sms.helpers.DeviceLink.CreateResult
import com.vernu.sms.helpers.DeviceLink.FinishStep
import com.vernu.sms.helpers.DeviceLink.PollStep
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceLinkTest {
    private val createAnswer = """{"data":{"displayCode":"K7QX-2M9P","linkUrl":"https://app.textbee.dev/link-device?code=K7QX-2M9P","manualUrl":"app.textbee.dev/link-device","pollToken":"${"t".repeat(43)}","expiresAt":"2026-11-26T12:10:00.000Z","pollIntervalSeconds":3,"autoOpenBrowser":false}}"""
    private val approvedAnswer = """{"data":{"status":"approved","apiKey":"txb_aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0hL","deviceId":"665f1c2ab3d4e5f6a7b8c9d0","deviceName":"Pixel 8","accountEmail":"j***@example.com","reconnected":false,"enable":true}}"""

    private fun ready(body: String): DeviceLink.LinkRequest =
        (DeviceLink.createResult(201, body) as CreateResult.Ready).request

    // Create

    @Test
    fun theCreateAnswerIsRead() {
        val request = ready(createAnswer)
        assertEquals("K7QX-2M9P", request.displayCode)
        assertEquals("https://app.textbee.dev/link-device?code=K7QX-2M9P", request.linkUrl)
        assertEquals("app.textbee.dev/link-device", request.manualUrl)
        assertEquals(43, request.pollToken.length)
        assertEquals(3.0, request.pollSeconds!!, 0.0)
        assertFalse(request.autoOpenBrowser)
    }

    @Test
    fun theBrowserOpensByItselfOnlyWhenTheServerSaysTrue() {
        assertFalse(ready(createAnswer.replace(",\"autoOpenBrowser\":false", "")).autoOpenBrowser)
        assertFalse(ready(createAnswer.replace("\"autoOpenBrowser\":false", "\"autoOpenBrowser\":null")).autoOpenBrowser)
        assertFalse(ready(createAnswer.replace("\"autoOpenBrowser\":false", "\"autoOpenBrowser\":\"yes\"")).autoOpenBrowser)
        assertTrue(ready(createAnswer.replace("\"autoOpenBrowser\":false", "\"autoOpenBrowser\":true")).autoOpenBrowser)
    }

    @Test
    fun missingAddressesFallBackOrAreLeftOut() {
        val request = ready("""{"data":{"displayCode":"K7QX-2M9P","pollToken":"abc"}}""")
        assertEquals(DeviceLink.FALLBACK_MANUAL_URL, request.manualUrl)
        assertNull(request.linkUrl)
        assertNull(request.pollSeconds)
    }

    @Test
    fun aLinkThatIsNotHttpsIsNeverKept() {
        val request = ready(createAnswer.replace("https://app.textbee.dev", "http://app.textbee.dev"))
        assertNull(request.linkUrl)
    }

    @Test
    fun aFieldOfAnotherTypeDoesNotBreakTheAnswer() {
        val request = ready(createAnswer.replace("\"pollIntervalSeconds\":3", "\"pollIntervalSeconds\":{\"a\":1}"))
        assertNull(request.pollSeconds)
        assertEquals("K7QX-2M9P", request.displayCode)
    }

    @Test
    fun aServerWithoutSignInOpensTheApiKeyTabs() {
        val nestNotFound = """{"message":"Cannot POST /api/v1/auth/device-links","error":"Not Found","statusCode":404}"""
        assertEquals(CreateResult.UseApiKey(DeviceLink.UNAVAILABLE), DeviceLink.createResult(404, nestNotFound))
        assertEquals(CreateResult.UseApiKey(DeviceLink.UNAVAILABLE), DeviceLink.createResult(500, """{"message":"Internal server error"}"""))
        assertEquals(CreateResult.UseApiKey(DeviceLink.UNAVAILABLE), DeviceLink.createResult(502, "<html>Bad gateway</html>"))
    }

    @Test
    fun theServerTextIsShownWhenSignInIsOff() {
        val off = """{"error":"Sign-in is off for now.","code":"DEVICE_LINKS_OFF"}"""
        assertEquals(CreateResult.UseApiKey("Sign-in is off for now."), DeviceLink.createResult(503, off))
        assertEquals(CreateResult.UseApiKey("Invalid phone details."), DeviceLink.createResult(400, """{"error":"Invalid phone details."}"""))
    }

    @Test
    fun aCreateAnswerWithoutCodeOrTokenOpensTheApiKeyTabs() {
        assertEquals(CreateResult.UseApiKey(DeviceLink.UNAVAILABLE), DeviceLink.createResult(201, """{"data":{"displayCode":"K7QX-2M9P"}}"""))
        assertEquals(CreateResult.UseApiKey(DeviceLink.UNAVAILABLE), DeviceLink.createResult(200, "not json"))
        assertEquals(CreateResult.UseApiKey(DeviceLink.UNAVAILABLE), DeviceLink.createResult(201, null))
    }

    @Test
    fun tooManyRequestsAndNoConnectionCanBeTriedAgain() {
        assertEquals(CreateResult.Failed("Slow down."), DeviceLink.createResult(429, """{"error":"Slow down."}"""))
        assertEquals(CreateResult.Failed(DeviceLink.TOO_MANY), DeviceLink.createResult(429, null))
        assertEquals(CreateResult.Failed(DeviceLink.NO_CONNECTION), DeviceLink.createResult(null, null))
    }

    // Poll

    @Test
    fun pendingKeepsWaitingWithTheServerInterval() {
        val result = DeviceLink.pollResult(200, """{"data":{"status":"pending","pollIntervalSeconds":5}}""")
        assertEquals(PollStep.WAIT, result.step)
        assertEquals(5.0, result.pollSeconds!!, 0.0)
    }

    @Test
    fun networkErrorsAndServerErrorsKeepWaiting() {
        assertEquals(PollStep.WAIT, DeviceLink.pollResult(null, null).step)
        assertEquals(PollStep.WAIT, DeviceLink.pollResult(500, null).step)
        assertEquals(PollStep.WAIT, DeviceLink.pollResult(503, """{"error":"busy"}""").step)
    }

    @Test
    fun tooManyPollsSlowDown() {
        assertEquals(PollStep.SLOW_DOWN, DeviceLink.pollResult(429, null).step)
    }

    @Test
    fun anUnknownRequestStartsAgain() {
        val result = DeviceLink.pollResult(404, """{"error":"This sign-in request was not found. Start again."}""")
        assertEquals(PollStep.RESTART, result.step)
        assertEquals("This sign-in request was not found. Start again.", result.message)
        assertEquals(DeviceLink.NOT_FOUND, DeviceLink.pollResult(404, null).message)
    }

    @Test
    fun unauthorizedAndForbiddenStop() {
        assertEquals(PollStep.STOP, DeviceLink.pollResult(401, null).step)
        assertEquals(DeviceLink.UNEXPECTED, DeviceLink.pollResult(401, null).message)
        assertEquals("No.", DeviceLink.pollResult(403, """{"error":"No."}""").message)
        assertEquals(PollStep.STOP, DeviceLink.pollResult(418, null).step)
    }

    @Test
    fun deniedAndExpiredShowTheServerText() {
        val denied = DeviceLink.pollResult(200, """{"data":{"status":"denied","message":"Cancelled in the browser."}}""")
        assertEquals(PollStep.DENIED, denied.step)
        assertEquals("Cancelled in the browser.", denied.message)
        assertEquals(DeviceLink.DENIED, DeviceLink.pollResult(200, """{"data":{"status":"denied"}}""").message)
        val expired = DeviceLink.pollResult(200, """{"data":{"status":"expired"}}""")
        assertEquals(PollStep.EXPIRED, expired.step)
        assertEquals(DeviceLink.EXPIRED, expired.message)
    }

    @Test
    fun anUnknownStatusStopsWithTheServerText() {
        val result = DeviceLink.pollResult(200, """{"data":{"status":"paused","message":"Ask support."}}""")
        assertEquals(PollStep.STOP, result.step)
        assertEquals("Ask support.", result.message)
        assertEquals(DeviceLink.UNEXPECTED, DeviceLink.pollResult(200, """{"data":{}}""").message)
        assertEquals(PollStep.STOP, DeviceLink.pollResult(200, "{}").step)
    }

    @Test
    fun theApprovedAnswerIsRead() {
        val result = DeviceLink.pollResult(200, approvedAnswer)
        assertEquals(PollStep.APPROVED, result.step)
        val approved = result.approved!!
        assertEquals("txb_aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0hL", approved.apiKey)
        assertEquals("665f1c2ab3d4e5f6a7b8c9d0", approved.deviceId)
        assertEquals("Pixel 8", approved.deviceName)
        assertEquals("j***@example.com", approved.accountEmail)
        assertFalse(approved.reconnected)
        assertTrue(approved.enable)
    }

    @Test
    fun aMissingEnableNeverTurnsTheDeviceOn() {
        val result = DeviceLink.pollResult(200, approvedAnswer.replace(",\"enable\":true", ""))
        assertFalse(result.approved!!.enable)
    }

    @Test
    fun anApprovedAnswerWithoutAUsableKeyOrDeviceStops() {
        assertEquals(PollStep.STOP, DeviceLink.pollResult(200, approvedAnswer.replace("txb_aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0hL", "")).step)
        assertEquals(PollStep.STOP, DeviceLink.pollResult(200, approvedAnswer.replace("txb_aB3dE6", "txb aB3dE6")).step)
        assertEquals(PollStep.STOP, DeviceLink.pollResult(200, approvedAnswer.replace("665f1c2ab3d4e5f6a7b8c9d0", "../devices")).step)
        assertEquals(DeviceLink.UNEXPECTED, DeviceLink.pollResult(200, approvedAnswer.replace("\"deviceId\":\"665f1c2ab3d4e5f6a7b8c9d0\",", "")).message)
    }

    // Poll interval

    @Test
    fun theIntervalIsTheServerValueWithinItsLimits() {
        assertEquals(3_000L, DeviceLink.pollDelayMs(null))
        assertEquals(5_000L, DeviceLink.pollDelayMs(5.0))
        assertEquals(2_500L, DeviceLink.pollDelayMs(2.5))
        assertEquals(2_000L, DeviceLink.pollDelayMs(0.0))
        assertEquals(2_000L, DeviceLink.pollDelayMs(-4.0))
        assertEquals(30_000L, DeviceLink.pollDelayMs(600.0))
        assertEquals(3_000L, DeviceLink.pollDelayMs(Double.NaN))
    }

    @Test
    fun slowingDownDoublesTheInterval() {
        assertEquals(6_000L, DeviceLink.pollDelayMs(null, slowDown = true))
        assertEquals(60_000L, DeviceLink.pollDelayMs(30.0, slowDown = true))
        assertEquals(4_000L, DeviceLink.pollDelayMs(1.0, slowDown = true))
    }

    @Test
    fun theWaitEndsAfter45Minutes() {
        val start = 1_000_000_000L
        assertFalse(DeviceLink.waitTimeUp(start, start))
        assertFalse(DeviceLink.waitTimeUp(start, start + 45 * 60_000L - 1))
        assertTrue(DeviceLink.waitTimeUp(start, start + 45 * 60_000L))
        // A clock set far back ends the wait, a small correction does not
        assertFalse(DeviceLink.waitTimeUp(start, start - 30_000L))
        assertTrue(DeviceLink.waitTimeUp(start, start - 10 * 60_000L))
    }

    // Link address

    @Test
    fun onlyHttpsAddressesAreOpened() {
        assertTrue(DeviceLink.isSafeLinkUrl("https://app.textbee.dev/link-device?code=K7QX-2M9P"))
        assertTrue(DeviceLink.isSafeLinkUrl("HTTPS://app.textbee.dev/link-device"))
        assertFalse(DeviceLink.isSafeLinkUrl(null))
        assertFalse(DeviceLink.isSafeLinkUrl(""))
        assertFalse(DeviceLink.isSafeLinkUrl("https://"))
        assertFalse(DeviceLink.isSafeLinkUrl("http://app.textbee.dev/link-device"))
        assertFalse(DeviceLink.isSafeLinkUrl("javascript:alert(1)"))
        assertFalse(DeviceLink.isSafeLinkUrl("intent://scan/#Intent;end"))
        assertFalse(DeviceLink.isSafeLinkUrl(" https://app.textbee.dev"))
        assertFalse(DeviceLink.isSafeLinkUrl("https://app.textbee.dev/a b"))
    }

    // Push address step

    @Test
    fun theLastStepSucceedsOnASuccessAnswer() {
        assertEquals(FinishStep.DONE, DeviceLink.finishResult(200, null).step)
    }

    @Test
    fun aRemovedDeviceEndsTheSignIn() {
        val result = DeviceLink.finishResult(404, """{"error":"Device not found"}""")
        assertEquals(FinishStep.REMOVED, result.step)
        assertEquals(DeviceLink.DEVICE_REMOVED, result.message)
    }

    @Test
    fun otherFailuresOfferTryAgainWithTheServerText() {
        assertEquals(DeviceLink.FinishResult(FinishStep.RETRY, DeviceLink.FINISH_FAILED), DeviceLink.finishResult(null, null))
        assertEquals(DeviceLink.FinishResult(FinishStep.RETRY, DeviceLink.FINISH_FAILED), DeviceLink.finishResult(502, "<html></html>"))
        assertEquals(DeviceLink.FinishResult(FinishStep.RETRY, "Plan limit."), DeviceLink.finishResult(429, """{"message":"Plan limit."}"""))
        assertEquals(DeviceLink.FinishResult(FinishStep.RETRY, DeviceLink.FINISH_FAILED), DeviceLink.finishResult(400, "{}"))
    }

    // Server text

    @Test
    fun theErrorTextIsReadFromErrorThenMessage() {
        assertEquals("A", DeviceLink.serverText("""{"error":"A","message":"B"}"""))
        assertEquals("B", DeviceLink.serverText("""{"message":"B"}"""))
        assertNull(DeviceLink.serverText("""{"message":["a","b"]}"""))
        assertNull(DeviceLink.serverText("""{"error":"  "}"""))
        assertNull(DeviceLink.serverText("[]"))
        assertNull(DeviceLink.serverText(null))
    }

    // Saved state

    @Test
    fun aPendingSignInResumesOnlyWhileTheCodeCanBeApproved() {
        val session = DeviceLinkSession(displayCode = "K7QX-2M9P", pollToken = "t", startedAtMs = 1_000_000L)
        assertTrue(session.canResume(1_000_000L + 60_000L))
        assertFalse(session.canResume(1_000_000L + DeviceLink.MAX_WAIT_MS))
        assertFalse(DeviceLinkSession().canResume(0L))
    }

    @Test
    fun anApprovedSignInAlwaysResumes() {
        val session = DeviceLinkSession(
            displayCode = "K7QX-2M9P", pollToken = "t", startedAtMs = 0L,
            apiKey = "txb_key", deviceId = "665f1c2ab3d4e5f6a7b8c9d0"
        )
        assertTrue(session.isApproved)
        assertTrue(session.canResume(DeviceLink.MAX_WAIT_MS * 10))
    }
}
