package com.vernu.sms.helpers

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.After
import org.junit.Before
import org.junit.Test

class InstallSourceTest {
    @Test
    fun api30AndNewerKeepsBothPackages() {
        val r = InstallSource.report(30, "com.android.vending", "com.android.packageinstaller", 1700000000000L)
        assertEquals("com.android.vending", r.installerPackage)
        assertEquals("com.android.packageinstaller", r.initiatingPackage)
        assertEquals(1700000000000L, r.appLastUpdateTime)
    }

    @Test
    fun anUnknownInstallerIsAnEmptyString() {
        val r = InstallSource.report(34, null, null, 5L)
        assertEquals("", r.installerPackage)
        assertNull(r.initiatingPackage)
    }

    @Test
    fun beforeApi30HasNoInitiatingPackage() {
        val r = InstallSource.report(29, "com.android.vending", "ignored", 5L)
        assertEquals("com.android.vending", r.installerPackage)
        assertNull(r.initiatingPackage)
        assertEquals("", InstallSource.report(24, null, null, 5L).installerPackage)
    }
}

class InstallSourceLookupTest {
    private class FakeReader(
        val failing: Boolean = false,
        val installing: String? = "com.android.vending"
    ) : InstallSourceReader {
        var infoCalls = 0
        var legacyCalls = 0
        var timeCalls = 0

        override fun installSourceInfo(): Pair<String?, String?> {
            infoCalls++
            if (failing) throw SecurityException("blocked")
            return Pair(installing, "com.android.packageinstaller")
        }

        override fun legacyInstaller(): String? {
            legacyCalls++
            if (failing) throw SecurityException("blocked")
            return installing
        }

        override fun lastUpdateTime(): Long {
            timeCalls++
            return 9L
        }
    }

    @Before
    fun clear() = InstallSource.resetCache()

    @After
    fun clearAfter() = InstallSource.resetCache()

    @Test
    fun api30AndNewerUsesInstallSourceInfo() {
        val reader = FakeReader()
        val r = InstallSource.resolve(30, reader)!!
        assertEquals(1, reader.infoCalls)
        assertEquals(0, reader.legacyCalls)
        assertEquals("com.android.packageinstaller", r.initiatingPackage)
    }

    @Test
    fun olderVersionsUseTheLegacyInstallerCall() {
        val reader = FakeReader()
        val r = InstallSource.resolve(29, reader)!!
        assertEquals(0, reader.infoCalls)
        assertEquals(1, reader.legacyCalls)
        assertEquals("com.android.vending", r.installerPackage)
        assertNull(r.initiatingPackage)
    }

    @Test
    fun aThrowingLookupReturnsNullAndIsNotCached() {
        val failing = FakeReader(failing = true)
        assertNull(InstallSource.resolve(34, failing))
        val working = FakeReader()
        assertNotNull(InstallSource.resolve(34, working))
        assertEquals(1, working.infoCalls)
    }

    @Test
    fun aSuccessIsCached() {
        val first = FakeReader()
        InstallSource.resolve(34, first)
        val second = FakeReader(installing = "other")
        val r = InstallSource.resolve(34, second)!!
        assertEquals(0, second.infoCalls)
        assertEquals("com.android.vending", r.installerPackage)
    }
}
