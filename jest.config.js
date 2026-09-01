/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // jest-expo's default transformIgnorePatterns leaves most node_modules
  // untransformed; React Native packages ship untranspiled ESM, so they have to
  // be allowed through.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@rnmapbox/.*)',
  ],
  testMatch: ['**/__tests__/**/*.test.ts?(x)'],
};
