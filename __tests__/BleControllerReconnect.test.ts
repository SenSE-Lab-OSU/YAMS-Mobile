/**
 * @format
 */

jest.mock('react-native-ble-plx', () => {
  const state: {
    disconnectHandlers: Map<string, () => void>;
    instance: Record<string, jest.Mock> | null;
  } = { disconnectHandlers: new Map(), instance: null };

  return {
    __state: state,
    BleManager: jest.fn().mockImplementation(() => {
      state.instance = {
        startDeviceScan: jest.fn(),
        stopDeviceScan: jest.fn(),
        onDeviceDisconnected: jest.fn((id: string, callback: () => void) => {
          state.disconnectHandlers.set(id, callback);
          return { remove: jest.fn() };
        }),
        destroy: jest.fn(),
      };
      return state.instance;
    }),
  };
});

import type { Device } from 'react-native-ble-plx';

import { BleController } from '../src/ble/BleController';
import { BlePolicy, ReconnectContext } from '../src/platform/blePolicy';

const bleMock = jest.requireMock('react-native-ble-plx') as {
  __state: { disconnectHandlers: Map<string, () => void> };
};

interface FakeDevice {
  id: string;
  name: string;
  connect: jest.Mock;
  discoverAllServicesAndCharacteristics: jest.Mock;
  isConnected: jest.Mock;
  cancelConnection: jest.Mock;
  monitorCharacteristicForService: jest.Mock;
  writeCharacteristicWithResponseForService: jest.Mock;
  readCharacteristicForService: jest.Mock;
}

function fakeDevice(id: string, connected = false): Device & FakeDevice {
  // Annotated rather than inferred: the mocks resolve to the device itself, which
  // TypeScript cannot infer from an object literal referencing its own binding.
  const device: FakeDevice = {
    id,
    name: `MSense-${id}`,
    connect: jest.fn(async () => device),
    discoverAllServicesAndCharacteristics: jest.fn(async () => device),
    isConnected: jest.fn(async () => connected),
    cancelConnection: jest.fn(async () => device),
    monitorCharacteristicForService: jest.fn(() => ({ remove: jest.fn() })),
    writeCharacteristicWithResponseForService: jest.fn(async () => device),
    readCharacteristicForService: jest.fn(async () => ({ value: null })),
  };
  return device as unknown as Device & FakeDevice;
}

function recordingPolicy() {
  const contexts = new Map<string, ReconnectContext>();
  const policy: BlePolicy & {
    beginReconnect: jest.Mock;
    cancelReconnect: jest.Mock;
    cancelAllReconnects: jest.Mock;
  } = {
    managerOptions: () => ({}),
    requestPermissions: async () => true,
    beginReconnect: jest.fn((deviceId: string, ctx: ReconnectContext) => {
      contexts.set(deviceId, ctx);
    }),
    cancelReconnect: jest.fn(),
    cancelAllReconnects: jest.fn(),
  };
  return { policy, contexts };
}

beforeEach(() => {
  bleMock.__state.disconnectHandlers.clear();
});

describe('BleController reconnect', () => {
  it('keeps the clock origin across a reconnect', async () => {
    const { policy } = recordingPolicy();
    const controller = new BleController(policy);
    const device = fakeDevice('aa');

    await controller.connect(device);
    controller.setClockOrigin('aa', 1_780_000_000);

    // connect() is also the reconnect path.
    await controller.connect(device);

    expect(controller.getClockOrigin('aa')).toBe(1_780_000_000);
  });

  it('hands a disconnected device to the policy', async () => {
    const { policy } = recordingPolicy();
    const controller = new BleController(policy);
    await controller.connect(fakeDevice('aa'));

    bleMock.__state.disconnectHandlers.get('aa')?.();

    expect(policy.beginReconnect).toHaveBeenCalledWith('aa', expect.anything());
  });

  it('reports a device as inactive once explicitly disconnected', async () => {
    const { policy, contexts } = recordingPolicy();
    const controller = new BleController(policy);
    await controller.connect(fakeDevice('aa'));

    bleMock.__state.disconnectHandlers.get('aa')?.();
    const ctx = contexts.get('aa')!;
    expect(ctx.isActive()).toBe(true);

    await controller.disconnect('aa');
    expect(ctx.isActive()).toBe(false);
    expect(policy.cancelReconnect).toHaveBeenCalledWith('aa');
  });

  it('re-subscribes after reconnecting mid-collection', async () => {
    const { policy, contexts } = recordingPolicy();
    const controller = new BleController(policy);
    const device = fakeDevice('aa');

    await controller.connect(device);
    await controller.startCollection('aa', 100000);

    // One ENMO subscription and one battery subscription.
    expect(device.monitorCharacteristicForService).toHaveBeenCalledTimes(2);
    const origin = controller.getClockOrigin('aa');
    expect(origin).not.toBeNull();

    bleMock.__state.disconnectHandlers.get('aa')?.();
    await expect(contexts.get('aa')!.attempt()).resolves.toBe(true);

    // Resubscribed rather than sitting connected but silent, and still anchored to
    // the origin the session started with.
    expect(device.monitorCharacteristicForService).toHaveBeenCalledTimes(4);
    expect(controller.getClockOrigin('aa')).toBe(origin);
  });

  it('reports a failed attempt so the policy can retry', async () => {
    const { policy, contexts } = recordingPolicy();
    const controller = new BleController(policy);
    const device = fakeDevice('aa');
    await controller.connect(device);

    bleMock.__state.disconnectHandlers.get('aa')?.();
    device.connect.mockRejectedValueOnce(new Error('out of range'));

    await expect(contexts.get('aa')!.attempt()).resolves.toBe(false);
  });

  it('treats an already-connected device as reconnected', async () => {
    const { policy, contexts } = recordingPolicy();
    const controller = new BleController(policy);
    const device = fakeDevice('aa', true);
    await controller.connect(device);

    bleMock.__state.disconnectHandlers.get('aa')?.();
    await expect(contexts.get('aa')!.attempt()).resolves.toBe(true);
    expect(device.connect).toHaveBeenCalledTimes(1); // the original connect only
  });

  it('cancels every reconnect on destroy', () => {
    const { policy } = recordingPolicy();
    new BleController(policy).destroy();
    expect(policy.cancelAllReconnects).toHaveBeenCalled();
  });
});
