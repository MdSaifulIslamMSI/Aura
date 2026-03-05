import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { firebaseConfig } from '@/config/firebase';

const createTempAppName = () => `aura-precheck-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const verifyCredentialsWithoutSession = async (email, password) => {
  const tempApp = initializeApp(firebaseConfig, createTempAppName());
  const tempAuth = getAuth(tempApp);

  try {
    const credential = await signInWithEmailAndPassword(tempAuth, email, password);
    const credentialProofToken = await credential.user.getIdToken(true);
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
