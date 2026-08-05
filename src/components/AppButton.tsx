import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, ViewStyle } from 'react-native';

import { useTheme } from '../theme';

type Variant = 'primary' | 'outline' | 'destructive';
type Size = 'default' | 'sm';

interface AppButtonProps {
  title: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

export function AppButton({
  title,
  onPress,
  variant = 'primary',
  size = 'default',
  disabled = false,
  loading = false,
  style,
}: AppButtonProps): React.JSX.Element {
  const theme = useTheme();
  const isDisabled = disabled || loading;

  const fill = variant === 'primary' ? theme.primary : variant === 'destructive' ? theme.destructive : 'transparent';
  const textColor =
    variant === 'primary' ? theme.primaryText : variant === 'destructive' ? theme.destructiveText : theme.text;
  const borderColor = variant === 'outline' ? theme.border : fill;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        size === 'sm' ? styles.sm : styles.default,
        { backgroundColor: fill, borderColor },
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : (
        <Text style={[styles.text, size === 'sm' && styles.textSm, { color: textColor }]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  default: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  sm: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.75,
  },
  text: {
    fontSize: 15,
    fontWeight: '600',
  },
  textSm: {
    fontSize: 13,
  },
});
