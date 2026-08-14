/**
 * @format
 */

jest.mock('react-native-ble-plx', () => {
  const state: { scanCallback: ((error: unknown, device: unknown) => void) | null } = {
    scanCallback: null,
  };

  return {
    __state: state,
    BleManager: jest.fn().mockImplementation(() => ({
      startDeviceScan: jest.fn((_uuids, _options, callback) => {
        state.scanCallback = callback;
      }),
      stopDeviceScan: jest.fn(),
      onDeviceDisconnected: jest.fn(() => ({ remove: jest.fn() })),
      destroy: jest.fn(),
    })),
  };
});

import { BleController } from '../src/ble/BleController';
import { DeviceLike } from '../src/ble/DeviceLike';
import * as Protocol from '../src/ble/protocol';
import { EnmoSample } from '../src/ble/samples';
import {
  SIMULATED_DEVICE_ID,
  SimulatedDevice,
  simulatedEnmo,
} from '../src/ble/SimulatedDevice';
import { BlePolicy } from '../src/platform/blePolicy';

const bleMock = jest.requireMock('react-native-ble-plx') as {
  __state: { scanCallback: ((error: unknown, device: unknown) => void) | null };
};

const noopPolicy: BlePolicy = {
  managerOptions: () => ({}),
  requestPermissions: async () => true,
  beginReconnect: () => {},
  cancelReconnect: () => {},
  cancelAllReconnects: () => {},
};

describe('simulatedEnmo', () => {
  it('is deterministic, so a demo capture reproduces exactly', () => {
    expect(simulatedEnmo(1024)).toBe(simulatedEnmo(1024));
    expect(simulatedEnmo(2048)).not.toBe(simulatedEnmo(1024));
  });

  it('stays in the range real wrist-worn ENMO occupies', () => {
    for (let counter = 0; counter <= 1024 * 200; counter += 1024) {
      const enmo = simulatedEnmo(counter);
      expect(enmo).toBeGreaterThanOrEqual(0);
      expect(enmo).toBeLessThan(0.3);
    }
  });
});

describe('SimulatedDevice', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('emits decodable payloads on the real ENMO characteristic', () => {
    const device = new SimulatedDevice();
    const received: string[] = [];

    device.monitorCharacteristicForService(
      Protocol.SERVICE_ENMO,
      Protocol.CHAR_ENMO,
      (_error, characteristic) => {
        if (characteristic?.value) received.push(characteristic.value);
      },
    );

    jest.advanceTimersByTime(6000);
    expect(received).toHaveLength(3);
    // 8-byte payload (float32 + uint32) base64-encodes to 12 characters.
    received.forEach(value => expect(value).toHaveLength(12));
  });

  it('stops emitting once the subscription is removed', () => {
    const device = new SimulatedDevice();
    let count = 0;
    const sub = device.monitorCharacteristicForService(
      Protocol.SERVICE_ENMO,
      Protocol.CHAR_ENMO,
      () => {
        count += 1;
      },
    );

    jest.advanceTimersByTime(4000);
    sub.remove();
    jest.advanceTimersByTime(10_000);

    expect(count).toBe(2);
  });

  it('reports battery immediately so the UI is not blank while waiting', () => {
    const device = new SimulatedDevice();
    const values: string[] = [];

    device.monitorCharacteristicForService(
      Protocol.SERVICE_BATTERY,
      Protocol.CHAR_BATTERY_LEVEL,
      (_error, characteristic) => {
        if (characteristic?.value) values.push(characteristic.value);
      },
    );

    expect(values).toHaveLength(1);
  });
});

describe('BleController demo mode', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    bleMock.__state.scanCallback = null;
  });
  afterEach(() => jest.useRealTimers());

  it('surfaces no simulated device unless demo mode is on', () => {
    const controller = new BleController(noopPolicy);
    const found: DeviceLike[] = [];

    controller.startScan(device => found.push(device));

    expect(found).toHaveLength(0);
    controller.destroy();
  });

  it('surfaces the simulated device as an ordinary scan result', () => {
    const controller = new BleController(noopPolicy);
    const found: DeviceLike[] = [];

    controller.enableSimulatedDevice(true);
    controller.startScan(device => found.push(device));

    expect(found.map(device => device.id)).toEqual([SIMULATED_DEVICE_ID]);
    expect(controller.isSimulated(SIMULATED_DEVICE_ID)).toBe(true);
    expect(controller.isSimulated('real-device')).toBe(false);
    controller.destroy();
  });

  it('drives the real collection path end to end, decoding into ENMO samples', async () => {
    const controller = new BleController(noopPolicy);
    const samples: EnmoSample[] = [];
    controller.onEnmoSample((_id, sample) => samples.push(sample));

    controller.enableSimulatedDevice(true);
    let simulated: DeviceLike | null = null;
    controller.startScan(device => {
      simulated = device;
    });

    await controller.connect(simulated!);
    await controller.startCollection(SIMULATED_DEVICE_ID, 100_042);

    jest.advanceTimersByTime(6000);

    expect(samples).toHaveLength(3);
    // The counter must step exactly as the firmware does, or the demo would
    // produce files that look nothing like a real recording.
    expect(samples.map(sample => sample.counter)).toEqual([1024, 2048, 3072]);
    samples.forEach(sample => {
      expect(sample.enmo).toBeGreaterThanOrEqual(0);
      expect(sample.unixTime).toBeGreaterThan(0);
    });

    // t0 is recorded even though it never reaches firmware.
    expect(controller.getClockOrigin(SIMULATED_DEVICE_ID)).not.toBeNull();

    controller.destroy();
  });

  it('leaves the real scan path untouched when demo mode is on', () => {
    const controller = new BleController(noopPolicy);
    const found: DeviceLike[] = [];

    controller.enableSimulatedDevice(true);
    controller.startScan(device => found.push(device));

    bleMock.__state.scanCallback?.(null, { id: 'real', name: 'MSense4', rssi: -60 });
    bleMock.__state.scanCallback?.(null, { id: 'other', name: 'Fitbit', rssi: -60 });

    expect(found.map(device => device.id)).toEqual([SIMULATED_DEVICE_ID, 'real']);
    controller.destroy();
  });

  it('matches advertised names regardless of case, and skips nameless devices', () => {
    const controller = new BleController(noopPolicy);
    const found: DeviceLike[] = [];

    controller.startScan(device => found.push(device));

    bleMock.__state.scanCallback?.(null, { id: 'upper', name: 'MSENSE-02', rssi: -60 });
    bleMock.__state.scanCallback?.(null, { id: 'lower', name: 'msense4', rssi: -60 });
    bleMock.__state.scanCallback?.(null, { id: 'mixed', name: 'LabMSense', rssi: -60 });
    bleMock.__state.scanCallback?.(null, { id: 'nameless', name: null, rssi: -60 });
    bleMock.__state.scanCallback?.(null, { id: 'other', name: 'Sense4', rssi: -60 });

    expect(found.map(device => device.id)).toEqual(['upper', 'lower', 'mixed']);
    controller.destroy();
  });
});
