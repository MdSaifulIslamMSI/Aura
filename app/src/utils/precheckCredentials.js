import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { firebaseConfig, assertFirebaseReady } from '@/config/firebase';

const createTempAppName = () => `aura-precheck-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const verifyCredentialsWithoutSession = async (email, password) => {
  assertFirebaseReady('Credential verification');
  const tempApp = initializeApp(firebaseConfig, createTempAppName());
  const tempAuth = getAuth(tempApp);

  try {
    const credential = await signInWithEmailAndPassword(tempAuth, email, password);
    // Password sign-in already returns a fresh ID token. Forcing an immediate
    // refresh adds a second Secure Token request that can fail after the
    // credential itself was accepted, leaving the login flow in a false error
    // state before either OTP is sent.
    const credentialProofToken = await credential.user.getIdToken();
    return {
      credentialProofToken,
      uid: credential.user.uid,
      email: credential.user.email || email,
    };
  } finally {
    try {
      if (tempAuth.currentUser) {
        await signOut(tempAuth);
      }
    } catch {
      // best-effort cleanup
    }
    await deleteApp(tempApp);
  }
};
