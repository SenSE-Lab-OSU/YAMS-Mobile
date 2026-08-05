import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, Device, Subscription } from 'react-native-ble-plx';

import { uint32LEToBase64, uint64LEToBase64, base64ToBytes, bytesToUint8 } from './binary';
import * as Protocol from './protocol';
import { decodeEnmoPayload, EnmoSample } from './samples';

export interface ConnectedDeviceState {
  device: Device;
  clockOriginUnixSec: number | null; // t0 written to CHAR_UNIX_TIME at collection start
  collecting: boolean;
  autoReconnect: boolean;
}

type EnmoListener = (deviceId: string, sample: EnmoSample) => void;
type BatteryListener = (deviceId: string, percent: number) => void;
type ConnectionListener = (deviceId: string, connected: boolean) => void;

const RECONNECT_INTERVAL_MS = 10_000;

export class BleController {
  private manager = new BleManager();
  private devices = new Map<string, ConnectedDeviceState>();
  private enmoSubs = new Map<string, Subscription>();
  private batterySubs = new Map<string, Subscription>();
  private reconnectTimers = new Map<string, ReturnType<typeof setInterval>>();

  private enmoListeners = new Set<EnmoListener>();
  private batteryListeners = new Set<BatteryListener>();
  private connectionListeners = new Set<ConnectionListener>();

  sampleRateHz = Protocol.DEFAULT_SAMPLE_RATE_HZ;

  async requestAndroidPermissions(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;

    if (Platform.Version >= 31) {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]);
      return (
        granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED &&
        granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED
      );
    }

    const permissions = [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
    if (Platform.Version < 29) {
      permissions.push(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE);
    }
    const granted = await PermissionsAndroid.requestMultiple(permissions);
    return Object.values(granted).every(result => result === PermissionsAndroid.RESULTS.GRANTED);
  }

  startScan(
    onDeviceFound: (device: Device) => void,
    nameFilter: string = Protocol.DEFAULT_DEVICE_NAME_FILTER,
  ): void {
    this.manager.startDeviceScan(null, { allowDuplicates: true }, (error, device) => {
      if (error) {
        console.warn('BLE scan error', error);
        return;
      }
      if (device && device.name && device.name.includes(nameFilter)) {
        onDeviceFound(device);
      }
    });
  }

  stopScan(): void {
    this.manager.stopDeviceScan();
  }

  async connect(device: Device): Promise<void> {
    const connected = await device.connect();
    await connected.discoverAllServicesAndCharacteristics();

    this.devices.set(device.id, {
      device: connected,
      clockOriginUnixSec: null,
      collecting: false,
      autoReconnect: true,
    });

    this.manager.onDeviceDisconnected(device.id, () => {
      this.connectionListeners.forEach(fn => fn(device.id, false));
      const state = this.devices.get(device.id);
      if (state?.autoReconnect) {
        this.scheduleReconnect(device.id);
      }
    });

    this.connectionListeners.forEach(fn => fn(device.id, true));
  }

  async disconnect(deviceId: string): Promise<void> {
    const state = this.devices.get(deviceId);
    if (!state) return;

    state.autoReconnect = false;
    this.clearReconnect(deviceId);
    this.enmoSubs.get(deviceId)?.remove();
    this.batterySubs.get(deviceId)?.remove();
    this.enmoSubs.delete(deviceId);
    this.batterySubs.delete(deviceId);

    try {
      await state.device.cancelConnection();
    } finally {
      this.devices.delete(deviceId);
    }
  }

  setAutoReconnect(deviceId: string, enabled: boolean): void {
    const state = this.devices.get(deviceId);
    if (state) state.autoReconnect = enabled;
    if (!enabled) this.clearReconnect(deviceId);
  }

  private scheduleReconnect(deviceId: string): void {
    if (this.reconnectTimers.has(deviceId)) return;
    const timer = setInterval(async () => {
      const state = this.devices.get(deviceId);
      if (!state) return;
      try {
        const isConnected = await state.device.isConnected();
        if (isConnected) {
          this.clearReconnect(deviceId);
          return;
        }
        await this.connect(state.device);
        this.clearReconnect(deviceId);
        if (state.collecting) {
          await this.registerNotifications(deviceId);
        }
      } catch {
        // still disconnected; try again on the next tick
      }
    }, RECONNECT_INTERVAL_MS);
    this.reconnectTimers.set(deviceId, timer);
  }

  private clearReconnect(deviceId: string): void {
    const timer = this.reconnectTimers.get(deviceId);
    if (timer) {
      clearInterval(timer);
      this.reconnectTimers.delete(deviceId);
    }
  }

  /** Writes the phone's current unix time to the device (CHAR_UNIX_TIME). */
  private async writeUnixTime(deviceId: string): Promise<number> {
    const state = this.requireState(deviceId);
    const t0 = Math.floor(Date.now() / 1000);
    await state.device.writeCharacteristicWithResponseForService(
      Protocol.SERVICE_CONTROL,
      Protocol.CHAR_UNIX_TIME,
      uint64LEToBase64(t0),
    );
    state.clockOriginUnixSec = t0;
    return t0;
  }

  private async writeParticipantEncoding(deviceId: string, encoding: number): Promise<void> {
    const state = this.requireState(deviceId);
    await state.device.writeCharacteristicWithResponseForService(
      Protocol.SERVICE_CONTROL,
      Protocol.CHAR_PARTICIPANT_ENC,
      uint32LEToBase64(encoding),
    );
  }

  private async writeCollectionControl(deviceId: string, start: boolean): Promise<void> {
    const state = this.requireState(deviceId);
    await state.device.writeCharacteristicWithResponseForService(
      Protocol.SERVICE_CONTROL,
      Protocol.CHAR_COLLECTION_CTL,
      uint32LEToBase64(start ? 1 : 0),
    );
  }

  /** Starts collection: sets device unix time + participant encoding, then starts, then subscribes. */
  async startCollection(deviceId: string, participantEncoding: number): Promise<void> {
    await this.writeUnixTime(deviceId);
    await this.writeParticipantEncoding(deviceId, participantEncoding);
    await this.writeCollectionControl(deviceId, true);
    await this.registerNotifications(deviceId);
    this.requireState(deviceId).collecting = true;
  }

  async stopCollection(deviceId: string): Promise<void> {
    await this.writeCollectionControl(deviceId, false);
    this.requireState(deviceId).collecting = false;
  }

  private async registerNotifications(deviceId: string): Promise<void> {
    const state = this.requireState(deviceId);

    this.enmoSubs.get(deviceId)?.remove();
    const enmoSub = state.device.monitorCharacteristicForService(
      Protocol.SERVICE_ENMO,
      Protocol.CHAR_ENMO,
      (error, characteristic) => {
        if (error || !characteristic?.value) return;
        const hostTimeMs = Date.now();
        const bytes = base64ToBytes(characteristic.value);
        const { enmo, counter } = decodeEnmoPayload(bytes);
        const deviceTime = this.computeDeviceTime(deviceId, counter);
        this.enmoListeners.forEach(fn =>
          fn(deviceId, { enmo, counter, hostTimeMs, deviceTime }),
        );
      },
    );
    this.enmoSubs.set(deviceId, enmoSub);

    this.batterySubs.get(deviceId)?.remove();
    const batterySub = state.device.monitorCharacteristicForService(
      Protocol.SERVICE_BATTERY,
      Protocol.CHAR_BATTERY_LEVEL,
      (error, characteristic) => {
        if (error || !characteristic?.value) return;
        const percent = bytesToUint8(base64ToBytes(characteristic.value));
        this.batteryListeners.forEach(fn => fn(deviceId, percent));
      },
    );
    this.batterySubs.set(deviceId, batterySub);
  }

  /** Reconstructs device unix time from the hardware counter: t0 + counter / fs. */
  private computeDeviceTime(deviceId: string, counter: number): number {
    const t0 = this.devices.get(deviceId)?.clockOriginUnixSec;
    if (t0 == null) return Date.now() / 1000;
    return t0 + counter / this.sampleRateHz;
  }

  onEnmoSample(listener: EnmoListener): () => void {
    this.enmoListeners.add(listener);
    return () => this.enmoListeners.delete(listener);
  }

  onBatteryUpdate(listener: BatteryListener): () => void {
    this.batteryListeners.add(listener);
    return () => this.batteryListeners.delete(listener);
  }

  onConnectionChange(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  private requireState(deviceId: string): ConnectedDeviceState {
    const state = this.devices.get(deviceId);
    if (!state) throw new Error(`Device ${deviceId} is not connected`);
    return state;
  }

  destroy(): void {
    this.reconnectTimers.forEach(timer => clearInterval(timer));
    this.reconnectTimers.clear();
    this.manager.destroy();
  }
}
