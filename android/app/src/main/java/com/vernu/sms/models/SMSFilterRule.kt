package com.vernu.sms.models

class SMSFilterRule @JvmOverloads constructor(
    var pattern: String? = null,
    var matchType: MatchType? = null,
    var filterTarget: FilterTarget = FilterTarget.SENDER,
    @get:JvmName("isCaseSensitive") var caseSensitive: Boolean = false
) {
    enum class MatchType { EXACT, STARTS_WITH, ENDS_WITH, CONTAINS }
    enum class FilterTarget { SENDER, MESSAGE, BOTH }

    private fun matchesString(text: String?): Boolean {
        val p = pattern ?: return false
        val t = text ?: return false
        val pat = if (caseSensitive) p else p.lowercase()
        val txt = if (caseSensitive) t else t.lowercase()
        return when (matchType) {
            MatchType.EXACT -> txt == pat
            MatchType.STARTS_WITH -> txt.startsWith(pat)
            MatchType.ENDS_WITH -> txt.endsWith(pat)
            MatchType.CONTAINS -> txt.contains(pat)
            null -> false
        }
    }

    fun matches(sender: String?, message: String?): Boolean {
        if (pattern == null) return false
        return when (filterTarget) {
            FilterTarget.SENDER -> matchesString(sender)
            FilterTarget.MESSAGE -> matchesString(message)
            FilterTarget.BOTH -> matchesString(sender) || matchesString(message)
        }
    }
}
