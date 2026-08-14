import { BleError, Characteristic, Subscription } from 'react-native-ble-plx';

import { bytesToBase64 } from './binary';
import { DeviceLike } from './DeviceLike';
import * as Protocol from './protocol';
import { encodeEnmoPayload } from './samples';

/**
 * A stand-in wristband, used to demonstrate the app without hardware.
 *
 * It implements DeviceLike and emits real base64-encoded notify payloads, so
 * every layer downstream -- binary.ts, samples.ts, BleController, SessionLogger --
 * runs exactly as it does with a real MotionSenSE device. Nothing is special-cased
 * for it beyond being surfaced in scan results and skipping the manager-level
 * disconnect watcher, which it has no connection to participate in.
 *
 * Sessions that involve this device are marked as simulated by the caller (see
 * DEMO_SESSION_PREFIX in SessionLogger); nothing here should ever produce a file
 * that is indistinguishable from a real recording.
 */

export const SIMULATED_DEVICE_ID = 'simulated-msense-0001';
export const SIMULATED_DEVICE_NAME = 'MSense-SIM (simulated)';

/** Matches the firmware: 1024 samples at 512 Hz is one notification every 2 s. */
const COUNTER_STEP = 1024;
const NOTIFY_INTERVAL_MS = 2000;
const BATTERY_INTERVAL_MS = 30_000;

/**
 * ENMO as a pure function of the counter -- deterministic on purpose, so a demo
 * capture reproduces exactly and a reviewer watching twice sees the same trace.
 *
 * Shape: a slow baseline drift with a burst of activity every ~60 s, landing in
 * the 0 - 0.25 g range that real wrist-worn ENMO occupies.
 */
export function simulatedEnmo(counter: number): number {
  const tick = counter / COUNTER_STEP;
  const drift = 0.05 * (1 + Math.sin(tick / 9));
  const burst = tick % 30 < 6 ? 0.12 * Math.abs(Math.sin(tick * 1.7)) : 0;
  const jitter = 0.004 * Math.sin(tick * 7.3);
  return Math.max(0, drift + burst + jitter);
}

type MonitorListener = (error: BleError | null, characteristic: Characteristic | null) => void;

/**
 * The notify path reads only `.value`, but ble-plx's Characteristic is a class
 * with 20-odd members. This is the narrowest honest way to hand one over.
 */
function asCharacteristic(valueBase64: string): Characteristic {
  return { value: valueBase64 } as unknown as Characteristic;
}

export class SimulatedDevice implements DeviceLike {
  readonly id = SIMULATED_DEVICE_ID;
  readonly name = SIMULATED_DEVICE_NAME;
  readonly rssi = -52;

  private connected = false;
  private counter = 0;
  private batteryPercent = 100;
  private enmoTimer: ReturnType<typeof setInterval> | null = null;
  private batteryTimer: ReturnType<typeof setInterval> | null = null;

  /** Last value written to each characteristic, so reads back stay truthful. */
  private writes = new Map<string, string>();

  async connect(): Promise<DeviceLike> {
    this.connected = true;
    return this;
  }

  async discoverAllServicesAndCharacteristics(): Promise<unknown> {
    return this;
  }

  async isConnected(): Promise<boolean> {
    return this.connected;
  }

  async cancelConnection(): Promise<unknown> {
    this.connected = false;
    this.stopEnmo();
    this.stopBattery();
    return this;
  }

  /** Accepted and recorded, but there is no firmware to act on them. */
  async writeCharacteristicWithResponseForService(
    _serviceUUID: string,
    characteristicUUID: string,
    valueBase64: string,
  ): Promise<unknown> {
    this.writes.set(characteristicUUID, valueBase64);
    return null;
  }

  monitorCharacteristicForService(
    _serviceUUID: string,
    characteristicUUID: string,
    listener: MonitorListener,
  ): Subscription {
    if (characteristicUUID === Protocol.CHAR_ENMO) return this.startEnmo(listener);
    if (characteristicUUID === Protocol.CHAR_BATTERY_LEVEL) return this.startBattery(listener);
    return { remove: () => {} };
  }

  private startEnmo(listener: MonitorListener): Subscription {
    this.stopEnmo();
    this.enmoTimer = setInterval(() => {
      this.counter += COUNTER_STEP;
      listener(
        null,
        asCharacteristic(bytesToBase64(encodeEnmoPayload(simulatedEnmo(this.counter), this.counter))),
      );
    }, NOTIFY_INTERVAL_MS);

    return { remove: () => this.stopEnmo() };
  }

  private startBattery(listener: MonitorListener): Subscription {
    this.stopBattery();
    const emit = () =>
      listener(null, asCharacteristic(bytesToBase64(Uint8Array.of(this.batteryPercent))));

    emit();
    this.batteryTimer = setInterval(() => {
      this.batteryPercent = Math.max(1, this.batteryPercent - 1);
      emit();
    }, BATTERY_INTERVAL_MS);

    return { remove: () => this.stopBattery() };
  }

  private stopEnmo(): void {
    if (this.enmoTimer) clearInterval(this.enmoTimer);
    this.enmoTimer = null;
  }

  private stopBattery(): void {
    if (this.batteryTimer) clearInterval(this.batteryTimer);
    this.batteryTimer = null;
  }
}
