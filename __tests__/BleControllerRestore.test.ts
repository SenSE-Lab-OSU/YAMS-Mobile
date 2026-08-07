/**
 * Covers iOS Core Bluetooth state restoration, which is otherwise only reachable
 * by getting the OS to terminate and relaunch the app mid-session.
 *
 * @format
 */

jest.mock('react-native-ble-plx', () => {
  const state: { options: Record<string, unknown>; instance: unknown } = {
    options: {},
    instance: null,
  };
  return {
    __state: state,
    BleManager: jest.fn().mockImplementation((options?: Record<string, unknown>) => {
      state.options = options ?? {};
      state.instance = {
        startDeviceScan: jest.fn(),
        stopDeviceScan: jest.fn(),
        onDeviceDisconnected: jest.fn(() => ({ remove: jest.fn() })),
        destroy: jest.fn(),
      };
      return state.instance;
    }),
  };
});

import { Platform } from 'react-native';
import type { Device } from 'react-native-ble-plx';

import { BleController } from '../src/ble/BleController';

type RestoreFn = (restored: { connectedPeripherals: Device[] } | null) => void;

const bleMock = jest.requireMock('react-native-ble-plx') as {
  __state: {
    options: { restoreStateIdentifier?: string; restoreStateFunction?: RestoreFn };
    instance: { onDeviceDisconnected: jest.Mock };
  };
};

function fakeDevice(id: string): Device {
  return { id, name: `MSense-${id}` } as Device;
}

function restoreWith(devices: Device[]): void {
  bleMock.__state.options.restoreStateFunction?.({ connectedPeripherals: devices });
}

const originalOS = Platform.OS;

beforeEach(() => {
  (Platform as { OS: string }).OS = 'ios';
  bleMock.__state.options = {};
});

afterEach(() => {
  (Platform as { OS: string }).OS = originalOS;
});

describe('BleController state restoration', () => {
  it('registers a restore identifier on iOS', () => {
    const controller = new BleController();
    expect(bleMock.__state.options.restoreStateIdentifier).toBe('org.senselab.yamsmobile.ble');
    expect(typeof bleMock.__state.options.restoreStateFunction).toBe('function');
    controller.destroy();
  });

  it('does not register one on Android', () => {
    (Platform as { OS: string }).OS = 'android';
    const controller = new BleController();
    expect(bleMock.__state.options.restoreStateIdentifier).toBeUndefined();
    controller.destroy();
  });

  it('delivers devices restored before anyone subscribed', () => {
    const controller = new BleController();
    // Fires during BleManager construction in production -- always before App.tsx
    // has had a chance to register its listener.
    restoreWith([fakeDevice('aa')]);

    const seen: string[] = [];
    controller.onRestoredDevices(devices => seen.push(...devices.map(d => d.id)));

    expect(seen).toEqual(['aa']);
  });

  it('delivers a buffered restore only once', () => {
    const controller = new BleController();
    restoreWith([fakeDevice('aa')]);

    const first: string[] = [];
    const second: string[] = [];
    controller.onRestoredDevices(devices => first.push(...devices.map(d => d.id)));
    controller.onRestoredDevices(devices => second.push(...devices.map(d => d.id)));

    expect(first).toEqual(['aa']);
    expect(second).toEqual([]);
  });

  it('delivers to a listener that subscribed first', () => {
    const controller = new BleController();
    const seen: string[] = [];
    controller.onRestoredDevices(devices => seen.push(...devices.map(d => d.id)));

    restoreWith([fakeDevice('bb')]);

    expect(seen).toEqual(['bb']);
  });

  it('adopts restored devices so clock origins can be seeded', () => {
    const controller = new BleController();
    restoreWith([fakeDevice('aa')]);

    // Unknown before restoration, and settable afterwards -- this is what keeps a
    // resumed session reconstructing timestamps the way it started.
    expect(controller.getClockOrigin('aa')).toBeNull();
    controller.setClockOrigin('aa', 1_780_000_000);
    expect(controller.getClockOrigin('aa')).toBe(1_780_000_000);
  });

  it('watches restored devices for disconnects', () => {
    const controller = new BleController();
    const connections: Array<[string, boolean]> = [];
    controller.onConnectionChange((id, connected) => connections.push([id, connected]));

    restoreWith([fakeDevice('aa'), fakeDevice('bb')]);

    expect(bleMock.__state.instance.onDeviceDisconnected).toHaveBeenCalledTimes(2);
    expect(connections).toEqual([
      ['aa', true],
      ['bb', true],
    ]);
  });

  it('ignores a first launch and an empty restore', () => {
    const controller = new BleController();
    const seen: Device[][] = [];
    controller.onRestoredDevices(devices => seen.push(devices));

    bleMock.__state.options.restoreStateFunction?.(null);
    restoreWith([]);

    expect(seen).toEqual([]);
  });

  it('does not re-adopt a device it already tracks', () => {
    const controller = new BleController();
    restoreWith([fakeDevice('aa')]);
    controller.setClockOrigin('aa', 1_780_000_000);

    restoreWith([fakeDevice('aa')]);

    expect(controller.getClockOrigin('aa')).toBe(1_780_000_000);
  });
});
