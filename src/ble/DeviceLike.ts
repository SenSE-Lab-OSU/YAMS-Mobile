import { BleError, Characteristic, Subscription } from 'react-native-ble-plx';

/**
 * The slice of react-native-ble-plx's `Device` that BleController actually uses.
 *
 * This exists so a simulated wristband can stand in for real hardware without
 * BleController branching on device type: `SimulatedDevice` implements this
 * interface, and ble-plx's `Device` satisfies it structurally, so both flow
 * through exactly the same connect / write / notify code. That is the point --
 * a demo that bypassed the real code path would demonstrate nothing.
 *
 * Keep it minimal. Every member added here is one more thing the simulator has
 * to fake convincingly, and one more chance for the two to diverge.
 */
export interface DeviceLike {
  readonly id: string;
  readonly name: string | null;
  readonly rssi: number | null;

  connect(): Promise<DeviceLike>;
  discoverAllServicesAndCharacteristics(): Promise<unknown>;
  isConnected(): Promise<boolean>;
  cancelConnection(): Promise<unknown>;

  writeCharacteristicWithResponseForService(
    serviceUUID: string,
    characteristicUUID: string,
    valueBase64: string,
  ): Promise<unknown>;

  readCharacteristicForService(
    serviceUUID: string,
    characteristicUUID: string,
  ): Promise<Characteristic>;

  monitorCharacteristicForService(
    serviceUUID: string,
    characteristicUUID: string,
    listener: (error: BleError | null, characteristic: Characteristic | null) => void,
  ): Subscription;
}
