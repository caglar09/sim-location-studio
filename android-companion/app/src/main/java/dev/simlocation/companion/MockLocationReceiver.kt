package dev.simlocation.companion

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.location.Criteria
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.SystemClock

class MockLocationReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager

        when (intent.action) {
            ACTION_SET -> {
                val lat = intent.getFloatExtra("lat", Float.NaN).toDouble()
                val lng = intent.getFloatExtra("lng", Float.NaN).toDouble()
                if (!lat.isFinite() || !lng.isFinite()) return

                val providers = mutableListOf(
                    LocationManager.GPS_PROVIDER,
                    LocationManager.NETWORK_PROVIDER
                )
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    providers.add(LocationManager.FUSED_PROVIDER)
                }

                providers.distinct().forEach { provider ->
                    setProvider(manager, provider, lat, lng)
                }
            }

            ACTION_CLEAR -> {
                val providers = mutableListOf(
                    LocationManager.GPS_PROVIDER,
                    LocationManager.NETWORK_PROVIDER
                )
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    providers.add(LocationManager.FUSED_PROVIDER)
                }
                providers.distinct().forEach { provider ->
                    runCatching { manager.removeTestProvider(provider) }
                }
            }
        }
    }

    private fun setProvider(manager: LocationManager, provider: String, lat: Double, lng: Double) {
        runCatching { manager.removeTestProvider(provider) }

        runCatching {
            manager.addTestProvider(
                provider,
                false,
                false,
                false,
                false,
                true,
                true,
                true,
                Criteria.POWER_LOW,
                Criteria.ACCURACY_FINE
            )
        }.getOrElse { return }

        runCatching { manager.setTestProviderEnabled(provider, true) }

        val location = Location(provider).apply {
            latitude = lat
            longitude = lng
            accuracy = 3f
            altitude = 0.0
            speed = 0f
            bearing = 0f
            time = System.currentTimeMillis()
            elapsedRealtimeNanos = SystemClock.elapsedRealtimeNanos()
        }

        runCatching { manager.setTestProviderLocation(provider, location) }
    }

    companion object {
        const val ACTION_SET = "dev.simlocation.companion.SET_LOCATION"
        const val ACTION_CLEAR = "dev.simlocation.companion.CLEAR_LOCATION"
    }
}
