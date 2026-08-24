package com.frontend

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Application
import android.os.Build
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {
  private val notificationChannelId = "upanaya-notifications"

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          add(LocalNotificationPackage())
          add(SessionStoragePackage())
          add(AttendanceSelfiePackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
    loadReactNative(this)
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

    val manager = getSystemService(NotificationManager::class.java) ?: return
    val channel = NotificationChannel(
      notificationChannelId,
      "Rigweda Notifications",
      NotificationManager.IMPORTANCE_HIGH
    ).apply {
      description = "General notifications from Rigweda"
      enableVibration(true)
      setShowBadge(true)
    }

    manager.createNotificationChannel(channel)
  }
}

