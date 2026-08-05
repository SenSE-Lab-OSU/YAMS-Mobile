import { useColorScheme } from 'react-native';

export interface Theme {
  background: string;
  card: string;
  border: string;
  text: string;
  mutedText: string;
  primary: string;
  primaryText: string;
  destructive: string;
  destructiveText: string;
  success: string;
  successText: string;
  warning: string;
  warningText: string;
  chipBackground: string;
  chipText: string;
}

const light: Theme = {
  background: '#F2F2F7',
  card: '#FFFFFF',
  border: '#E1E1E6',
  text: '#111114',
  mutedText: '#6B6B72',
  primary: '#2563EB',
  primaryText: '#FFFFFF',
  destructive: '#DC2626',
  destructiveText: '#FFFFFF',
  success: '#16A34A',
  successText: '#FFFFFF',
  warning: '#D97706',
  warningText: '#FFFFFF',
  chipBackground: '#E9E9F0',
  chipText: '#3A3A42',
};

const dark: Theme = {
  background: '#0B0B0D',
  card: '#1C1C1F',
  border: '#2E2E33',
  text: '#F2F2F3',
  mutedText: '#9A9AA1',
  primary: '#3B82F6',
  primaryText: '#FFFFFF',
  destructive: '#EF4444',
  destructiveText: '#FFFFFF',
  success: '#22C55E',
  successText: '#0B0B0D',
  warning: '#F59E0B',
  warningText: '#0B0B0D',
  chipBackground: '#2A2A2E',
  chipText: '#D4D4D8',
};

export function getTheme(isDarkMode: boolean): Theme {
  return isDarkMode ? dark : light;
}

export function useTheme(): Theme {
  const isDarkMode = useColorScheme() === 'dark';
  return getTheme(isDarkMode);
}
