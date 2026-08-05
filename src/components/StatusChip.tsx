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
      <Text style={[styles.text, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 10,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
  },
});
