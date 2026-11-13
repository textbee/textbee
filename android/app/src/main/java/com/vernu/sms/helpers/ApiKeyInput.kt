package com.vernu.sms.helpers

// What the API key field keeps and what it tells the user. The server decides if a key is valid.
object ApiKeyInput {
    // Far above the length of a key, so a wrong paste gets a message and the field never holds a huge text
    const val MAX_LENGTH = 512

    // Below this a key is almost surely cut off. Used for a hint only.
    private const val SHORT_LENGTH = 20

    const val HAS_SPACES = "An API key has no spaces or line breaks. Copy only the key, not a command or a link."
    const val TOO_LONG = "This is too long for an API key. Copy only the key from your textbee dashboard."
    const val OTHER_CHARACTERS =
        "An API key has only letters, digits and symbols such as - and _. Copy it again from your textbee dashboard."
    const val LOOKS_SHORT = "This looks too short for an API key. Check that you copied the whole key."

    /** The text the field keeps: the key without what a copy adds around it, never more than one character over the limit. */
    fun clean(raw: String): String {
        // Invisible format characters come along with a copy from some pages
        val visible = raw.filterNot { Character.getType(it) == Character.FORMAT.toInt() }.trim()
        val quoted = visible.length >= 2 && visible.first() == visible.last() && visible.first() in "\"'"
        val key = if (quoted) visible.substring(1, visible.length - 1).trim() else visible
        return key.take(MAX_LENGTH + 1)
    }

    /** Why this text can never be a key, or null. */
    fun problem(key: String): String? = when {
        key.any { it.isWhitespace() } -> HAS_SPACES
        key.length > MAX_LENGTH -> TOO_LONG
        // A key travels in a request header, which holds only visible ASCII characters
        key.any { it.code !in 0x21..0x7E } -> OTHER_CHARACTERS
        else -> null
    }

    /** A note for a key that can be sent but looks cut off. */
    fun hint(key: String): String? =
        if (key.isNotEmpty() && key.length < SHORT_LENGTH && problem(key) == null) LOOKS_SHORT else null

    fun canSubmit(key: String): Boolean = key.isNotEmpty() && problem(key) == null
}
