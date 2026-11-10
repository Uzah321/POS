package com.corepos.core_pos

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * What the app icon opens. Normally it hands straight over to the till
 * (MainActivity, Flutter). If the app closed unexpectedly last time, it first
 * shows why — a plain Android screen, so it works even when Flutter can't.
 */
class LaunchActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val report = StartupGuard.takeReport(this)
        if (report == null) {
            openTill()
            return
        }

        val pad = (16 * resources.displayMetrics.density).toInt()
        val title = TextView(this).apply {
            text = "Core POS closed unexpectedly last time"
            textSize = 20f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(Color.rgb(15, 23, 42))
            setPadding(pad, pad, pad, pad / 2)
        }
        val hint = TextView(this).apply {
            text = "Take a photo of this screen and send it to support, then tap Open Core POS."
            textSize = 15f
            setTextColor(Color.rgb(100, 116, 139))
            setPadding(pad, 0, pad, pad / 2)
        }
        val details = TextView(this).apply {
            text = report
            textSize = 12f
            typeface = Typeface.MONOSPACE
            setTextIsSelectable(true)
            setTextColor(Color.rgb(15, 23, 42))
            setPadding(pad, pad / 2, pad, pad)
        }
        val open = Button(this).apply {
            text = "Open Core POS"
            setOnClickListener { openTill() }
        }
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
            addView(title)
            addView(hint)
            addView(ScrollView(this@LaunchActivity).apply { addView(details) }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
            addView(open, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { setMargins(pad, 0, pad, pad) })
        })
    }

    private fun openTill() {
        StartupGuard.markStarting(this)
        startActivity(Intent(this, MainActivity::class.java))
        finish()
        overridePendingTransition(0, 0)
    }
}
