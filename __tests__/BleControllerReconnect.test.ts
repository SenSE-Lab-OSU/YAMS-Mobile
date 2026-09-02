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
import { bytesToBase64, uint32LEToBase64 } from '../src/ble/binary';
import * as Protocol from '../src/ble/protocol';
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

/**
 * `charValues` scripts what a read of each characteristic UUID returns (as the
 * base64 payload react-native-ble-plx hands back), so tests can simulate a
 * device that reports itself as already collecting under some encoding --
 * without going through a write first, the way the real firmware would be
 * reachable by a process that never called startCollection() itself.
 */
function fakeDevice(
  id: string,
  connected = false,
  charValues: Record<string, string> = {},
): Device & FakeDevice {
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
    readCharacteristicForService: jest.fn(async (_service: string, characteristic: string) => ({
      value: charValues[characteristic] ?? null,
    })),
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

  it('re-subscribes after a manual disconnect and reconnect mid-collection', async () => {
    const { policy } = recordingPolicy();
    const controller = new BleController(policy);
    const device = fakeDevice('aa');

    await controller.connect(device);
    await controller.startCollection('aa', 100000);
    expect(device.monitorCharacteristicForService).toHaveBeenCalledTimes(2);
    const origin = controller.getClockOrigin('aa');

    // An intentional disconnect, e.g. the researcher steps out of range on
    // purpose -- this does not end the session.
    await controller.disconnect('aa');
    expect(device.cancelConnection).toHaveBeenCalledTimes(1);

    await controller.connect(device);

    // Resubscribed even though the prior disconnect was manual, and still
    // anchored to the origin the session started with.
    expect(device.monitorCharacteristicForService).toHaveBeenCalledTimes(4);
    expect(controller.getClockOrigin('aa')).toBe(origin);
  });

  it('does not re-subscribe on a manual reconnect when nothing was collecting', async () => {
    const { policy } = recordingPolicy();
    const controller = new BleController(policy);
    const device = fakeDevice('aa');

    await controller.connect(device);
    await controller.disconnect('aa');
    await controller.connect(device);

    expect(device.monitorCharacteristicForService).not.toHaveBeenCalled();
  });

  it('refreshSubscriptions re-adds notifications for a connected, collecting device', async () => {
    const { policy } = recordingPolicy();
    const controller = new BleController(policy);
    const device = fakeDevice('aa', true);

    await controller.connect(device);
    await controller.startCollection('aa', 100000);
    expect(device.monitorCharacteristicForService).toHaveBeenCalledTimes(2);

    const result = await controller.refreshSubscriptions('aa');

    expect(result).toBe('resubscribed');
    expect(device.monitorCharacteristicForService).toHaveBeenCalledTimes(4);
  });

  it('refreshSubscriptions is a no-op when the device is not collecting', async () => {
    const { policy } = recordingPolicy();
    const controller = new BleController(policy);
    const device = fakeDevice('aa', true);
    await controller.connect(device);

    const result = await controller.refreshSubscriptions('aa');

    expect(result).toBe('not-collecting');
    expect(device.monitorCharacteristicForService).not.toHaveBeenCalled();
  });

  it('refreshSubscriptions is a no-op when the device is not connected', async () => {
    const { policy } = recordingPolicy();
    const controller = new BleController(policy);
    const device = fakeDevice('aa', false);
    await controller.connect(device);
    await controller.startCollection('aa', 100000);

    const result = await controller.refreshSubscriptions('aa');

    expect(result).toBe('not-connected');
  });

  it('refreshAllSubscriptions handles a mix of devices independently', async () => {
    const { policy } = recordingPolicy();
    const controller = new BleController(policy);
    const collectingDevice = fakeDevice('aa', true);
    const idleDevice = fakeDevice('bb', true);

    await controller.connect(collectingDevice);
    await controller.startCollection('aa', 100000);
    await controller.connect(idleDevice);

    const results = await controller.refreshAllSubscriptions();

    expect(results.get('aa')).toBe('resubscribed');
    expect(results.get('bb')).toBe('not-collecting');
  });

  it('discovers a hardware-reported collection on the very first connect, with no prior local state', async () => {
    const { policy } = recordingPolicy();
    const controller = new BleController(policy);
    const device = fakeDevice('aa', true, {
      [Protocol.CHAR_COLLECTION_CTL]: uint32LEToBase64(1),
      [Protocol.CHAR_PARTICIPANT_ENC]: uint32LEToBase64(100500),
    });

    // No prior connect() call for this device -- this process has never heard
    // of it before, e.g. a fresh install reconnecting to hardware that was
    // already collecting.
    await controller.connect(device);

    expect(device.monitorCharacteristicForService).toHaveBeenCalledTimes(2);
    expect(controller.getParticipantEncoding('aa')).toBe(100500);
  });

  it('discovers a hardware-reported collection when the device reports it in fewer than 4 bytes', async () => {
    // Regression test: real MotionSenSE firmware has been observed reporting
    // CHAR_COLLECTION_CTL as a single byte on read, not the 4-byte "uint32 LE"
    // its protocol comment describes on write. A fixed-width uint32 decode
    // threw a RangeError here instead of resolving false, which silently
    // killed connect() for exactly the device this check exists to catch.
    const { policy } = recordingPolicy();
    const controller = new BleController(policy);
    const device = fakeDevice('aa', true, {
      [Protocol.CHAR_COLLECTION_CTL]: bytesToBase64(Uint8Array.of(1)),
    });

    await expect(controller.connect(device)).resolves.toBeUndefined();

    expect(device.monitorCharacteristicForService).toHaveBeenCalledTimes(2);
  });

  it('does not resubscribe or report an encoding when hardware reports idle and there is no local state', async () => {
    const { policy } = recordingPolicy();
    const controller = new BleController(policy);
    const device = fakeDevice('aa', true, {
      [Protocol.CHAR_COLLECTION_CTL]: uint32LEToBase64(0),
    });

    await controller.connect(device);

    expect(device.monitorCharacteristicForService).not.toHaveBeenCalled();
    expect(controller.getParticipantEncoding('aa')).toBeNull();
  });

  it('startCollection reports the encoding immediately, without needing a reconnect', async () => {
    const { policy } = recordingPolicy();
    const controller = new BleController(policy);
    const device = fakeDevice('aa', true);
    await controller.connect(device);

    await controller.startCollection('aa', 100500);

    expect(controller.getParticipantEncoding('aa')).toBe(100500);
  });

  it('stopCollection clears the reported encoding', async () => {
    const { policy } = recordingPolicy();
    const controller = new BleController(policy);
    const device = fakeDevice('aa', true);
    await controller.connect(device);
    await controller.startCollection('aa', 100500);

    await controller.stopCollection('aa');

    expect(controller.getParticipantEncoding('aa')).toBeNull();
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
