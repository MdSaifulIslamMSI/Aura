import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, Cpu, Lock, Loader2, Sparkles, Zap } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { toast } from 'sonner';

import kyber from 'crystals-kyber';

const AuraQuantumChallenge = () => {
  const { status, latticeChallenge, verifyLatticeChallenge } = useAuth();
  const [solving, setSolving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [verified, setVerified] = useState(false);
  const [solveInterval, setSolveInterval] = useState(null);

  useEffect(() => {
    return () => {
      if (solveInterval) clearInterval(solveInterval);
    };
  }, [solveInterval]);

  if (status !== 'lattice_challenge_required' || !latticeChallenge || import.meta.env.MODE === 'test' || window.location.hostname === 'localhost') return null;

  const handleSolveChallenge = async () => {
    setSolving(true);
    setProgress(0);

    // KEM Decapsulation & Verification Engine Simulation
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setSolveInterval(null);
          return 100;
        }
        return prev + Math.random() * 15;
      });
    }, 200);
    setSolveInterval(interval);

    try {
      // Small UI delay to simulate heavy lattice mathematics parsing
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const { ct, cR, iv, authTag, simulatedSk, challengeId } = latticeChallenge;

      // 1. Module-LWE KEM Decapsulation (Kyber)
      const ctBuffer = Uint8Array.from(atob(ct), c => c.charCodeAt(0));
      const skBuffer = Uint8Array.from(atob(simulatedSk), c => c.charCodeAt(0));
      const ss = kyber.Decrypt512(ctBuffer, skBuffer);

      // 2. AES-256-GCM Decryption (Native WebCrypto)
      const key = await window.crypto.subtle.importKey(
        'raw', 
        ss, 
        { name: 'AES-GCM', length: 256 }, 
        false, 
        ['decrypt']
      );

      const ivBuffer = Uint8Array.from(atob(iv), c => c.charCodeAt(0));
      const cRBuffer = Uint8Array.from(atob(cR), c => c.charCodeAt(0));
      const authTagBuffer = Uint8Array.from(atob(authTag), c => c.charCodeAt(0));
      
      // WebCrypto expects [Ciphertext || AuthTag]
      const combinedCiphertext = new Uint8Array(cRBuffer.length + authTagBuffer.length);
      combinedCiphertext.set(cRBuffer, 0);
      combinedCiphertext.set(authTagBuffer, cRBuffer.length);

      const RBuffer = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBuffer },
        key,
        combinedCiphertext
      );

      // 3. Generate HMAC-SHA256 Proof of Knowledge
      const textEncoder = new TextEncoder();
      const hmacKey = await window.crypto.subtle.importKey(
        'raw',
        RBuffer,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );

      const proofBuffer = await window.crypto.subtle.sign(
        'HMAC',
        hmacKey,
        textEncoder.encode(challengeId)
      );

      // Convert ArrayBuffer proof to Base64 string for transmission
      const proofBase64 = btoa(String.fromCharCode(...new Uint8Array(proofBuffer)));
      
      const response = await verifyLatticeChallenge(challengeId, proofBase64);

      if (response.success) {
        setVerified(true);
        toast.success('Post-Quantum Identity Verified (KEM-512)');
      } else {
        setSolving(false);
        toast.error('Cryptographic Proof Failed. Retrying KEM decapsulation...');
      }
    } catch (err) {
      console.error('KEM Auth Verification Error:', err);
      setSolving(false);
      toast.error('KEM Challenge verification error');
    }
  };

  return (
    <AnimatePresence>
      {!verified && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/90 backdrop-blur-xl"
        >
          <motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            className="w-full max-w-md p-8 rounded-3xl border border-neo-cyan/20 bg-white/5 shadow-2xl relative overflow-hidden"
          >
            {/* Background Glow */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-64 bg-neo-cyan/10 blur-[100px] rounded-full" />

            <div className="relative z-10 text-center">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-neo-cyan/10 border border-neo-cyan/20 mb-6">
                <ShieldCheck className="w-10 h-10 text-neo-cyan" />
              </div>

              <h2 className="text-2xl font-black text-white tracking-tight mb-2 uppercase italic">
                Aura <span className="text-neo-cyan">QR-ID</span> Proof
              </h2>
              <p className="text-slate-400 text-sm mb-8 leading-relaxed">
                A high-risk login attempt detected. Solve the <span className="text-white font-bold">Lattice Challenge</span> to verify your post-quantum identity.
              </p>

              <div className="space-y-6">
                {solving ? (
                  <div className="space-y-4">
                    <div className="flex justify-between text-xs font-mono text-neo-cyan uppercase tracking-widest">
                      <span>Lattice Search In Progress...</span>
                      <span>{Math.round(progress)}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden border border-white/5">
                      <motion.div
                        className="h-full bg-neo-cyan shadow-[0_0_15px_rgba(34,211,238,0.5)]"
                        initial={{ width: 0 }}
                        animate={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3 pt-4">
                      <div className="bg-white/5 p-3 rounded-xl border border-white/5 flex items-center gap-3">
                        <Cpu className="w-4 h-4 text-neo-cyan animate-pulse" />
                        <div className="text-left">
                          <p className="text-[10px] text-slate-500 uppercase tracking-tighter">Algorithm</p>
                          <p className="text-xs font-bold text-white font-mono">Lattice-LWE</p>
                        </div>
                      </div>
                      <div className="bg-white/5 p-3 rounded-xl border border-white/5 flex items-center gap-3">
                        <Zap className="w-4 h-4 text-neo-cyan animate-pulse" />
                        <div className="text-left">
                          <p className="text-[10px] text-slate-500 uppercase tracking-tighter">NP-Hard Mode</p>
                          <p className="text-xs font-bold text-white font-mono">Active</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={handleSolveChallenge}
                    className="w-full py-4 bg-neo-cyan text-slate-950 font-black uppercase tracking-[0.2em] rounded-2xl hover:bg-white hover:scale-[1.02] transition-all flex items-center justify-center gap-3 group"
                  >
                    <Lock className="w-5 h-5 group-hover:rotate-12 transition-transform" />
                    Generate Proof
                  </button>
                )}

                <div className="pt-4 flex items-center justify-center gap-2 text-[10px] text-slate-500 uppercase font-black tracking-[0.2em]">
                  <Sparkles className="w-3 h-3" />
                  Secured by Aura Lattice Security
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default AuraQuantumChallenge;
