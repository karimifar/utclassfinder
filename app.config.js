// Expo app config. Reads secrets from the environment (.env) so nothing is
// committed. See .env.example for the variables you need to set.

// UT Enterprise Authentication (Shibboleth IdP with the OIDC OP plugin).
const UT_OIDC_BASE = 'https://enterprise.login.utexas.edu';

module.exports = ({ config }) => ({
  ...config,
  owner: 'karimifar',
  name: 'UT Class Finder',
  slug: 'utclassfinder',
  scheme: 'utclassfinder', // OAuth redirect: utclassfinder://redirect
  version: '0.1.0',
  icon: './assets/Visuals/icon.png',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    // Must match the App Store Connect app record (created by UT admin).
    bundleIdentifier: 'com.utaustin.UTClassFinder',
    config: {
      // HTTPS only — exempt from export compliance. Pre-answers the encryption
      // question App Store Connect asks on every TestFlight upload.
      usesNonExemptEncryption: false,
    },
  },
  android: {
    // Kept in the same namespace as iOS; lowercase per Android convention.
    package: 'com.utaustin.utclassfinder',
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
    // UT EID / UT SSO OIDC config. The client is registered with UT IAM as a
    // public (native) client: no secret, PKCE required, redirect
    // utclassfinder://redirect. Endpoints default to UT's Shibboleth OIDC OP;
    // override via .env if IAM moves them.
    utOauth: {
      enabled: process.env.UT_OAUTH_ENABLED === 'true',
      clientId: process.env.UT_OAUTH_CLIENT_ID || 'cola-class-finder-oidc',
      issuer: process.env.UT_OAUTH_ISSUER || UT_OIDC_BASE,
      authorizationEndpoint:
        process.env.UT_OAUTH_AUTHORIZATION_ENDPOINT || `${UT_OIDC_BASE}/idp/profile/oidc/authorize`,
      tokenEndpoint:
        process.env.UT_OAUTH_TOKEN_ENDPOINT || `${UT_OIDC_BASE}/idp/profile/oidc/token`,
      userInfoEndpoint:
        process.env.UT_OAUTH_USERINFO_ENDPOINT || `${UT_OIDC_BASE}/idp/profile/oidc/userinfo`,
      // Registered scopes. utexas_profile carries the UT EID claim.
      scopes: (process.env.UT_OAUTH_SCOPES || 'openid profile utexas_profile').split(/[\s,]+/).filter(Boolean),
    },
    router: {},
    eas: { projectId: '756f5fba-c920-461c-978d-55a2a765fa24' },
  },
  
});
