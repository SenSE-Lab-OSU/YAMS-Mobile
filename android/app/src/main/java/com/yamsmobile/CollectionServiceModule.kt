package com.yamsmobile

import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.ReactApplicationContext
import com.yamsmobile.specs.NativeCollectionServiceSpec

/** JS entry point for CollectionService. See specs/NativeCollectionService.ts. */
class CollectionServiceModule(reactContext: ReactApplicationContext) :
  NativeCollectionServiceSpec(reactContext) {

  override fun getName(): String = NAME

  override fun start(title: String, message: String) {
    val context = reactApplicationContext
    val intent = Intent(context, CollectionService::class.java).apply {
      putExtra(CollectionService.EXTRA_TITLE, title)
      putExtra(CollectionService.EXTRA_MESSAGE, message)
    }

    // Android 12+ forbids starting a foreground service from the background, but
    // this is always reached from a Start button press, so the app is foreground.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      context.startForegroundService(intent)
    } else {
      context.startService(intent)
    }
  }

  override fun stop() {
    val context = reactApplicationContext
    context.stopService(Intent(context, CollectionService::class.java))
  }

  companion object {
    const val NAME = "NativeCollectionService"
  }
}
