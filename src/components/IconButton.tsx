import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme';

interface IconButtonProps {
  /** A glyph rather than an icon font -- the app has no icon dependency and does not need one. */
  glyph: string;
  accessibilityLabel: string;
  onPress: () => void;
  /** Draws a dot in the corner, for state the button's panel would otherwise hide. */
  showDot?: boolean;
  dotTone?: 'primary' | 'warning';
}

export function IconButton({
  glyph,
  accessibilityLabel,
  onPress,
  showDot = false,
  dotTone = 'primary',
}: IconButtonProps): React.JSX.Element {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={({ pressed }) => [styles.base, pressed && styles.pressed]}>
      <Text style={[styles.glyph, { color: theme.text }]}>{glyph}</Text>
      {showDot && (
        <View
          style={[
            styles.dot,
            {
              backgroundColor: dotTone === 'warning' ? theme.warning : theme.primary,
              borderColor: theme.background,
            },
          ]}
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    // 44x44 is the smallest comfortable touch target on both platforms.
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
  glyph: { fontSize: 22, fontWeight: '600' },
  dot: {
    position: 'absolute',
    top: 6,
    right: 4,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
});
