package com.vernu.sms.helpers

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class DeviceLinkStoreTest {
    @get:Rule
    val folder = TemporaryFolder()

    private val session = DeviceLinkSession(
        displayCode = "K7QX-2M9P",
        linkUrl = "https://app.textbee.dev/link-device?code=K7QX-2M9P",
        manualUrl = "app.textbee.dev/link-device",
        pollToken = "t".repeat(43),
        pollSeconds = 3.0,
        startedAtMs = 1_000_000L,
        browserOpened = true,
        apiKey = "txb_key",
        deviceId = "665f1c2ab3d4e5f6a7b8c9d0",
        deviceName = "Pixel 8",
        accountEmail = "j***@example.com",
        reconnected = true,
        enable = true,
    )

    @Test
    fun aSavedSignInIsReadBackWhole() {
        val dir = folder.root
        DeviceLinkStore.save(dir, session)
        assertEquals(session, DeviceLinkStore.load(dir))
    }

    @Test
    fun nothingStoredReadsAsNothing() {
        assertNull(DeviceLinkStore.load(folder.root))
    }

    @Test
    fun aDamagedFileReadsAsNothing() {
        File(folder.root, "device_link.json").writeText("{not json")
        assertNull(DeviceLinkStore.load(folder.root))
    }

    @Test
    fun clearRemovesTheFile() {
        val dir = folder.root
        DeviceLinkStore.save(dir, session)
        DeviceLinkStore.clear(dir)
        assertNull(DeviceLinkStore.load(dir))
        assertFalse(File(dir, "device_link.json").exists())
    }

    @Test
    fun noStorageFolderIsHandled() {
        DeviceLinkStore.save(null as File?, session)
        DeviceLinkStore.clear(null as File?)
        assertNull(DeviceLinkStore.load(null as File?))
    }
}
