/**
 * YAMS Mobile
 * Android-first MotionSenSE control: connect, start/stop collection, and
 * timestamp+save ENMO notifications locally. Mirrors yams/msense_collector.py.
 *
 * @format
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Modal,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Device } from 'react-native-ble-plx';
import { activateKeepAwake, deactivateKeepAwake } from '@sayem314/react-native-keep-awake';

import { AppButton } from './src/components/AppButton';
import { IconButton } from './src/components/IconButton';
import { SettingsSheet } from './src/components/SettingsSheet';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { StatusChip, Tone } from './src/components/StatusChip';
import { BleController } from './src/ble/BleController';
import { DeviceLike } from './src/ble/DeviceLike';
import { SIMULATED_DEVICE_ID } from './src/ble/SimulatedDevice';
import { EnmoSample } from './src/ble/samples';
import { encodeParticipant } from './src/participant';
import { BackgroundSession } from './src/platform/backgroundSession';
import { DEMO_SESSION_PREFIX, SessionLogger } from './src/storage/SessionLogger';
import { Onboarding } from './src/storage/Onboarding';
import { SessionState } from './src/storage/SessionState';
import { useTheme } from './src/theme';

const onlyDigits = (value: string): string => value.replace(/[^0-9]/g, '');

function rssiTone(rssi: number | null): Tone {
  if (rssi == null) return 'neutral';
  if (rssi >= -50) return 'success';
  if (rssi >= -90) return 'warning';
  return 'destructive';
}

interface DeviceRow {
  id: string;
  name: string;
  connected: boolean;
  battery: number | null;
  lastSample: EnmoSample | null;
  simulated: boolean;
  // The encoding this device is currently collecting under, or null if it
  // isn't (or that isn't known yet). Number only -- not decoded back to
  // sub-XXXX/ses-YY, since it may belong to a session this app never started.
  participantEncoding: number | null;
}

function App(): React.JSX.Element {
  const theme = useTheme();

  const controllerRef = useRef<BleController | null>(null);
  const loggersRef = useRef<Map<string, SessionLogger>>(new Map());
  // Directory of the in-progress session, if any -- set by startAll() and
  // restoreSession(), cleared by stopAll(). Exists so refreshAll() knows where to
  // put a logger it has to recreate, without needing the session dir threaded
  // through as a prop or re-derived from disk on every call.
  const sessionDirRef = useRef<string | null>(null);

  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<Map<string, DeviceLike>>(new Map());
  const [rows, setRows] = useState<Map<string, DeviceRow>>(new Map());
  // Mirrors `rows` for code that reads current device info from a callback (an
  // AppState listener) without wanting to be re-created on every row change.
  const rowsRef = useRef<Map<string, DeviceRow>>(rows);
  rowsRef.current = rows;
  const [subNumber, setSubNumber] = useState('1000');
  const [sesNumber, setSesNumber] = useState('00');
  const [collecting, setCollecting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // null until the flag file has been read. Rendering the app before that would
  // flash the main screen for a frame on a genuine first launch.
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [replayingTour, setReplayingTour] = useState(false);
  const [keepAwake, setKeepAwake] = useState(false);
  // Intentionally not persisted: demo mode must never carry over into a real study.
  const [simulatedDevice, setSimulatedDevice] = useState(false);

  const subId = `sub-${subNumber}`;
  const sesId = `ses-${sesNumber}`;

  const participantEncoding = useMemo(() => encodeParticipant(subId, sesId), [subId, sesId]);

  useEffect(() => {
    if (keepAwake) {
      activateKeepAwake();
    } else {
      deactivateKeepAwake();
    }
    return () => deactivateKeepAwake();
  }, [keepAwake]);

  useEffect(() => {
    Onboarding.hasCompleted().then(setOnboarded);
  }, []);

  useEffect(() => {
    // Deferred until the tour is done so the permission prompts follow the screen
    // that explains them. On iOS the Core Bluetooth dialog fires when BleManager
    // is constructed, so construction itself has to wait.
    //
    // Safe only because a first launch has no session to restore: on a normal
    // launch the flag is already set and the manager is built immediately, which
    // is what iOS state restoration depends on.
    if (onboarded !== true) return;

    const controller = new BleController();
    controllerRef.current = controller;
    // Sequenced, not fired together: Android serialises permission dialogs and a
    // request issued while another is in flight can be dropped, which would leave
    // POST_NOTIFICATIONS unasked and the foreground service silent.
    (async () => {
      await controller.requestPermissions();
      await BackgroundSession.requestPermission();
    })().catch(error => console.warn('Permission request failed', error));

    const offConn = controller.onConnectionChange((id, connected) => {
      setRows(prev => {
        const row = prev.get(id);
        if (!row) return prev;
        const next = new Map(prev);
        next.set(id, { ...row, connected });
        return next;
      });
    });

    const offBattery = controller.onBatteryUpdate((id, percent) => {
      setRows(prev => {
        const row = prev.get(id);
        if (!row) return prev;
        const next = new Map(prev);
        next.set(id, { ...row, battery: percent });
        return next;
      });
    });

    const offEnmo = controller.onEnmoSample((id, sample) => {
      loggersRef.current.get(id)?.append(sample);
      setRows(prev => {
        const row = prev.get(id);
        if (!row) return prev;
        const next = new Map(prev);
        next.set(id, { ...row, lastSample: sample });
        return next;
      });
    });

    // iOS may relaunch the app in the background with its connections intact but
    // this process's state empty. Rebuild the session from disk and re-subscribe,
    // without touching the hardware's own collection state.
    const restoreSession = async (restored: Device[]) => {
      const session = await SessionState.load();
      if (!session) return;

      setSubNumber(session.subjectId.replace(/^sub-/, ''));
      setSesNumber(session.sessionId.replace(/^ses-/, ''));
      sessionDirRef.current = session.sessionDir;

      let resumed = 0;
      for (const device of restored) {
        const entry = session.devices.find(candidate => candidate.id === device.id);
        if (!entry) continue;

        if (entry.clockOriginUnixSec != null) {
          controller.setClockOrigin(device.id, entry.clockOriginUnixSec);
        }
        loggersRef.current.set(
          device.id,
          new SessionLogger(session.sessionDir, entry.name, device.id),
        );
        setRows(prev => {
          const next = new Map(prev);
          next.set(device.id, {
            id: device.id,
            name: entry.name,
            simulated: false,
            connected: true,
            battery: null,
            lastSample: null,
            participantEncoding: session.participantEncoding,
          });
          return next;
        });

        try {
          await controller.resumeCollection(device.id);
          resumed += 1;
        } catch (error) {
          console.warn('Could not resume collection for', device.id, error);
        }
      }

      if (resumed > 0) setCollecting(true);
    };

    const offRestore = controller.onRestoredDevices(devices => {
      restoreSession(devices).catch(error => console.warn('Session restore failed', error));
    });

    return () => {
      offConn();
      offBattery();
      offEnmo();
      offRestore();
      controller.destroy();
    };
  }, [onboarded]);

  const startScan = () => {
    setFound(new Map());
    setScanning(true);
    controllerRef.current?.startScan(device => {
      setFound(prev => {
        const existing = prev.get(device.id);
        if (existing && existing.rssi === device.rssi) return prev;
        const next = new Map(prev);
        next.set(device.id, device);
        return next;
      });
    });
  };

  const stopScan = () => {
    controllerRef.current?.stopScan();
    setScanning(false);
  };

  const toggleSimulatedDevice = async (enabled: boolean) => {
    setSimulatedDevice(enabled);
    controllerRef.current?.enableSimulatedDevice(enabled);

    // Turning it off mid-session would otherwise leave a connected simulator
    // feeding samples into a session that no longer advertises itself as demo.
    if (!enabled) {
      setFound(prev => {
        if (!prev.has(SIMULATED_DEVICE_ID)) return prev;
        const next = new Map(prev);
        next.delete(SIMULATED_DEVICE_ID);
        return next;
      });
      if (rows.has(SIMULATED_DEVICE_ID)) await disconnectFrom(SIMULATED_DEVICE_ID);
    }
  };

  const connectTo = async (device: DeviceLike) => {
    const controller = controllerRef.current;
    await controller?.connect(device);
    // If this device was already collecting -- started by this app in an
    // earlier process, or by a different phone entirely -- connect() has just
    // read that back, so the row can show it immediately.
    const deviceParticipantEncoding = controller?.getParticipantEncoding(device.id) ?? null;
    setRows(prev => {
      const next = new Map(prev);
      next.set(device.id, {
        id: device.id,
        name: device.name ?? device.id,
        connected: true,
        battery: null,
        lastSample: null,
        simulated: device.id === SIMULATED_DEVICE_ID,
        participantEncoding: deviceParticipantEncoding,
      });
      return next;
    });
  };

  const disconnectFrom = async (id: string) => {
    await controllerRef.current?.disconnect(id);
    setRows(prev => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    loggersRef.current.delete(id);
  };

  const startAll = async () => {
    const controller = controllerRef.current;
    if (!controller) return;

    // One simulated device marks the whole session: a folder must never contain a
    // mix of real and synthetic data without saying so in its own name.
    const anySimulated = [...rows.values()].some(row => row.simulated);
    const sessionDir = await SessionLogger.newSessionDir(anySimulated ? DEMO_SESSION_PREFIX : '');
    const devices = [...rows.values()].map(row => ({ id: row.id, name: row.name }));
    const startedAt = new Date().toISOString();

    await SessionLogger.writeSessionInfo(sessionDir, {
      subjectId: subId,
      sessionId: sesId,
      participantEncoding,
      devices,
      startedAt,
      simulated: anySimulated,
    });

    await SessionState.save({
      sessionDir,
      subjectId: subId,
      sessionId: sesId,
      participantEncoding,
      devices: devices.map(device => ({ ...device, clockOriginUnixSec: null })),
      startedAt,
    });
    sessionDirRef.current = sessionDir;

    for (const row of rows.values()) {
      loggersRef.current.set(row.id, new SessionLogger(sessionDir, row.name, row.id));
      await controller.startCollection(row.id, participantEncoding);

      // Recorded per device rather than up front: t0 only exists once
      // startCollection has written it to the hardware.
      const clockOrigin = controller.getClockOrigin(row.id);
      if (clockOrigin != null) {
        await SessionState.setClockOrigin(row.id, clockOrigin);
      }
    }

    // Same value for every row in this session -- already computed above, so
    // this is a plain state update rather than a round trip back to the
    // controller per device.
    setRows(prev => {
      const next = new Map(prev);
      for (const [id, row] of next) next.set(id, { ...row, participantEncoding });
      return next;
    });

    BackgroundSession.start({ subjectId: subId, sessionId: sesId, deviceCount: rows.size });
    setCollecting(true);
  };

  const stopAll = async () => {
    const controller = controllerRef.current;
    if (!controller) return;

    for (const row of rows.values()) {
      await controller.stopCollection(row.id);
      await loggersRef.current.get(row.id)?.flush();
    }
    await SessionState.clear();
    sessionDirRef.current = null;
    BackgroundSession.stop();
    setCollecting(false);

    // Mirrors BleController.stopCollection() clearing its own copy -- a
    // stopped device should stop showing an encoding as currently running.
    setRows(prev => {
      const next = new Map(prev);
      for (const [id, row] of next) next.set(id, { ...row, participantEncoding: null });
      return next;
    });
  };

  /**
   * Forces every connected, still-collecting device to re-subscribe, and
   * recreates a logger for any device that lost one along the way (e.g. a
   * manual disconnect/reconnect deleted it). Safe to call any time: devices
   * that are not connected, or have no session running, are left untouched.
   * Triggered automatically by the AppState listener below rather than a
   * button, since the moment a stalled connection matters most is the moment
   * the app is looked at again.
   */
  const refreshAll = useCallback(async () => {
    const controller = controllerRef.current;
    if (!controller || !sessionDirRef.current) return;

    const results = await controller.refreshAllSubscriptions();
    for (const [id, status] of results) {
      if (status !== 'resubscribed' || loggersRef.current.has(id)) continue;
      const row = rowsRef.current.get(id);
      if (!row) continue;
      loggersRef.current.set(id, new SessionLogger(sessionDirRef.current, row.name, id));
    }
  }, []);

  useEffect(() => {
    let previousState = AppState.currentState;

    const sub = AppState.addEventListener('change', nextState => {
      // A genuine return from background/inactive, not the transient 'inactive'
      // blips iOS sends for the app switcher, Control Center, an incoming call, etc.
      const cameBack =
        (previousState === 'background' || previousState === 'inactive') &&
        nextState === 'active';
      previousState = nextState;
      if (cameBack && collecting) refreshAll().catch(error => console.warn('Refresh failed', error));
    });

    return () => sub.remove();
  }, [collecting, refreshAll]);

  const discoveredNotConnected = [...found.values()].filter(d => !rows.has(d.id));
  const connectedRows = [...rows.values()];
  const simulatedInSession = connectedRows.some(row => row.simulated);

  const finishTour = useCallback(() => {
    if (replayingTour) {
      setReplayingTour(false);
      return;
    }
    // Not awaited: a failed write only means the tour shows again next launch,
    // which should not block anyone from using the app now.
    Onboarding.markCompleted();
    setOnboarded(true);
  }, [replayingTour]);

  const styles = createStyles(theme);

  // Held back until the flag file has been read, so the main screen never flashes
  // in front of someone who has not seen the tour.
  if (onboarded === null) {
    return (
      <SafeAreaProvider>
        <View style={styles.screen} />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <StatusBar barStyle={theme.background === '#0B0B0D' ? 'light-content' : 'dark-content'} />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={[styles.row, styles.spaceBetween, styles.headerRow]}>
          <Text style={styles.title}>YAMS Mobile</Text>
          <IconButton
            glyph="☰"
            accessibilityLabel="Settings"
            onPress={() => setSettingsOpen(true)}
            showDot={simulatedDevice || keepAwake}
            dotTone={simulatedDevice ? 'warning' : 'primary'}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Session</Text>
          <View style={styles.row}>
            <View style={[styles.compoundInput, styles.flex1]}>
              <Text style={styles.prefixText}>sub-</Text>
              <TextInput
                style={[styles.compoundInputField, styles.flex1]}
                value={subNumber}
                onChangeText={text => setSubNumber(onlyDigits(text))}
                keyboardType="number-pad"
                maxLength={4}
                placeholder="XXXX"
                placeholderTextColor={theme.mutedText}
              />
            </View>
            <View style={[styles.compoundInput, styles.flex1]}>
              <Text style={styles.prefixText}>ses-</Text>
              <TextInput
                style={[styles.compoundInputField, styles.flex1]}
                value={sesNumber}
                onChangeText={text => setSesNumber(onlyDigits(text))}
                keyboardType="number-pad"
                maxLength={2}
                placeholder="YY"
                placeholderTextColor={theme.mutedText}
              />
            </View>
          </View>
          <View style={[styles.row, styles.encodingRow]}>
            <Text style={styles.mutedText}>Participant encoding</Text>
            <StatusChip label={String(participantEncoding)} />
          </View>
        </View>

        {simulatedDevice && (
          <View style={styles.demoBanner}>
            <Text style={styles.demoBannerText}>
              Demo mode is on.{' '}
              {simulatedInSession
                ? 'This session records synthetic data and is saved to a folder marked DEMO.'
                : 'A simulated wristband appears in scan results and its data is not real.'}
            </Text>
          </View>
        )}

        <View style={styles.row}>
          <AppButton
            title={scanning ? 'Stop scan' : 'Scan for MSense devices'}
            variant={scanning ? 'outline' : 'primary'}
            onPress={scanning ? stopScan : startScan}
            style={styles.flex1}
          />
          {scanning && <ActivityIndicator style={styles.scanSpinner} color={theme.primary} />}
        </View>

        {discoveredNotConnected.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Discovered</Text>
            {discoveredNotConnected.map(item => (
              <View key={item.id} style={[styles.card, styles.row, styles.spaceBetween, styles.wrapRow]}>
                <Text style={styles.discoveredTitle}>{item.name ?? item.id}</Text>
                <View style={[styles.row, styles.trailingGroup]}>
                  <StatusChip
                    label={item.rssi != null ? `${item.rssi} dBm` : '--'}
                    tone={rssiTone(item.rssi)}
                  />
                  <AppButton title="Connect" size="sm" onPress={() => connectTo(item)} />
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Devices</Text>
          {connectedRows.length === 0 && (
            <Text style={styles.mutedText}>
              No devices connected yet. YAMS Mobile collects from MotionSenSE Bluetooth
              wristbands — scan and connect above. Without the wristband hardware, open the
              ☰ menu at the top right and turn on “Simulated device” to try the app end to end.
            </Text>
          )}
          {connectedRows.map(item => (
            <View key={item.id} style={[styles.card, styles.deviceCard]}>
              <View style={[styles.row, styles.spaceBetween, styles.wrapRow]}>
                <Text style={styles.deviceTitle}>{item.name}</Text>
                <View style={[styles.row, styles.trailingGroup]}>
                  {item.simulated && <StatusChip label="Simulated" tone="warning" />}
                  <StatusChip
                    label={item.connected ? 'Connected' : 'Disconnected'}
                    tone={item.connected ? 'success' : 'destructive'}
                  />
                </View>
              </View>
              <Text style={styles.mutedText}>Battery: {item.battery ?? '--'}%</Text>
              {item.participantEncoding != null && (
                <View style={[styles.row, styles.encodingRow]}>
                  <Text style={styles.mutedText}>Participant encoding</Text>
                  <StatusChip
                    label={String(item.participantEncoding)}
                    // Flags a device collecting under a different sub/ses than what's
                    // currently entered above -- e.g. a device recovered mid-collection
                    // from another app/process, or from before the fields were last
                    // changed. Not necessarily wrong, but worth a researcher's attention
                    // before they trust this device's data as matching this session.
                    tone={item.participantEncoding !== participantEncoding ? 'destructive' : 'neutral'}
                  />
                </View>
              )}
              <Text style={styles.telemetry}>
                ENMO {item.lastSample?.enmo.toFixed(4) ?? '--'} · counter {item.lastSample?.counter ?? '--'}
                {'\n'}last sample{' '}
                {item.lastSample ? new Date(item.lastSample.unixTime * 1000).toISOString() : '--'}
              </Text>
              <AppButton
                title="Disconnect"
                size="sm"
                variant="outline"
                onPress={() => disconnectFrom(item.id)}
              />
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.bottomBar}>
        <AppButton
          title="Start"
          onPress={startAll}
          disabled={collecting || rows.size === 0}
          style={styles.flex1}
        />
        <AppButton
          title="Stop"
          variant="destructive"
          onPress={stopAll}
          disabled={!collecting}
          style={styles.flex1}
        />
      </View>

      <Modal
        testID="onboarding-tour"
        visible={onboarded === false || replayingTour}
        animationType="slide"
        // Android modals stop below the status bar by default; iOS ones do not.
        // Covering it on both keeps one set of inset maths correct everywhere.
        statusBarTranslucent
        onRequestClose={finishTour}>
        <OnboardingScreen onDone={finishTour} replay={replayingTour} />
      </Modal>

      <SettingsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        keepAwake={keepAwake}
        onKeepAwakeChange={setKeepAwake}
        simulatedDevice={simulatedDevice}
        onSimulatedDeviceChange={value => {
          toggleSimulatedDevice(value).catch(error =>
            console.warn('Could not toggle simulated device', error),
          );
        }}
        onShowTour={() => {
          setSettingsOpen(false);
          setReplayingTour(true);
        }}
      />
    </SafeAreaView>
    </SafeAreaProvider>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    scroll: { flex: 1, paddingHorizontal: 16 },
    scrollContent: { paddingBottom: 16 },
    title: { fontSize: 22, fontWeight: '700', color: theme.text },
    headerRow: { marginTop: 8, marginBottom: 16 },
    section: { marginBottom: 16, gap: 8 },
    sectionLabel: { fontSize: 13, fontWeight: '600', color: theme.mutedText, marginBottom: 8 },
    card: {
      backgroundColor: theme.card,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: 12,
      padding: 14,
      marginBottom: 12,
      gap: 8,
    },
    deviceCard: { gap: 6 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    spaceBetween: { justifyContent: 'space-between' },
    encodingRow: { marginTop: 4 },
    flex1: { flex: 1 },
    compoundInput: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 8,
      paddingHorizontal: 10,
    },
    prefixText: {
      fontSize: 15,
      fontWeight: '600',
      color: theme.mutedText,
    },
    compoundInputField: {
      paddingVertical: 8,
      color: theme.text,
    },
    text: { fontSize: 15, color: theme.text },
    mutedText: { fontSize: 13, color: theme.mutedText },
    hintText: { fontSize: 11, color: theme.mutedText, marginTop: 2, paddingRight: 8 },
    demoBanner: {
      backgroundColor: theme.warning,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 12,
    },
    demoBannerText: { fontSize: 13, fontWeight: '600', color: theme.warningText },
    // flexShrink 0 on both: a device name is an identifier and must never be
    // abbreviated. When the two no longer fit side by side, wrapRow moves the
    // chips onto their own line rather than squeezing either one.
    // 14 rather than 16: a 16-character name such as MSense4ECG-ABCDE needs ~455px
    // beside its status chips but only ~412px is free, so 16 forced the chips onto
    // a second line. At 14 both fit on one. wrapRow still catches anything longer,
    // so an unexpected name wraps rather than truncating.
    deviceTitle: { fontSize: 14, fontWeight: '600', color: theme.text, flexShrink: 0 },
    discoveredTitle: { fontSize: 14, color: theme.text, flexShrink: 0 },
    trailingGroup: { flexShrink: 0 },
    wrapRow: { flexWrap: 'wrap', rowGap: 8 },
    telemetry: {
      fontSize: 12,
      color: theme.mutedText,
      fontFamily: 'Courier',
    },
    scanSpinner: { marginLeft: 4 },
    bottomBar: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 16,
      borderTopWidth: 1,
      borderTopColor: theme.border,
    },
  });
}

export default App;
