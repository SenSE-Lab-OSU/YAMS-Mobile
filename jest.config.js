module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // The preset only transforms react-native and @react-native* packages. These
  // ship untranspiled ESM, so they have to be transformed too or any test that
  // reaches App.tsx fails to parse them.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@sayem314/react-native-keep-awake|react-native-safe-area-context)/)',
  ],
};
