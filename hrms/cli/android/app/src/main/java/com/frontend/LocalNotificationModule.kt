package com.frontend

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import kotlin.random.Random

class LocalNotificationModule(
  reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "LocalNotification"

  @ReactMethod
  fun display(title: String?, body: String?, promise: Promise) {
    try {
      val context = reactApplicationContext
      val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
        flags =
          Intent.FLAG_ACTIVITY_NEW_TASK or
            Intent.FLAG_ACTIVITY_SINGLE_TOP or
            Intent.FLAG_ACTIVITY_CLEAR_TOP
      }

      val pendingIntent =
        if (launchIntent != null) {
          PendingIntent.getActivity(
            context,
            Random.nextInt(),
            launchIntent,
            pendingIntentFlags()
          )
        } else {
          null
        }

      val resolvedBody =
        body?.trim().takeUnless { it.isNullOrEmpty() } ?: "You have a new notification."

      val notification =
        NotificationCompat.Builder(context, "upanaya-notifications")
          .setSmallIcon(context.applicationInfo.icon)
          .setContentTitle(title?.trim().takeUnless { it.isNullOrEmpty() } ?: "Upanaya")
          .setContentText(resolvedBody)
          .setStyle(NotificationCompat.BigTextStyle().bigText(resolvedBody))
          .setPriority(NotificationCompat.PRIORITY_HIGH)
          .setAutoCancel(true)
          .setDefaults(NotificationCompat.DEFAULT_ALL)
          .setContentIntent(pendingIntent)
          .build()

      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || notificationsEnabled(context)) {
        NotificationManagerCompat.from(context).notify(Random.nextInt(), notification)
      }

      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("LOCAL_NOTIFICATION_ERROR", error)
    }
  }

  private fun pendingIntentFlags(): Int {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    } else {
      PendingIntent.FLAG_UPDATE_CURRENT
    }
  }

  private fun notificationsEnabled(context: Context): Boolean {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
    return manager?.areNotificationsEnabled() != false
  }
}
