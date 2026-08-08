/**
 * YAMS Mobile
 * Android-first MotionSenSE control: connect, start/stop collection, and
 * timestamp+save ENMO notifications locally. Mirrors yams/msense_collector.py.
 *
 * @format
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Device } from 'react-native-ble-plx';
import { activateKeepAwake, deactivateKeepAwake } from '@sayem314/react-native-keep-awake';

import { AppButton } from './src/components/AppButton';
import { StatusChip, Tone } from './src/components/StatusChip';
import { BleController } from './src/ble/BleController';
import { EnmoSample } from './src/ble/samples';
import { encodeParticipant } from './src/participant';
import { BackgroundSession } from './src/platform/backgroundSession';
import { SessionLogger } from './src/storage/SessionLogger';
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
}

function App(): React.JSX.Element {
  const theme = useTheme();

  const controllerRef = useRef<BleController | null>(null);
  const loggersRef = useRef<Map<string, SessionLogger>>(new Map());

  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<Map<string, Device>>(new Map());
  const [rows, setRows] = useState<Map<string, DeviceRow>>(new Map());
  const [subNumber, setSubNumber] = useState('1000');
  const [sesNumber, setSesNumber] = useState('00');
  const [collecting, setCollecting] = useState(false);
  const [keepAwake, setKeepAwake] = useState(false);

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
    const controller = new BleController();
    controllerRef.current = controller;
    controller.requestPermissions();
    BackgroundSession.requestPermission();

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
            connected: true,
            battery: null,
            lastSample: null,
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
  }, []);

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

  const connectTo = async (device: Device) => {
    await controllerRef.current?.connect(device);
    setRows(prev => {
      const next = new Map(prev);
      next.set(device.id, {
        id: device.id,
        name: device.name ?? device.id,
        connected: true,
        battery: null,
        lastSample: null,
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

    const sessionDir = await SessionLogger.newSessionDir();
    const devices = [...rows.values()].map(row => ({ id: row.id, name: row.name }));
    const startedAt = new Date().toISOString();

    await SessionLogger.writeSessionInfo(sessionDir, {
      subjectId: subId,
      sessionId: sesId,
      participantEncoding,
      devices,
      startedAt,
    });

    await SessionState.save({
      sessionDir,
      subjectId: subId,
      sessionId: sesId,
      participantEncoding,
      devices: devices.map(device => ({ ...device, clockOriginUnixSec: null })),
      startedAt,
    });

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
    BackgroundSession.stop();
    setCollecting(false);
  };

  const discoveredNotConnected = [...found.values()].filter(d => !rows.has(d.id));
  const connectedRows = [...rows.values()];

  const styles = createStyles(theme);

  return (
    <SafeAreaProvider>
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <StatusBar barStyle={theme.background === '#0B0B0D' ? 'light-content' : 'dark-content'} />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>YAMS Mobile</Text>

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
          <View style={[styles.row, styles.spaceBetween, styles.encodingRow]}>
            <Text style={styles.mutedText}>Keep screen awake</Text>
            <Switch
              value={keepAwake}
              onValueChange={setKeepAwake}
              trackColor={{ false: theme.border, true: theme.primary }}
              thumbColor={theme.card}
            />
          </View>
        </View>

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
              <View key={item.id} style={[styles.card, styles.row, styles.spaceBetween]}>
                <Text style={[styles.text, styles.flex1]}>{item.name ?? item.id}</Text>
                <StatusChip
                  label={item.rssi != null ? `${item.rssi} dBm` : '--'}
                  tone={rssiTone(item.rssi)}
                />
                <AppButton title="Connect" size="sm" onPress={() => connectTo(item)} />
              </View>
            ))}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Devices</Text>
          {connectedRows.length === 0 && (
            <Text style={styles.mutedText}>No devices connected yet — scan and connect above.</Text>
          )}
          {connectedRows.map(item => (
            <View key={item.id} style={[styles.card, styles.deviceCard]}>
              <View style={[styles.row, styles.spaceBetween]}>
                <Text style={styles.deviceTitle}>{item.name}</Text>
                <StatusChip
                  label={item.connected ? 'Connected' : 'Disconnected'}
                  tone={item.connected ? 'success' : 'destructive'}
                />
              </View>
              <Text style={styles.mutedText}>Battery: {item.battery ?? '--'}%</Text>
              <Text style={styles.telemetry}>
                ENMO {item.lastSample?.enmo.toFixed(4) ?? '--'} · counter {item.lastSample?.counter ?? '--'}
                {'\n'}device time{' '}
                {item.lastSample ? new Date(item.lastSample.deviceTime * 1000).toISOString() : '--'}
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
    </SafeAreaView>
    </SafeAreaProvider>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    scroll: { flex: 1, paddingHorizontal: 16 },
    scrollContent: { paddingBottom: 16 },
    title: { fontSize: 22, fontWeight: '700', color: theme.text, marginTop: 8, marginBottom: 16 },
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
    deviceTitle: { fontSize: 16, fontWeight: '600', color: theme.text },
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
