import { Redirect } from 'expo-router';

// The AuthGate in _layout.tsx handles redirecting unauthenticated users to
// /login, so the authenticated entry point is the search screen.
export default function Index() {
  return <Redirect href="/search" />;
}
