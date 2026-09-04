import Constants from 'expo-constants';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../src/auth/AuthContext';
import { DEBUG_TOOLS_ENABLED } from '../src/debug';
import { colors, radius, spacing } from '../src/theme';

const authEnabled = Boolean(Constants.expoConfig?.extra?.utOauth?.enabled);

export default function Login() {
  const { signIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPress = async (forceMock = false) => {
    setBusy(true);
    setError(null);
    try {
      await signIn(forceMock ? { forceMock: true } : undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.hero}>
        <Image
          source={require('../assets/Visuals/logo.png')}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="Classroom Finder"
        />
        <Text style={styles.tagline}>Navigate UT Austin Campus</Text>
      </View>

      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={() => onPress()}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.buttonText}>Sign in with UT EID</Text>
          )}
        </Pressable>

        {/* Test builds only. DEBUG_TOOLS is set on the testflight profile and
            never on production, so this cannot render in an App Store build —
            the same switch that guards the simulated-origin toggle. */}
        {authEnabled && DEBUG_TOOLS_ENABLED && (
          <Pressable onPress={() => onPress(true)} disabled={busy} hitSlop={8}>
            {({ pressed }) => (
              <Text style={[styles.skip, pressed && styles.skipPressed]}>
                Continue without UT EID (test build)
              </Text>
            )}
          </Pressable>
        )}

        {!authEnabled && (
          <Text style={styles.note}>
            Demo mode — UT SSO is not yet connected. Sign-in creates a local
            session so you can try the app.
          </Text>
        )}
        {error && <Text style={styles.error}>{error}</Text>}

        <Image
          source={require('../assets/Visuals/cola.png')}
          style={styles.colaLogo}
          resizeMode="contain"
          accessibilityLabel="Texas Liberal Arts"
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  hero: { flex: 1, alignItems: 'center', paddingTop: 96, gap: spacing.xl },
  logo: { width: 210, height: 73 },
  tagline: { fontSize: 16, color: colors.mist },
  footer: { gap: spacing.md, alignItems: 'center' },
  button: {
    alignSelf: 'stretch',
    backgroundColor: colors.burntOrange,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  buttonPressed: { backgroundColor: colors.burntOrangeDark },
  buttonText: { color: colors.white, fontSize: 17, fontWeight: '700' },
  note: { color: colors.mist, fontSize: 13, textAlign: 'center' },
  // Deliberately understated: a test affordance, not a second way to sign in.
  skip: {
    color: colors.slate,
    fontSize: 14,
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
  skipPressed: { color: colors.ink },
  error: { color: '#C0392B', fontSize: 14, textAlign: 'center' },
  colaLogo: { width: 96, height: 74, marginTop: spacing.sm },
});
