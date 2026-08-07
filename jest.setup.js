/* eslint-env jest */
/**
 * Stubs for the native modules the app loads at import time. Without these, any
 * test that reaches App.tsx dies in TurboModuleRegistry.getEnforcing() before a
 * single assertion runs.
 *
 * Individual tests can still jest.mock() any of these with a richer fake -- a
 * per-file factory wins over what is registered here.
 *
 * @format
 */

jest.mock('@sayem314/react-native-keep-awake', () => ({
  activateKeepAwake: jest.fn(),
  deactivateKeepAwake: jest.fn(),
}));

jest.mock('react-native-ble-plx', () => ({
  BleManager: jest.fn().mockImplementation(() => ({
    startDeviceScan: jest.fn(),
    stopDeviceScan: jest.fn(),
    onDeviceDisconnected: jest.fn(() => ({ remove: jest.fn() })),
    destroy: jest.fn(),
  })),
}));

jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/documents',
  DownloadDirectoryPath: '/downloads',
  exists: jest.fn(async () => false),
  readFile: jest.fn(async () => ''),
  writeFile: jest.fn(async () => undefined),
  appendFile: jest.fn(async () => undefined),
  unlink: jest.fn(async () => undefined),
  mkdir: jest.fn(async () => undefined),
}));
