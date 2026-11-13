package com.vernu.sms.ui.components

import androidx.compose.runtime.saveable.Saver

// Not listSaver: it saves an empty list as null, and the restored state then holds null
internal val StringSetSaver: Saver<Set<String>, ArrayList<String>> =
    Saver(save = { ArrayList(it) }, restore = { it.toSet() })
