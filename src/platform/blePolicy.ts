import { PermissionsAndroid, Platform } from 'react-native';
import { BleManagerOptions, Device } from 'react-native-ble-plx';

export const RECONNECT_INTERVAL_MS = 10_000;

// Stable across releases on purpose: iOS keys restored Core Bluetooth state by
// this string, so changing it orphans any session waiting to be restored.
const RESTORE_STATE_IDENTIFIER = 'org.senselab.yamsmobile.ble';

export interface ReconnectContext {
  /** One reconnect attempt. Resolves true once the device is connected again. */
  attempt(): Promise<boolean>;
  /** False once the caller has given up on the device, e.g. an explicit disconnect. */
  isActive(): boolean;
}

/**
 * The platform-dependent parts of BLE handling, kept in one place so
 * BleController itself reads as a single linear story.
 *
 * Both implementations live in this file rather than in blePolicy.ios.ts /
 * blePolicy.android.ts: TypeScript does not resolve platform extensions without a
 * fallback module, and side by side the differences are legible as differences,
 * which is the point.
 *
 * Never fork the wire protocol, ENMO decoding, participant encoding, or the
 * SessionLogger line format here. Those are defined by parity with the desktop
 * yams tooling and must not vary by platform.
 */
export interface BlePolicy {
  managerOptions(onRestore: (devices: Device[]) => void): BleManagerOptions;
  requestPermissions(): Promise<boolean>;
  beginReconnect(deviceId: string, ctx: ReconnectContext): void;
  cancelReconnect(deviceId: string): void;
  cancelAllReconnects(): void;
}

export const iosBlePolicy: BlePolicy = {
  managerOptions(onRestore) {
    return {
      restoreStateIdentifier: RESTORE_STATE_IDENTIFIER,
      restoreStateFunction: restored => {
        if (!restored || restored.connectedPeripherals.length === 0) return;
        onRestore(restored.connectedPeripherals);
      },
    };
  },

  async requestPermissions() {
    // Core Bluetooth prompts on first use via NSBluetoothAlwaysUsageDescription.
    // There is nothing to request up front.
    return true;
  },

  beginReconnect(_deviceId, ctx) {
    // One attempt, not a poll. A Core Bluetooth connect request never times out:
    // it stays pending until the peripheral reappears, and iOS wakes the app to
    // complete it. Polling would be worse than redundant here -- once a device
    // drops, notifications stop, iOS suspends the app within seconds, and timers
    // stop firing exactly when the reconnect is needed.
    if (!ctx.isActive()) return;
    ctx.attempt().catch(() => undefined);
  },

  cancelReconnect() {
    // Nothing scheduled to cancel. A pending connect is dropped by
    // cancelConnection(), which BleController.disconnect() already calls.
  },

  cancelAllReconnects() {},
};

const androidReconnectTimers = new Map<string, ReturnType<typeof setInterval>>();

export const androidBlePolicy: BlePolicy = {
  managerOptions() {
    // State restoration is an iOS mechanism; Android keeps the process alive by
    // other means and hands nothing back.
    return {};
  },

  async requestPermissions() {
    // Platform.Version is typed string | number across platforms; on Android it is
    // always the numeric API level.
    const apiLevel = Number(Platform.Version);

    if (apiLevel >= 31) {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]);
      return (
        granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] ===
          PermissionsAndroid.RESULTS.GRANTED &&
        granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] ===
          PermissionsAndroid.RESULTS.GRANTED
      );
    }

    const permissions = [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
    if (apiLevel < 29) {
      permissions.push(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE);
    }
    const granted = await PermissionsAndroid.requestMultiple(permissions);
    return Object.values(granted).every(result => result === PermissionsAndroid.RESULTS.GRANTED);
  },

  beginReconnect(deviceId, ctx) {
    if (androidReconnectTimers.has(deviceId)) return;

    // Android has no pending-connect equivalent, so this polls until it lands.
    const timer = setInterval(async () => {
      if (!ctx.isActive()) {
        androidBlePolicy.cancelReconnect(deviceId);
        return;
      }
      if (await ctx.attempt()) {
        androidBlePolicy.cancelReconnect(deviceId);
      }
    }, RECONNECT_INTERVAL_MS);

    androidReconnectTimers.set(deviceId, timer);
  },

  cancelReconnect(deviceId) {
    const timer = androidReconnectTimers.get(deviceId);
    if (timer) {
      clearInterval(timer);
      androidReconnectTimers.delete(deviceId);
    }
  },

  cancelAllReconnects() {
    androidReconnectTimers.forEach(timer => clearInterval(timer));
    androidReconnectTimers.clear();
  },
};

/** Resolved per call, not at import, so the choice follows Platform.OS in tests. */
export function selectBlePolicy(): BlePolicy {
  return Platform.OS === 'ios' ? iosBlePolicy : androidBlePolicy;
}
