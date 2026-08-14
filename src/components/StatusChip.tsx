import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme';

export type Tone = 'neutral' | 'success' | 'warning' | 'destructive';

interface StatusChipProps {
  label: string;
  tone?: Tone;
}

export function StatusChip({
  label,
  tone = 'neutral',
}: StatusChipProps): React.JSX.Element {
  const theme = useTheme();

  const background =
    tone === 'success'
      ? theme.success
      : tone === 'warning'
      ? theme.warning
      : tone === 'destructive'
      ? theme.destructive
      : theme.chipBackground;
  const color =
    tone === 'success'
      ? theme.successText
      : tone === 'warning'
      ? theme.warningText
      : tone === 'destructive'
      ? theme.destructiveText
      : theme.chipText;

  return (
    <View style={[styles.chip, { backgroundColor: background }]}>
      <Text style={[styles.text, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 10,
    // 'center', not 'flex-start': alignSelf overrides the parent's alignItems, so
    // flex-start pinned the chip to the top of its row and left it sitting visibly
    // above the device name and Connect button, which centre themselves. Still not
    // 'stretch' (the flex default), which would blow the chip out to the full width
    // of a column parent.
    alignSelf: 'center',
    // A chip states connection status; it must stay legible whatever the device
    // name beside it does.
    flexShrink: 0,
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
  },
});
