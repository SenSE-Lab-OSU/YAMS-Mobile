import { BleManager, Device, Subscription } from 'react-native-ble-plx';

import { BlePolicy, selectBlePolicy } from '../platform/blePolicy';
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
type RestoreListener = (devices: Device[]) => void;

export class BleController {
  private manager: BleManager;
  private policy: BlePolicy;
  private devices = new Map<string, ConnectedDeviceState>();
  private enmoSubs = new Map<string, Subscription>();
  private batterySubs = new Map<string, Subscription>();

  private enmoListeners = new Set<EnmoListener>();
  private batteryListeners = new Set<BatteryListener>();
  private connectionListeners = new Set<ConnectionListener>();
  private restoreListeners = new Set<RestoreListener>();

  // restoreStateFunction fires while BleManager is still being constructed, which
  // is before any caller can have subscribed. Hold the result until one does.
  private pendingRestore: Device[] | null = null;

  sampleRateHz = Protocol.DEFAULT_SAMPLE_RATE_HZ;

  constructor(policy: BlePolicy = selectBlePolicy()) {
    this.policy = policy;
    // Assigned here rather than as a field initializer so every listener set above
    // exists before restoreStateFunction can fire during construction.
    this.manager = new BleManager(policy.managerOptions(devices => this.adoptRestored(devices)));
  }

  /**
   * Takes ownership of peripherals handed back by state restoration. They are
   * already connected at the OS level, but this process has never seen them, so
   * they need bookkeeping entries and disconnect watchers before anything else
   * can use them.
   */
  private adoptRestored(devices: Device[]): void {
    for (const device of devices) {
      if (this.devices.has(device.id)) continue;

      this.devices.set(device.id, {
        device,
        clockOriginUnixSec: null,
        collecting: false,
        autoReconnect: true,
      });
      this.watchDisconnect(device.id);
      this.connectionListeners.forEach(fn => fn(device.id, true));
    }

    if (this.restoreListeners.size === 0) {
      this.pendingRestore = devices;
      return;
    }
    this.restoreListeners.forEach(fn => fn(devices));
  }

  requestPermissions(): Promise<boolean> {
    return this.policy.requestPermissions();
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

    // Carry forward whatever this device already had. connect() is also the
    // reconnect path, and resetting here would drop the clock origin mid-session,
    // silently switching the third column from reconstructed device time to phone
    // time for every remaining sample.
    const previous = this.devices.get(device.id);
    this.devices.set(device.id, {
      device: connected,
      clockOriginUnixSec: previous?.clockOriginUnixSec ?? null,
      collecting: previous?.collecting ?? false,
      autoReconnect: previous?.autoReconnect ?? true,
    });

    this.watchDisconnect(device.id);

    this.connectionListeners.forEach(fn => fn(device.id, true));
  }

  private watchDisconnect(deviceId: string): void {
    this.manager.onDeviceDisconnected(deviceId, () => {
      this.connectionListeners.forEach(fn => fn(deviceId, false));
      if (this.devices.get(deviceId)?.autoReconnect) {
        this.policy.beginReconnect(deviceId, {
          attempt: () => this.attemptReconnect(deviceId),
          isActive: () => this.devices.get(deviceId)?.autoReconnect === true,
        });
      }
    });
  }

  async disconnect(deviceId: string): Promise<void> {
    const state = this.devices.get(deviceId);
    if (!state) return;

    state.autoReconnect = false;
    this.policy.cancelReconnect(deviceId);
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
    if (!enabled) this.policy.cancelReconnect(deviceId);
  }

  /** One reconnect attempt. Returns true once the device is connected again. */
  private async attemptReconnect(deviceId: string): Promise<boolean> {
    const state = this.devices.get(deviceId);
    if (!state) return true;

    try {
      if (await state.device.isConnected()) return true;

      await this.connect(state.device);
      // Read back from the map rather than the captured state: connect() replaces
      // the entry, and a mid-session reconnect must re-subscribe to resume.
      if (this.devices.get(deviceId)?.collecting) {
        await this.registerNotifications(deviceId);
      }
      return true;
    } catch {
      return false;
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

  /**
   * Re-subscribes to a device that was already collecting when this process was
   * terminated. Deliberately does not rewrite unix time, participant encoding, or
   * the collection control characteristic: the hardware is mid-session, and a
   * fresh t0 would not match the timestamps already in the session file.
   */
  async resumeCollection(deviceId: string): Promise<void> {
    const state = this.requireState(deviceId);
    // Service discovery does not survive the process, even though the connection does.
    await state.device.discoverAllServicesAndCharacteristics();
    await this.registerNotifications(deviceId);
    state.collecting = true;
  }

  /** The device clock origin (t0), or null if collection has not started for it. */
  getClockOrigin(deviceId: string): number | null {
    return this.devices.get(deviceId)?.clockOriginUnixSec ?? null;
  }

  /**
   * Seeds t0 from a persisted session without re-writing it to the hardware.
   * Used when a restored connection outlives the process that established it, so
   * timestamps continue to be reconstructed the same way the session started.
   */
  setClockOrigin(deviceId: string, clockOriginUnixSec: number): void {
    const state = this.devices.get(deviceId);
    if (state) state.clockOriginUnixSec = clockOriginUnixSec;
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
    // Intentional: with no clock origin the third column carries phone unix time
    // rather than a reconstructed device time. This is a deliberate part of the
    // data format -- do not remove it, drop the sample, or throw here.
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

  /**
   * Fires with the devices handed back by iOS state restoration. Delivers
   * immediately if restoration already happened during construction, so a
   * subscriber that registers a tick too late still sees it.
   */
  onRestoredDevices(listener: RestoreListener): () => void {
    this.restoreListeners.add(listener);

    if (this.pendingRestore) {
      const devices = this.pendingRestore;
      this.pendingRestore = null;
      listener(devices);
    }

    return () => this.restoreListeners.delete(listener);
  }

  private requireState(deviceId: string): ConnectedDeviceState {
    const state = this.devices.get(deviceId);
    if (!state) throw new Error(`Device ${deviceId} is not connected`);
    return state;
  }

  destroy(): void {
    this.policy.cancelAllReconnects();
    this.manager.destroy();
  }
}
