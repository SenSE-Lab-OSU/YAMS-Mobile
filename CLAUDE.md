# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

YAMS Mobile is a React Native (0.86, TypeScript) app that is the Android-first
mobile counterpart to the desktop `yams` Python project (not in this repo).
It connects to MotionSenSE BLE accelerometer devices, drives data collection,
and logs ENMO samples to disk in a format compatible with the desktop YAMS
sync tooling. Several files explicitly document which Python module they
mirror (e.g. `yams/msense_collector.py`, `yams/msense_yams_sync.py`,
`yams/data_extraction.py`) — when changing protocol or encoding logic, keep
those comments in mind since correctness is defined by parity with that
external implementation, not by this codebase alone.

## Commands

```sh
npm start              # start Metro bundler
npm run android         # build + run on Android (primary target)
npm run ios             # build + run on iOS (requires `bundle exec pod install` first time / after native dep changes)
npm run lint            # eslint .
npm test                # jest (run once)
npx jest <path>         # run a single test file
npx jest -t "<name>"    # run tests matching a name pattern
npx tsc --noEmit        # type-check without emitting
```

iOS native deps: `bundle install` once, then `bundle exec pod install` after
any native dependency change (see `ios/Podfile`).

## Architecture

**Data flow:** `BleController` (src/ble/BleController.ts) owns a single
`react-native-ble-plx` `BleManager` instance and is the sole point of contact
with BLE hardware. `App.tsx` holds one `BleController` in a ref and drives all
UI state from its callback-based listener API (`onConnectionChange`,
`onBatteryUpdate`, `onEnmoSample`) rather than polling. Per-connected-device
state (rows keyed by device id) is kept in `Map`s in React state; the
controller keeps its own internal `Map` of `ConnectedDeviceState` for
BLE-level bookkeeping (subscriptions, reconnect timers, clock origin).

**BLE protocol layering** (src/ble/):
- `protocol.ts` — GATT service/characteristic UUID constants and sample-rate
  constants. This is the single source of truth for the wire protocol and
  must stay byte-for-byte compatible with the MotionSenSE firmware / desktop
  collector — do not change UUIDs or payload layouts without confirming
  against `yams/msense_collector.py`.
- `binary.ts` — little-endian pack/unpack helpers for the base64 strings
  `react-native-ble-plx` uses for characteristic I/O (mirrors Python's
  `struct.pack('<I'/'<Q'/'<f', ...)`).
- `samples.ts` — decodes the ENMO notify payload; handles both new firmware
  (float32 ENMO + uint32 counter, 8 bytes) and legacy firmware (uint16
  counter, 6 bytes) payload shapes.
- `BleController.ts` — connection lifecycle, auto-reconnect (polls every
  `RECONNECT_INTERVAL_MS` and re-registers notifications on reconnect),
  collection start/stop sequence (write unix time → write participant
  encoding → write collection control → subscribe to notifications), and
  device-clock timestamp reconstruction: `deviceTime = t0 + counter / sampleRateHz`,
  where `t0` is the unix time written to the device at collection start.

**Persistence:** `SessionLogger` (src/storage/SessionLogger.ts) appends one
line per ENMO sample as whitespace-separated `ENMO Counter deviceTime` (no
header) into `<DocumentDirectoryPath>/yams-mobile-data/<session-timestamp>/<device-label>.txt`.
This exact layout is required so files can be dropped directly into the
desktop `msense_yams_sync.py` pipeline — do not change the line format
without updating that consumer too. Writes are serialized per-logger via an
internal promise queue (`this.queue`) to avoid interleaved/partial file
writes since `append()` is fire-and-forget from the caller's perspective;
`flush()` awaits the queue and should be called before finishing a session.

**Participant encoding:** `participant.ts` mirrors
`participant_encoding_default()` from the desktop collector: `sub-XXXX` /
`ses-YY` text inputs are reduced to `subNumber * 100 + sesNumber` and written
to the device as a single uint32.

**Theming:** `theme.ts` exposes `useTheme()` (reads `useColorScheme()`) and a
pure `getTheme(isDarkMode)` for non-hook contexts. All components
(`AppButton`, `StatusChip`, and `App.tsx`'s own `createStyles`) take the
theme object and build `StyleSheet` objects from it rather than referencing
colors directly, so new UI should follow the same pattern instead of hardcoding colors.

## Notes

- Only one test currently exists (`__tests__/App.test.tsx`, a smoke render
  test). There is no BLE mocking layer yet.
- `react-native-ble-plx` is a native module — logic in `BleController` can't
  be exercised in Jest without a device/simulator or a mock; prefer testing
  the pure helpers (`binary.ts`, `samples.ts`, `participant.ts`) directly.
- Android requires runtime permission requests for BLE
  (`BleController.requestAndroidPermissions`): `BLUETOOTH_SCAN` +
  `BLUETOOTH_CONNECT` on API 31+, `ACCESS_FINE_LOCATION` below that.
