import React, { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppButton } from '../components/AppButton';
import { Theme, useTheme } from '../theme';

interface Pane {
  title: string;
  body: string[];
}

/**
 * First-launch tour.
 *
 * Wording notes, because these strings are load-bearing:
 *
 * - "timing signal", never ENMO. Staff and participants do not read ENMO as
 *   anything, and the tour is not the place to teach it.
 * - "lined up in time", never "sync". People hear synchronisation as uploading
 *   to a cloud service. The app makes no network connections at all, and saying
 *   so plainly here doubles as the answer reviewers ask for.
 * - "beacon" is deliberately avoided: in Bluetooth it names a proximity and
 *   location technology, which is the opposite of what this app does with
 *   Bluetooth and the opposite of what its permission strings claim.
 *
 * Pane 2 names the menu glyph and the exact switch label. If either changes in
 * App.tsx, this text is wrong -- a test asserts they still match.
 */
const PANES: Pane[] = [
  {
    title: 'Collect from MotionSenSE wristbands',
    body: [
      'Each wristband sends a steady timing signal while it records. YAMS Mobile logs that signal against the phone’s clock, so a wristband’s recording can be lined up in time with the rest of your study data afterwards.',
      'Files are written to this phone’s Downloads folder. Nothing is uploaded, and the app makes no network connections.',
    ],
  },
  {
    title: 'No wristband to hand?',
    body: [
      'Open the ☰ menu at the top right and turn on Simulated device.',
      'A fake wristband appears in the scan list so you can try the whole app. Its data is not real and is saved to a folder marked DEMO.',
    ],
  },
  {
    title: 'Before you start',
    body:
      Platform.OS === 'android'
        ? [
            'YAMS Mobile uses Bluetooth to find wristbands, connect to them, and keep receiving their timing signal while your phone is in a pocket. Bluetooth is never used to determine your location.',
            'It also shows a notification while a session is running, so you can see at a glance that recording has not stopped.',
          ]
        : [
            'YAMS Mobile uses Bluetooth to find wristbands, connect to them, and keep receiving their timing signal while your phone is in a pocket. Bluetooth is never used to determine your location.',
          ],
  },
];

interface OnboardingScreenProps {
  /** Called when the tour is finished or skipped. Permissions are requested after this. */
  onDone: () => void;
  /** Replaying from the settings menu, rather than a first launch. */
  replay?: boolean;
}

export function OnboardingScreen({ onDone, replay = false }: OnboardingScreenProps): React.JSX.Element {
  const theme = useTheme();
  const styles = createStyles(theme);
  // Insets come from the hook rather than SafeAreaView: this screen renders inside
  // a Modal, and SafeAreaView derives its padding from the native view's frame,
  // which on iOS resolves to zero in the modal's separate root view. The Skip
  // button then lands under the status bar. The hook reads the provider's values
  // through React context, which does cross that boundary.
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);

  const pane = PANES[index];
  const isLast = index === PANES.length - 1;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.skipRow}>
        {!isLast && (
          <AppButton title={replay ? 'Close' : 'Skip'} variant="outline" size="sm" onPress={onDone} />
        )}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{pane.title}</Text>
        {pane.body.map(paragraph => (
          <Text key={paragraph} style={styles.body}>
            {paragraph}
          </Text>
        ))}
      </ScrollView>

      <View style={styles.dots}>
        {PANES.map((item, dotIndex) => (
          <View
            key={item.title}
            style={[styles.dot, dotIndex === index ? styles.dotActive : styles.dotIdle]}
          />
        ))}
      </View>

      <View style={styles.buttonRow}>
        {index > 0 && (
          <AppButton
            title="Back"
            variant="outline"
            onPress={() => setIndex(index - 1)}
            style={styles.flex1}
          />
        )}
        <AppButton
          // The last button triggers the permission prompts, so it should read as
          // a deliberate action rather than another page turn.
          title={isLast ? (replay ? 'Done' : 'Continue') : 'Next'}
          onPress={isLast ? onDone : () => setIndex(index + 1)}
          style={styles.flex1}
        />
      </View>
    </View>
  );
}

function createStyles(theme: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background, paddingHorizontal: 24 },
    skipRow: { flexDirection: 'row', justifyContent: 'flex-end', minHeight: 44 },
    content: { flexGrow: 1, justifyContent: 'center', gap: 16, paddingVertical: 24 },
    title: { fontSize: 26, fontWeight: '700', color: theme.text },
    body: { fontSize: 15, lineHeight: 22, color: theme.mutedText },
    dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingBottom: 20 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    dotActive: { backgroundColor: theme.primary },
    dotIdle: { backgroundColor: theme.border },
    buttonRow: { flexDirection: 'row', gap: 8 },
    flex1: { flex: 1 },
  });
}
