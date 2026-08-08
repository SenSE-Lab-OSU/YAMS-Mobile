package com.yamsmobile

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/** Registered manually in MainApplication -- app-local modules are not autolinked. */
class CollectionServicePackage : BaseReactPackage() {

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == CollectionServiceModule.NAME) CollectionServiceModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
      CollectionServiceModule.NAME to
        ReactModuleInfo(
          CollectionServiceModule.NAME,
          CollectionServiceModule.NAME,
          false, // canOverrideExistingModule
          false, // needsEagerInit
          false, // isCxxModule
          true, // isTurboModule
        )
    )
  }
}
