import React from 'react';
import { Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Theme, useTheme } from '../theme';

interface SettingsSheetProps {
  visible: boolean;
  onClose: () => void;
  keepAwake: boolean;
  onKeepAwakeChange: (value: boolean) => void;
  simulatedDevice: boolean;
  onSimulatedDeviceChange: (value: boolean) => void;
  /** Replays the first-launch tour. Someone who skipped it needs a way back. */
  onShowTour: () => void;
}

/**
 * App configuration, as a bottom sheet.
 *
 * Purely presentational -- every value and setter is passed in, so App.tsx stays
 * the single owner of this state. These settings live behind a menu because they
 * are set rarely; the session fields a researcher edits every run stay on screen.
 *
 * Note that nothing here is persisted, deliberately. See the simulated-device
 * state in App.tsx.
 */
export function SettingsSheet({
  visible,
  onClose,
  keepAwake,
  onKeepAwakeChange,
  simulatedDevice,
  onSimulatedDeviceChange,
  onShowTour,
}: SettingsSheetProps): React.JSX.Element {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const styles = createStyles(theme);

  return (
    <Modal
      testID="settings-sheet"
      visible={visible}
      transparent
      animationType="slide"
      // Without this the Android back button cannot dismiss the sheet.
      onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close settings" />

      <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.grabber} />
        <Text style={styles.title}>Settings</Text>

        <View style={styles.settingRow}>
          <View style={styles.settingLabel}>
            <Text style={styles.settingName}>Keep screen awake</Text>
            <Text style={styles.settingHint}>
              Stops the phone sleeping during a long collection.
            </Text>
          </View>
          <Switch
            value={keepAwake}
            onValueChange={onKeepAwakeChange}
            trackColor={{ false: theme.border, true: theme.primary }}
            thumbColor={theme.card}
          />
        </View>

        <View style={styles.settingRow}>
          <View style={styles.settingLabel}>
            <Text style={styles.settingName}>Simulated device</Text>
            <Text style={styles.settingHint}>
              Adds a fake wristband so the app can be tried without hardware. Its data is not
              real and is saved to a folder marked DEMO.
            </Text>
          </View>
          <Switch
            value={simulatedDevice}
            onValueChange={onSimulatedDeviceChange}
            trackColor={{ false: theme.border, true: theme.primary }}
            thumbColor={theme.card}
          />
        </View>

        <Pressable
          onPress={onShowTour}
          accessibilityRole="button"
          style={({ pressed }) => [styles.settingRow, pressed && styles.pressed]}>
          <View style={styles.settingLabel}>
            <Text style={styles.settingName}>How it works</Text>
            <Text style={styles.settingHint}>Show the introduction again.</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function createStyles(theme: Theme) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
    sheet: {
      backgroundColor: theme.card,
      borderTopWidth: 1,
      borderColor: theme.border,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingHorizontal: 16,
      paddingTop: 8,
      gap: 4,
    },
    grabber: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.border,
      marginBottom: 12,
    },
    title: { fontSize: 18, fontWeight: '700', color: theme.text, marginBottom: 8 },
    settingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingVertical: 12,
      borderTopWidth: 1,
      borderColor: theme.border,
    },
    settingLabel: { flex: 1 },
    settingName: { fontSize: 15, color: theme.text },
    settingHint: { fontSize: 11, color: theme.mutedText, marginTop: 2 },
    chevron: { fontSize: 22, color: theme.mutedText },
    pressed: { opacity: 0.6 },
  });
}
