import { PermissionsAndroid, Platform } from 'react-native';

import NativeCollectionService from '../../specs/NativeCollectionService';

export interface BackgroundSessionInfo {
  subjectId: string;
  sessionId: string;
  deviceCount: number;
}

/**
 * Keeps collection running while the app is not on screen.
 *
 * The two platforms need opposite things and neither is expressible as the other,
 * so this is a capability rather than part of BlePolicy:
 *
 * - Android suspends a backgrounded app within seconds of the screen turning off,
 *   so a foreground service (and its notification) has to hold the process open.
 * - iOS never keeps an app running. It suspends and then wakes it on BLE events,
 *   which UIBackgroundModes: bluetooth-central and Core Bluetooth state
 *   restoration already arrange. There is nothing to start or stop.
 */
export const BackgroundSession = {
  /**
   * Asks for POST_NOTIFICATIONS (API 33+) so the service's notification is
   * visible in the drawer.
   *
   * Returns whether it was granted, but nothing should treat false as fatal: the
   * foreground service runs regardless, and a denial only means the notification
   * is confined to the system Task Manager. It is worth asking anyway -- that
   * notification is how a researcher confirms a session is still recording.
   */
  async requestPermission(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    if (Number(Platform.Version) < 33) return true;

    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  },

  start(info: BackgroundSessionInfo): void {
    if (Platform.OS !== 'android') return;

    if (!NativeCollectionService) {
      // Failing silently here would look like a working session that quietly stops
      // recording as soon as the screen turns off, which is the worst outcome.
      console.warn(
        'NativeCollectionService is not registered. Collection will stop when the app is backgrounded.',
      );
      return;
    }

    const devices = info.deviceCount === 1 ? '1 device' : `${info.deviceCount} devices`;
    NativeCollectionService.start(
      'Collecting data',
      `${info.subjectId} / ${info.sessionId} — ${devices}`,
    );
  },

  stop(): void {
    if (Platform.OS !== 'android') return;
    NativeCollectionService?.stop();
  },
};
