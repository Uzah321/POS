package com.corepos.core_pos

import android.app.Application
import android.content.Context
import android.os.Build
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter

/**
 * Catches the app closing unexpectedly, so the next start can say why
 * (LaunchActivity) instead of the till just closing again with no clue.
 *
 * - A Java/Kotlin crash is written to last-crash.txt with its stack trace.
 * - A crash below that (native code, graphics) leaves no trace of its own;
 *   the "starting" marker set before the till opens, and cleared once
 *   Flutter has drawn its first screen, gives it away.
 */
object StartupGuard {
    private fun crashFile(c: Context) = File(c.filesDir, "last-crash.txt")
    private fun markerFile(c: Context) = File(c.filesDir, "starting")

    fun markStarting(c: Context) = runCatching { markerFile(c).writeText(System.currentTimeMillis().toString()) }

    fun started(c: Context) = runCatching { markerFile(c).delete() }

    fun recordCrash(c: Context, thread: Thread, error: Throwable) = runCatching {
        val trace = StringWriter().also { error.printStackTrace(PrintWriter(it)) }.toString()
        crashFile(c).writeText("Thread: ${thread.name}\n$trace")
    }

    /** What went wrong last time (and on which device), or null when the last start was fine. Read once. */
    fun takeReport(c: Context): String? {
        val crash = crashFile(c)
        val marker = markerFile(c)
        val what = when {
            crash.exists() -> runCatching { crash.readText() }.getOrDefault("(the error could not be read)")
            marker.exists() -> "It closed while starting, without a Java error: a problem in native code or graphics."
            else -> null
        }
        runCatching { crash.delete() }
        runCatching { marker.delete() }
        return what?.let { "${device(c)}\n\n$it" }
    }

    fun device(c: Context): String {
        val version = runCatching { c.packageManager.getPackageInfo(c.packageName, 0).versionName }.getOrNull() ?: "?"
        return "Device: ${Build.MANUFACTURER} ${Build.MODEL}\nAndroid ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})\nCore POS $version"
    }
}

/** Installs the crash catcher before anything else in the app runs. */
class CoreApp : Application() {
    override fun onCreate() {
        super.onCreate()
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            StartupGuard.recordCrash(this, thread, error)
            previous?.uncaughtException(thread, error)
        }
    }
}
