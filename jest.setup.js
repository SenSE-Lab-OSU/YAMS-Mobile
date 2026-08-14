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

// SafeAreaProvider renders null until it has measured window insets, which never
// happens without a host view. Without this, every test that mounts App renders an
// empty tree and any assertion about the UI passes vacuously.
jest.mock('react-native-safe-area-context', () => {
  const mock = require('react-native-safe-area-context/jest/mock');
  return mock.default ?? mock;
});

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
