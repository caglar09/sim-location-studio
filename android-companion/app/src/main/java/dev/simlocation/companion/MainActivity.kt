package dev.simlocation.companion

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val padding = (24 * resources.displayMetrics.density).toInt()
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(padding, padding, padding, padding)
        }

        layout.addView(TextView(this).apply {
            text = "Sim Location Companion"
            textSize = 24f
        })

        layout.addView(TextView(this).apply {
            text = """
                This companion lets Sim Location Studio inject mock GPS coordinates into a physical Android device.

                1. Enable Developer options.
                2. Open “Select mock location app”.
                3. Choose “Sim Location Companion”.
                4. Connect the device with USB debugging enabled.
                5. Refresh devices in Sim Location Studio.
            """.trimIndent()
            textSize = 16f
            setPadding(0, padding, 0, padding)
        })

        layout.addView(Button(this).apply {
            text = "Open Developer Options"
            setOnClickListener {
                startActivity(Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS))
            }
        })

        setContentView(layout)
    }
}
