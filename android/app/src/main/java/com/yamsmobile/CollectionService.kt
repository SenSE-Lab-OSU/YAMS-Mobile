package com.yamsmobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Keeps the app's process alive while a collection session is running.
 *
 * Android stops delivering BLE notifications to a backgrounded app once it is
 * suspended, which happens within seconds of the screen turning off. A foreground
 * service with the connectedDevice type is the supported way to keep receiving
 * them, and the visible notification is the price the platform charges for it.
 *
 * This only keeps the process alive. Everything about the session -- the BLE
 * subscriptions, the clock origin, the file writes -- still lives in JS, so the
 * service is deliberately dumb: it holds no session state and makes no decisions.
 */
class CollectionService : Service() {

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: DEFAULT_TITLE
    val message = intent?.getStringExtra(EXTRA_MESSAGE).orEmpty()

    createChannel()
    val notification = buildNotification(title, message)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }

    // Not sticky: if Android kills the process anyway, restarting a bare service
    // would only leave a notification claiming a session that is no longer
    // collecting. Losing the notification with the session is the honest outcome.
    return START_NOT_STICKY
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

    val channel = NotificationChannel(
      CHANNEL_ID,
      "Data collection",
      // LOW: ongoing and silent. This notification is a status indicator, not an
      // alert, and a session can run for hours.
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = "Shown while YAMS Mobile is collecting from MotionSenSE devices."
      setShowBadge(false)
    }

    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  private fun buildNotification(title: String, message: String): Notification {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val contentIntent = PendingIntent.getActivity(
      this,
      0,
      launchIntent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(message)
      .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
      .setContentIntent(contentIntent)
      .setOngoing(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()
  }

  companion object {
    const val EXTRA_TITLE = "title"
    const val EXTRA_MESSAGE = "message"

    private const val CHANNEL_ID = "yams_collection"
    private const val NOTIFICATION_ID = 1
    private const val DEFAULT_TITLE = "Collecting"
  }
}
