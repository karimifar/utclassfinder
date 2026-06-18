import Constants from 'expo-constants';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../src/auth/AuthContext';
import { colors, radius, spacing } from '../src/theme';

const authEnabled = Boolean(Constants.expoConfig?.extra?.utOauth?.enabled);

export default function Login() {
  const { signIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPress = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.wordmark}>UT Class Finder</Text>
        <Text style={styles.tagline}>Type a room code. Get there on time.</Text>
      </View>

      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={onPress}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.buttonText}>Sign in with UT EID</Text>
          )}
        </Pressable>

        {!authEnabled && (
          <Text style={styles.note}>
            Demo mode — UT SSO is not yet connected. Sign-in creates a local
            session so you can try the app.
          </Text>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  wordmark: { fontSize: 34, fontWeight: '800', color: colors.burntOrange },
  tagline: { marginTop: spacing.sm, fontSize: 16, color: colors.slate },
  footer: { gap: spacing.md },
  button: {
    backgroundColor: colors.burntOrange,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  buttonPressed: { backgroundColor: colors.burntOrangeDark },
  buttonText: { color: colors.white, fontSize: 17, fontWeight: '700' },
  note: { color: colors.mist, fontSize: 13, textAlign: 'center' },
  error: { color: '#C0392B', fontSize: 14, textAlign: 'center' },
});
