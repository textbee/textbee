package com.vernu.sms.helpers

import com.google.gson.JsonObject
import com.google.gson.JsonParser

// Sign in with textbee: reads the server answers and decides the next step. The server owns the texts,
// the app's own texts are only used when an answer has none.
object DeviceLink {
    const val DEFAULT_POLL_SECONDS = 3.0
    const val MIN_POLL_SECONDS = 2.0
    const val MAX_POLL_SECONDS = 30.0

    // A sign-in that takes longer than this is given up
    const val MAX_WAIT_MS = 45 * 60_000L

    // An approved sign-in whose last step did not succeed within this time is dropped
    const val MAX_FINISH_MS = 24 * 3_600_000L

    // A clock set back by more than this ends the wait
    private const val CLOCK_SLACK_MS = 60_000L

    const val FALLBACK_MANUAL_URL = "app.textbee.dev/link-device"

    const val UNAVAILABLE = "Sign-in is not available right now. Use an API key instead."
    const val NO_CONNECTION = "No internet connection. Check your network and retry."
    const val TOO_MANY = "Too many sign-in requests. Try again later."
    const val DENIED = "The request was cancelled."
    const val EXPIRED = "The code expired. Tap \"Sign in with textbee\" to try again."
    const val NOT_FOUND = "This sign-in request was not found. Start again."
    const val UNEXPECTED = "Something went wrong. Start again."
    const val FINISH_FAILED = "Could not finish the connection. Check your internet connection."
    const val DEVICE_REMOVED = "That device was removed. Sign in again."
    const val NO_LONGER_CONNECTED = "This phone is no longer connected. Sign in again."
    const val NOT_SAVED = "Could not save the sign-in on this phone. Free some storage and try again."
    const val CONNECTION_NOT_SAVED = "Could not save the connection on this phone. Free some storage and try again."

    // Reason phrases of HTTP codes. Sent alone, they tell the user nothing.
    private val REASON_PHRASES = setOf(
        "bad request", "unauthorized", "payment required", "forbidden", "not found", "method not allowed",
        "not acceptable", "request timeout", "conflict", "gone", "payload too large", "unsupported media type",
        "unprocessable entity", "too many requests", "internal server error", "not implemented", "bad gateway",
        "service unavailable", "gateway timeout",
    )
    private val EXCEPTION_NAME = Regex("\\b[A-Z][A-Za-z]*(Exception|Error)\\b")
    private val NO_ROUTE = Regex("^Cannot (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) ")

    private val DEVICE_ID_PATTERN = Regex("^[A-Za-z0-9_-]{1,64}$")

    data class LinkRequest(
        val displayCode: String,
        val linkUrl: String?,
        val manualUrl: String,
        val pollToken: String,
        val pollSeconds: Double?,
        val autoOpenBrowser: Boolean,
    )

    sealed class CreateResult {
        data class Ready(val request: LinkRequest) : CreateResult()

        // Sign-in cannot be used now: the API key tabs open with this text
        data class UseApiKey(val message: String) : CreateResult()

        // Worth another try later
        data class Failed(val message: String) : CreateResult()
    }

    data class Approved(
        val apiKey: String,
        val deviceId: String,
        val deviceName: String?,
        val accountEmail: String?,
        val reconnected: Boolean,
        val enable: Boolean,
    )

    enum class PollStep { WAIT, SLOW_DOWN, APPROVED, DENIED, EXPIRED, RESTART, STOP }

    data class PollResult(
        val step: PollStep,
        val message: String? = null,
        val pollSeconds: Double? = null,
        val approved: Approved? = null,
    )

    enum class FinishStep { DONE, RETRY, END }

    data class FinishResult(val step: FinishStep, val message: String? = null)

    /** The answer to the create call. A null code means no answer arrived. */
    fun createResult(httpCode: Int?, body: String?): CreateResult {
        if (httpCode == null) return CreateResult.Failed(NO_CONNECTION)
        if (httpCode in 200..299) {
            val data = data(body) ?: return CreateResult.UseApiKey(UNAVAILABLE)
            val code = data.text("displayCode")
            val token = data.text("pollToken")
            if (code == null || token == null) return CreateResult.UseApiKey(UNAVAILABLE)
            return CreateResult.Ready(
                LinkRequest(
                    displayCode = code,
                    linkUrl = data.text("linkUrl")?.takeIf { isSafeLinkUrl(it) },
                    manualUrl = data.text("manualUrl") ?: FALLBACK_MANUAL_URL,
                    pollToken = token,
                    pollSeconds = data.number("pollIntervalSeconds"),
                    autoOpenBrowser = data.flag("autoOpenBrowser") == true,
                )
            )
        }
        if (httpCode == 429) return CreateResult.Failed(serverText(body) ?: TOO_MANY)
        // A server without sign-in answers 404, and a generic 5xx text says nothing useful
        val ownText = httpCode == 404 || (httpCode in 500..599 && httpCode != 503)
        return CreateResult.UseApiKey(if (ownText) UNAVAILABLE else serverText(body) ?: UNAVAILABLE)
    }

    /** The answer to a poll. A null code means no answer arrived. */
    fun pollResult(httpCode: Int?, body: String?): PollResult = when {
        httpCode == null || httpCode in 500..599 -> PollResult(PollStep.WAIT)
        httpCode == 429 -> PollResult(PollStep.SLOW_DOWN)
        httpCode == 404 -> PollResult(PollStep.RESTART, serverText(body) ?: NOT_FOUND)
        httpCode in 200..299 -> pollAnswer(data(body))
        else -> PollResult(PollStep.STOP, serverText(body) ?: UNEXPECTED)
    }

    private fun pollAnswer(data: JsonObject?): PollResult {
        if (data == null) return PollResult(PollStep.STOP, UNEXPECTED)
        val message = data.text("message")
        return when (data.text("status")) {
            "pending" -> PollResult(PollStep.WAIT, pollSeconds = data.number("pollIntervalSeconds"))
            "denied" -> PollResult(PollStep.DENIED, message ?: DENIED)
            "expired" -> PollResult(PollStep.EXPIRED, message ?: EXPIRED)
            "approved" -> approved(data)?.let { PollResult(PollStep.APPROVED, approved = it) }
                ?: PollResult(PollStep.STOP, UNEXPECTED)
            else -> PollResult(PollStep.STOP, message ?: UNEXPECTED)
        }
    }

    private fun approved(data: JsonObject): Approved? {
        val apiKey = data.text("apiKey")?.takeIf { ApiKeyInput.problem(it) == null } ?: return null
        val deviceId = data.text("deviceId")?.takeIf { DEVICE_ID_PATTERN.matches(it) } ?: return null
        return Approved(
            apiKey = apiKey,
            deviceId = deviceId,
            deviceName = data.text("deviceName"),
            accountEmail = data.text("accountEmail"),
            reconnected = data.flag("reconnected") == true,
            enable = data.flag("enable") == true,
        )
    }

    /** The answer to the push address call that finishes the connect. */
    fun finishResult(httpCode: Int?, body: String?): FinishResult = when {
        httpCode != null && httpCode in 200..299 -> FinishResult(FinishStep.DONE)
        httpCode == 404 -> FinishResult(FinishStep.END, DEVICE_REMOVED)
        // Our API says the key was revoked or limited, so trying again cannot help. A page that is
        // not JSON comes from the network edge in front of the server and is worth another try.
        (httpCode == 401 || httpCode == 403) && parseObject(body) != null ->
            FinishResult(FinishStep.END, NO_LONGER_CONNECTED)
        httpCode == null || httpCode in 500..599 -> FinishResult(FinishStep.RETRY, FINISH_FAILED)
        else -> FinishResult(FinishStep.RETRY, serverText(body) ?: FINISH_FAILED)
    }

    /** The wait before the next poll: the server's interval within 2 and 30 seconds, twice that when asked to slow down. */
    fun pollDelayMs(serverSeconds: Double?, slowDown: Boolean = false): Long {
        val seconds = (serverSeconds?.takeIf { !it.isNaN() } ?: DEFAULT_POLL_SECONDS)
            .coerceIn(MIN_POLL_SECONDS, MAX_POLL_SECONDS)
        return (seconds * 1000).toLong() * (if (slowDown) 2 else 1)
    }

    fun waitTimeUp(startedAtMs: Long, nowMs: Long): Boolean =
        nowMs - startedAtMs >= MAX_WAIT_MS || nowMs < startedAtMs - CLOCK_SLACK_MS

    fun finishTimeUp(startedAtMs: Long, nowMs: Long): Boolean =
        nowMs - startedAtMs >= MAX_FINISH_MS || nowMs < startedAtMs - CLOCK_SLACK_MS

    enum class VisibilityStep { START, POLL_NOW, KEEP, STOP }

    /**
     * What the poll loop does when the waiting screen is shown or hidden. A poll that is already asked
     * is always read to the end, and no second loop starts beside it.
     */
    fun visibilityStep(visible: Boolean, loopRunning: Boolean, pollInFlight: Boolean): VisibilityStep = when {
        pollInFlight -> VisibilityStep.KEEP
        visible && !loopRunning -> VisibilityStep.START
        // Waiting between two polls: ask at once
        visible -> VisibilityStep.POLL_NOW
        loopRunning -> VisibilityStep.STOP
        else -> VisibilityStep.KEEP
    }

    /**
     * A sign-in screen that opens with no sign-in in progress was restored after Android stopped the app.
     * On a connected phone it goes on to where "Continue" leads, else back to the connect step.
     */
    fun continuesAfterRestore(startedWithoutSignIn: Boolean, deviceId: String?, apiKey: String?): Boolean =
        startedWithoutSignIn && !deviceId.isNullOrEmpty() && !apiKey.isNullOrEmpty()

    /** The text of a failed last step. An approval that is only in memory says so first, since a restart loses it. */
    fun finishFailureText(approvalSaved: Boolean, message: String?): String =
        if (!approvalSaved) NOT_SAVED else message ?: FINISH_FAILED

    /** A poll answer counts only for the sign-in it was asked for, not for one started after a Cancel. */
    fun isSameAttempt(currentPollToken: String?, polledToken: String): Boolean =
        currentPollToken != null && currentPollToken == polledToken

    /** At most [max] characters, never cutting a character that takes two UTF-16 units in half. */
    fun cut(text: String, max: Int): String {
        if (text.length <= max) return text
        val end = if (max > 0 && Character.isHighSurrogate(text[max - 1])) max - 1 else max
        return text.substring(0, end)
    }

    /** Only a web address over https is opened. */
    fun isSafeLinkUrl(url: String?): Boolean =
        url != null && url.length > "https://".length && url.startsWith("https://", ignoreCase = true) &&
            url.none { it.isWhitespace() || it.isISOControl() }

    /** The text of an error answer: its `error`, else its `message`. A bare reason phrase or a framework error name counts as no text. */
    fun serverText(body: String?): String? {
        val json = parseObject(body) ?: return null
        return listOfNotNull(json.text("error"), json.text("message")).firstOrNull { isForPeople(it) }
    }

    fun isForPeople(text: String): Boolean {
        val plain = text.trim().trimEnd('.').lowercase()
        return plain.isNotEmpty() && plain !in REASON_PHRASES &&
            !EXCEPTION_NAME.containsMatchIn(text) && !NO_ROUTE.containsMatchIn(text)
    }

    private fun data(body: String?): JsonObject? =
        parseObject(body)?.get("data")?.takeIf { it.isJsonObject }?.asJsonObject

    private fun parseObject(body: String?): JsonObject? = try {
        if (body.isNullOrBlank()) null
        else JsonParser.parseString(body).takeIf { it.isJsonObject }?.asJsonObject
    } catch (e: Exception) {
        null
    }

    // Each field is read on its own, so one field of an unexpected type leaves the others usable
    private fun JsonObject.text(name: String): String? =
        get(name)?.takeIf { it.isJsonPrimitive && !it.asJsonPrimitive.isBoolean }?.asString?.trim()?.takeIf { it.isNotEmpty() }

    private fun JsonObject.number(name: String): Double? =
        get(name)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isNumber }?.asDouble

    private fun JsonObject.flag(name: String): Boolean? =
        get(name)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isBoolean }?.asBoolean
}
