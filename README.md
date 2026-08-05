<h1 align="center">YAMS Mobile</h1>

<p align="center">
  <img src="assets/yams_logo_v2.png" alt="YAMS logo" width="120">
</p>

<p align="center">
  <img alt="React Native 0.86" src="https://img.shields.io/badge/React_Native-0.86-61DAFB?style=flat-square&logo=react&logoColor=white">
  <img alt="TypeScript 5.8" src="https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="Platform: Android and iOS" src="https://img.shields.io/badge/platform-Android%20%7C%20iOS-3DDC84?style=flat-square&logo=android&logoColor=white">
  <img alt="Bluetooth Low Energy" src="https://img.shields.io/badge/BLE-react--native--ble--plx-0082FC?style=flat-square&logo=bluetooth&logoColor=white">
</p>

<p align="center">
  <em>Android-first mobile companion to the desktop YAMS toolkit — collects accelerometer data from MotionSenSE BLE devices.</em>
</p>

---

YAMS Mobile connects to [MotionSenSE](https://github.com/SenSE-Lab-OSU) BLE
accelerometer devices, drives data collection sessions, and logs ENMO samples to
disk in a format that drops directly into the desktop `yams` sync pipeline.

- **BLE protocol** — GATT service/characteristic constants, little-endian
  packing helpers, and ENMO sample decoding for both current and legacy
  firmware payload shapes.
- **Connection management** — a single `BleController` owns all hardware
  contact, handling multi-device connections, auto-reconnect, and device-clock
  timestamp reconstruction (`deviceTime = t0 + counter / sampleRateHz`).
- **Session logging** — one line per sample (`ENMO Counter deviceTime`) written
  through a serialized queue, byte-compatible with `msense_yams_sync.py`.

Protocol and file-format correctness is defined by parity with the desktop
Python implementation, not by this repo alone — see `CLAUDE.md` for which files
mirror which Python modules.

# Getting Started

> **Note**: Make sure you have completed the [Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment) guide before proceeding.

## Step 1: Start Metro

First, you will need to run **Metro**, the JavaScript build tool for React Native.

To start the Metro dev server, run the following command from the root of your React Native project:

```sh
# Using npm
npm start

# OR using Yarn
yarn start
```

## Step 2: Build and run your app

With Metro running, open a new terminal window/pane from the root of your React Native project, and use one of the following commands to build and run your Android or iOS app:

### Android

```sh
# Using npm
npm run android

# OR using Yarn
yarn android
```

### iOS

For iOS, remember to install CocoaPods dependencies (this only needs to be run on first clone or after updating native deps).

The first time you create a new project, run the Ruby bundler to install CocoaPods itself:

```sh
bundle install
```

Then, and every time you update your native dependencies, run:

```sh
bundle exec pod install
```

For more information, please visit [CocoaPods Getting Started guide](https://guides.cocoapods.org/using/getting-started.html).

```sh
# Using npm
npm run ios

# OR using Yarn
yarn ios
```

If everything is set up correctly, you should see your new app running in the Android Emulator, iOS Simulator, or your connected device.

This is one way to run your app — you can also build it directly from Android Studio or Xcode.

## Step 3: Modify your app

Now that you have successfully run the app, let's make changes!

Open `App.tsx` in your text editor of choice and make some changes. When you save, your app will automatically update and reflect these changes — this is powered by [Fast Refresh](https://reactnative.dev/docs/fast-refresh).

When you want to forcefully reload, for example to reset the state of your app, you can perform a full reload:

- **Android**: Press the <kbd>R</kbd> key twice or select **"Reload"** from the **Dev Menu**, accessed via <kbd>Ctrl</kbd> + <kbd>M</kbd> (Windows/Linux) or <kbd>Cmd ⌘</kbd> + <kbd>M</kbd> (macOS).
- **iOS**: Press <kbd>R</kbd> in iOS Simulator.

## Congratulations! :tada:

You've successfully run and modified your React Native App. :partying_face:

### Now what?

- If you want to add this new React Native code to an existing application, check out the [Integration guide](https://reactnative.dev/docs/integration-with-existing-apps).
- If you're curious to learn more about React Native, check out the [docs](https://reactnative.dev/docs/getting-started).

# Troubleshooting

If you're having issues getting the above steps to work, see the [Troubleshooting](https://reactnative.dev/docs/troubleshooting) page.

# Learn More

To learn more about React Native, take a look at the following resources:

- [React Native Website](https://reactnative.dev) - learn more about React Native.
- [Getting Started](https://reactnative.dev/docs/environment-setup) - an **overview** of React Native and how setup your environment.
- [Learn the Basics](https://reactnative.dev/docs/getting-started) - a **guided tour** of the React Native **basics**.
- [Blog](https://reactnative.dev/blog) - read the latest official React Native **Blog** posts.
- [`@facebook/react-native`](https://github.com/facebook/react-native) - the Open Source; GitHub **repository** for React Native.
