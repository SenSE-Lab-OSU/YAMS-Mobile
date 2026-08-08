import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Android foreground service that keeps the process alive for the duration of a
 * collection session. Without one, Android suspends the app shortly after the
 * screen turns off and BLE notifications stop arriving.
 *
 * iOS has no equivalent and needs none -- UIBackgroundModes: bluetooth-central
 * plus Core Bluetooth state restoration cover the same ground. Call this through
 * src/platform/backgroundSession.ts, which no-ops off Android.
 */
export interface Spec extends TurboModule {
  start(title: string, message: string): void;
  stop(): void;
}

export default TurboModuleRegistry.get<Spec>('NativeCollectionService');
