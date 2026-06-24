// Expo app config. Reads secrets from the environment (.env) so nothing is
// committed. See .env.example for the variables you need to set.
module.exports = ({ config }) => ({
  ...config,
  name: 'UT Class Finder',
  slug: 'utclassfinder',
  scheme: 'utclassfinder', // OAuth redirect: utclassfinder://redirect
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'edu.utexas.cola.classfinder',
  },
  android: {
    package: 'edu.utexas.cola.classfinder',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      '@rnmapbox/maps',
      {
        // Secret download token (sk....) with DOWNLOADS:READ scope — build-time only.
        RNMapboxMapsDownloadToken: process.env.MAPBOX_DOWNLOAD_TOKEN,
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'UT Class Finder uses your location to orient the campus map to where you are.',
      },
    ],
  ],
  extra: {
    // Public token (pk....) used by the map at runtime.
    mapboxAccessToken: process.env.MAPBOX_ACCESS_TOKEN,
    // UT EID / UT SSO OAuth config — fill in once UT ITS provides the endpoints.
    utOauth: {
      enabled: process.env.UT_OAUTH_ENABLED === 'true',
      clientId: process.env.UT_OAUTH_CLIENT_ID,
      authorizationEndpoint: process.env.UT_OAUTH_AUTHORIZATION_ENDPOINT,
      tokenEndpoint: process.env.UT_OAUTH_TOKEN_ENDPOINT,
    },
    router: {},
    eas: { projectId: '756f5fba-c920-461c-978d-55a2a765fa24' },
  },
});
