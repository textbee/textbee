package com.vernu.sms.helpers

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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
        assertTrue(DeviceLinkStore.save(dir, session))
        assertEquals(session, DeviceLinkStore.load(dir))
    }

    @Test
    fun aFailedSaveIsReported() {
        // A plain file where the folder should be: nothing can be written there
        val notAFolder = folder.newFile("not-a-folder")
        assertFalse(DeviceLinkStore.save(notAFolder, session))
        assertNull(DeviceLinkStore.load(notAFolder))
    }

    @Test
    fun aFileThatCannotBeDeletedNeverReadsBackAsASignIn() {
        val dir = folder.newFolder("locked")
        assertTrue(DeviceLinkStore.save(dir, session))
        // In a folder without write access a file cannot be deleted, but it can still be written
        // (as root the delete still works, and the check below holds either way)
        assertTrue(dir.setWritable(false))
        try {
            DeviceLinkStore.clear(dir)
            assertNull(DeviceLinkStore.load(dir))
        } finally {
            dir.setWritable(true)
        }
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
        assertFalse(DeviceLinkStore.save(null as File?, session))
        DeviceLinkStore.clear(null as File?)
        assertNull(DeviceLinkStore.load(null as File?))
    }
}
