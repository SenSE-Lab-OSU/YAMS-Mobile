/**
 * The two reconnect strategies differ on purpose, and the reason is not visible
 * from either implementation alone: Android polls because it has no equivalent of
 * a pending Core Bluetooth connect, and iOS must not poll because timers stop
 * firing once a suspended app has no BLE traffic to wake it.
 *
 * @format
 */

import {
  androidBlePolicy,
  iosBlePolicy,
  RECONNECT_INTERVAL_MS,
  ReconnectContext,
} from '../src/platform/blePolicy';

function context(overrides: Partial<ReconnectContext> = {}) {
  const attempt = jest.fn(async () => false);
  const isActive = jest.fn(() => true);
  return { attempt, isActive, ...overrides } as ReconnectContext & {
    attempt: jest.Mock;
    isActive: jest.Mock;
  };
}

describe('iosBlePolicy', () => {
  it('provides a restore identifier and forwards restored peripherals', () => {
    const onRestore = jest.fn();
    const options = iosBlePolicy.managerOptions(onRestore);

    expect(options.restoreStateIdentifier).toBe('org.senselab.yamsmobile.ble');

    const device = { id: 'aa' } as never;
    options.restoreStateFunction?.({ connectedPeripherals: [device] });
    expect(onRestore).toHaveBeenCalledWith([device]);
  });

  it('ignores a first launch and an empty restore', () => {
    const onRestore = jest.fn();
    const options = iosBlePolicy.managerOptions(onRestore);

    options.restoreStateFunction?.(null);
    options.restoreStateFunction?.({ connectedPeripherals: [] });

    expect(onRestore).not.toHaveBeenCalled();
  });

  it('attempts exactly once and never schedules a retry', () => {
    jest.useFakeTimers();
    const ctx = context();

    iosBlePolicy.beginReconnect('aa', ctx);
    jest.advanceTimersByTime(RECONNECT_INTERVAL_MS * 10);

    expect(ctx.attempt).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });

  it('does not attempt for a device that is no longer active', () => {
    const ctx = context({ isActive: () => false });
    iosBlePolicy.beginReconnect('aa', ctx);
    expect(ctx.attempt).not.toHaveBeenCalled();
  });

  it('requests no permissions up front', async () => {
    await expect(iosBlePolicy.requestPermissions()).resolves.toBe(true);
  });
});

describe('androidBlePolicy', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    androidBlePolicy.cancelAllReconnects();
    jest.useRealTimers();
  });

  it('offers no restoration options', () => {
    expect(androidBlePolicy.managerOptions(jest.fn())).toEqual({});
  });

  it('retries on an interval until the attempt succeeds', async () => {
    const ctx = context();
    ctx.attempt.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    androidBlePolicy.beginReconnect('aa', ctx);

    await jest.advanceTimersByTimeAsync(RECONNECT_INTERVAL_MS);
    expect(ctx.attempt).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(RECONNECT_INTERVAL_MS);
    expect(ctx.attempt).toHaveBeenCalledTimes(2);

    // Succeeded, so the timer should be gone rather than polling a live device.
    await jest.advanceTimersByTimeAsync(RECONNECT_INTERVAL_MS * 3);
    expect(ctx.attempt).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not stack timers for the same device', () => {
    const ctx = context();
    androidBlePolicy.beginReconnect('aa', ctx);
    androidBlePolicy.beginReconnect('aa', ctx);
    expect(jest.getTimerCount()).toBe(1);
  });

  it('polls each device independently', () => {
    androidBlePolicy.beginReconnect('aa', context());
    androidBlePolicy.beginReconnect('bb', context());
    expect(jest.getTimerCount()).toBe(2);

    androidBlePolicy.cancelReconnect('aa');
    expect(jest.getTimerCount()).toBe(1);
  });

  it('stops polling a device that is no longer active', async () => {
    const ctx = context({ isActive: () => false });
    androidBlePolicy.beginReconnect('aa', ctx);

    await jest.advanceTimersByTimeAsync(RECONNECT_INTERVAL_MS);

    expect(ctx.attempt).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('cancelAllReconnects clears every timer', () => {
    androidBlePolicy.beginReconnect('aa', context());
    androidBlePolicy.beginReconnect('bb', context());

    androidBlePolicy.cancelAllReconnects();

    expect(jest.getTimerCount()).toBe(0);
  });

  it('cancelling an unknown device is not an error', () => {
    expect(() => androidBlePolicy.cancelReconnect('nope')).not.toThrow();
  });
});
