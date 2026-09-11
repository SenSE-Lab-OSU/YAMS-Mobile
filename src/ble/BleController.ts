import { BleManager, Device, Subscription } from 'react-native-ble-plx';

import { BlePolicy, selectBlePolicy } from '../platform/blePolicy';
import { DeviceLike } from './DeviceLike';
import { SIMULATED_DEVICE_ID, SimulatedDevice } from './SimulatedDevice';
import {
  uint32LEToBase64,
  uint64LEToBase64,
  uint8ToBase64,
  base64ToBytes,
  bytesToUint8,
  bytesToUintLE,
} from './binary';
import * as Protocol from './protocol';
import { decodeEnmoPayload, EnmoSample } from './samples';

export interface ConnectedDeviceState {
  device: DeviceLike;
  // t0 written to CHAR_UNIX_TIME at collection start. Bookkeeping only: it records
  // what the hardware was seeded with (and is persisted so a restored session can
  // report it), but it does not feed the logged timestamp -- that is phone unix
  // time at arrival. See registerNotifications.
  clockOriginUnixSec: number | null;
  collecting: boolean;
  // The encoding this device is currently collecting under, if known -- either
  // written by this app's own startCollection(), or read back from
  // CHAR_PARTICIPANT_ENC on connect() for a device this process never started.
  // Cleared on stopCollection() and on a connect() that finds the device idle.
  participantEncoding: number | null;
  autoReconnect: boolean;
}

type EnmoListener = (deviceId: string, sample: EnmoSample) => void;
type BatteryListener = (deviceId: string, percent: number) => void;
type ConnectionListener = (deviceId: string, connected: boolean) => void;
type RestoreListener = (devices: Device[]) => void;

/**
 * Outcome of refreshSubscriptions for one device:
 * - 'resubscribed': it was connected and mid-collection, so notifications were
 *   torn down and re-added.
 * - 'not-collecting': connected, but no session is running for it -- nothing to do.
 * - 'not-connected': not currently connected -- left to the reconnect policy.
 */
export type RefreshResult = 'resubscribed' | 'not-collecting' | 'not-connected';

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

  // Non-null while demo mode is on. Deliberately not persisted anywhere: a
  // researcher must never start a real study with a simulated device silently
  // enabled from a previous launch.
  private simulated: SimulatedDevice | null = null;

  // Informational: the rate the firmware samples at. Not used to build timestamps.
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
        participantEncoding: null,
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

  /**
   * Adds a simulated wristband to scan results, so the app can be demonstrated
   * without hardware. Everything after discovery -- connecting, writing control
   * characteristics, decoding notifications, logging -- runs the real code.
   */
  enableSimulatedDevice(enabled: boolean): void {
    this.simulated = enabled ? (this.simulated ?? new SimulatedDevice()) : null;
  }

  /** Whether a device id belongs to the simulator rather than real hardware. */
  isSimulated(deviceId: string): boolean {
    return deviceId === SIMULATED_DEVICE_ID;
  }

  startScan(
    onDeviceFound: (device: DeviceLike) => void,
    nameFilter: string = Protocol.DEFAULT_DEVICE_NAME_FILTER,
  ): void {
    // Case-insensitive so firmware that advertises "msense"/"MSENSE" still shows up;
    // the wristbands are not consistent about casing across firmware revisions.
    const needle = nameFilter.toLowerCase();

    // Surfaced as an ordinary scan result so it is connected to through the same
    // path as hardware, rather than appearing by some separate mechanism.
    if (this.simulated) onDeviceFound(this.simulated);

    this.manager.startDeviceScan(null, { allowDuplicates: true }, (error, device) => {
      if (error) {
        console.warn('BLE scan error', error);
        return;
      }
      if (device?.name?.toLowerCase().includes(needle)) {
        onDeviceFound(device);
      }
    });
  }

  stopScan(): void {
    this.manager.stopDeviceScan();
  }

  async connect(device: DeviceLike): Promise<void> {
    const connected = await device.connect();
    await connected.discoverAllServicesAndCharacteristics();

    // Carry forward whatever this device already had. connect() is also the
    // reconnect path -- automatic after a dropped connection, or manual after
    // an intentional disconnect -- and resetting here would drop the clock
    // origin mid-session, silently switching the third column from
    // reconstructed device time to phone time for every remaining sample.
    const previous = this.devices.get(device.id);

    // Ground truth from the device itself, not just this process's memory --
    // a fresh install, a killed-and-relaunched Android process (no
    // restoration path exists there, unlike iOS), or a different phone can
    // all have started a collection this process has never heard of. An OR
    // with local memory: never resubscribes less than before, and now also
    // covers what local memory alone misses.
    const hardwareCollecting = await this.readCollectionStatus(connected);
    const wasCollecting = hardwareCollecting || (previous?.collecting ?? false);

    this.devices.set(device.id, {
      device: connected,
      clockOriginUnixSec: previous?.clockOriginUnixSec ?? null,
      collecting: wasCollecting,
      // Not carried forward when idle -- a genuinely stopped device should not
      // keep reporting the encoding of a session that is no longer running.
      participantEncoding: wasCollecting ? (previous?.participantEncoding ?? null) : null,
      // Always true on a fresh connect, even if this device was manually
      // disconnected (which sets it false): reconnecting is an explicit
      // signal that the device should be watched again.
      autoReconnect: true,
    });

    this.watchDisconnect(device.id);

    this.connectionListeners.forEach(fn => fn(device.id, true));

    // Best-effort: lets the UI show a battery level before recording starts,
    // when registerNotifications' battery subscription first fires.
    // Never rejects -- readBatteryOnce catches its own errors -- so this is
    // safe to leave unawaited.
    this.readBatteryOnce(device.id);

    // The device was collecting the last time it was connected -- whether
    // that connection ended on its own or was ended on purpose -- so resume
    // notifications rather than leaving it connected but silent.
    if (wasCollecting) {
      const state = this.devices.get(device.id);
      if (state) state.participantEncoding = await this.readParticipantEncoding(connected);
      await this.registerNotifications(device.id);
    }
  }

  /**
   * True if the device's own CHAR_COLLECTION_CTL reports it is currently
   * collecting. Takes the device directly rather than a deviceId: connect()
   * calls this before this.devices has an entry for a device it has never
   * seen before, so there is nothing yet to look up by id.
   */
  private async readCollectionStatus(device: DeviceLike): Promise<boolean> {
    try {
      const characteristic = await device.readCharacteristicForService(
        Protocol.SERVICE_CONTROL,
        Protocol.CHAR_COLLECTION_CTL,
      );
      if (!characteristic.value) {
        console.warn('CHAR_COLLECTION_CTL read returned no value for', device.id);
        return false;
      }
      // bytesToUintLE, not a fixed-width reader: this characteristic is a
      // uint8 on the wire, but real firmware read-backs have not reliably
      // matched that width, and a fixed-width DataView throws over a buffer
      // shorter than expected.
      return bytesToUintLE(base64ToBytes(characteristic.value)) !== 0;
    } catch (error) {
      // Logged rather than swallowed outright, unlike readBatteryOnce: this is a
      // brand new read path and connect() still falls back to local bookkeeping
      // either way, so surfacing the cause costs nothing.
      console.warn('CHAR_COLLECTION_CTL read failed for', device.id, error);
      return false;
    }
  }

  /** The participant encoding currently written to the device's CHAR_PARTICIPANT_ENC, if any. */
  private async readParticipantEncoding(device: DeviceLike): Promise<number | null> {
    try {
      const characteristic = await device.readCharacteristicForService(
        Protocol.SERVICE_CONTROL,
        Protocol.CHAR_PARTICIPANT_ENC,
      );
      if (!characteristic.value) {
        console.warn('CHAR_PARTICIPANT_ENC read returned no value for', device.id);
        return null;
      }
      return bytesToUintLE(base64ToBytes(characteristic.value));
    } catch (error) {
      console.warn('CHAR_PARTICIPANT_ENC read failed for', device.id, error);
      return null;
    }
  }

  private async readBatteryOnce(deviceId: string): Promise<void> {
    const state = this.devices.get(deviceId);
    if (!state) return;

    try {
      const characteristic = await state.device.readCharacteristicForService(
        Protocol.SERVICE_BATTERY,
        Protocol.CHAR_BATTERY_LEVEL,
      );
      if (!characteristic.value) return;
      const percent = bytesToUint8(base64ToBytes(characteristic.value));
      this.batteryListeners.forEach(fn => fn(deviceId, percent));
    } catch {
      // Device may not expose the battery service, or the read raced a
      // disconnect -- the notify subscription at collection start will
      // pick it up if the device is still around.
    }
  }

  private watchDisconnect(deviceId: string): void {
    // The simulator holds no manager-level connection to watch, and never drops.
    if (this.isSimulated(deviceId)) return;

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

    // Deliberately keep the map entry rather than deleting it. An intentional
    // disconnect does not end a session that is still collecting -- the
    // researcher may just be stepping out of range on purpose -- so
    // `collecting` and `clockOriginUnixSec` stay put for connect() to find
    // and resume from if this device reconnects later.
    await state.device.cancelConnection();
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

      // connect() itself re-subscribes if this device was mid-collection.
      await this.connect(state.device);
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
      uint8ToBase64(start ? 1 : 0),
    );
  }

  /** Starts collection: sets device unix time + participant encoding, then starts, then subscribes. */
  async startCollection(deviceId: string, participantEncoding: number): Promise<void> {
    await this.writeUnixTime(deviceId);
    await this.writeParticipantEncoding(deviceId, participantEncoding);
    await this.writeCollectionControl(deviceId, true);
    await this.registerNotifications(deviceId);
    const state = this.requireState(deviceId);
    state.collecting = true;
    // Known immediately, without waiting for a later connect() to read it back.
    state.participantEncoding = participantEncoding;
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

  /**
   * Forces a fresh notification subscription for one device, without a full
   * disconnect/reconnect. For a device the OS still reports connected but that has
   * gone quiet -- e.g. iOS throttled or paused delivery in the background -- a
   * dropped connection is never signaled, so nothing else in this class would
   * otherwise notice or recover.
   */
  async refreshSubscriptions(deviceId: string): Promise<RefreshResult> {
    const state = this.devices.get(deviceId);
    if (!state) return 'not-connected';

    let connected: boolean;
    try {
      connected = await state.device.isConnected();
    } catch {
      connected = false;
    }
    if (!connected) return 'not-connected';
    if (!state.collecting) return 'not-collecting';

    // registerNotifications() itself removes any prior sub before adding a new
    // one, but do it explicitly here too: relying on that would be fine for
    // correctness, but the intent -- force a fresh subscription rather than trust
    // the existing one -- reads better spelled out at the call site.
    this.enmoSubs.get(deviceId)?.remove();
    this.batterySubs.get(deviceId)?.remove();
    await this.registerNotifications(deviceId);
    return 'resubscribed';
  }

  /** refreshSubscriptions for every currently-tracked device. */
  async refreshAllSubscriptions(): Promise<Map<string, RefreshResult>> {
    const results = new Map<string, RefreshResult>();
    for (const deviceId of this.devices.keys()) {
      results.set(deviceId, await this.refreshSubscriptions(deviceId));
    }
    return results;
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

  /** The participant encoding this device is currently collecting under, or null. */
  getParticipantEncoding(deviceId: string): number | null {
    return this.devices.get(deviceId)?.participantEncoding ?? null;
  }

  async stopCollection(deviceId: string): Promise<void> {
    await this.writeCollectionControl(deviceId, false);
    const state = this.requireState(deviceId);
    state.collecting = false;
    // A stopped device should stop reporting an encoding as currently running.
    state.participantEncoding = null;
  }

  private async registerNotifications(deviceId: string): Promise<void> {
    const state = this.requireState(deviceId);

    this.enmoSubs.get(deviceId)?.remove();
    const enmoSub = state.device.monitorCharacteristicForService(
      Protocol.SERVICE_ENMO,
      Protocol.CHAR_ENMO,
      (error, characteristic) => {
        if (error || !characteristic?.value) return;
        // Third column is phone unix time at arrival, always. Do not reconstruct
        // it from the clock origin and the hardware counter -- the counter is
        // already column 2, and the desktop pipeline expects a wall-clock value
        // here. See the note on clockOriginUnixSec.
        const unixTime = Date.now() / 1000;
        const bytes = base64ToBytes(characteristic.value);
        const { enmo, counter } = decodeEnmoPayload(bytes);
        this.enmoListeners.forEach(fn => fn(deviceId, { enmo, counter, unixTime }));
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
    // Stops the simulator's notify timers, which are plain JS intervals and would
    // otherwise outlive the controller.
    this.simulated?.cancelConnection();
    this.manager.destroy();
  }
}
