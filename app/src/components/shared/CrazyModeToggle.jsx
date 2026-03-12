import { Rocket, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCrazyMode } from '@/context/CrazyModeContext';
import { createPortal } from 'react-dom';

const ORBS = [
  { className: 'crazy-orb crazy-orb-1' },
  { className: 'crazy-orb crazy-orb-2' },
  { className: 'crazy-orb crazy-orb-3' },
  { className: 'crazy-orb crazy-orb-4' },
];

const CrazyModeToggle = () => {
  const { crazyModeEnabled, toggleCrazyMode } = useCrazyMode();

  const portalTarget = typeof document !== 'undefined' ? document.body : null;
  if (!portalTarget) return null;

  return createPortal(
    <>
      <div
        aria-hidden="true"
        className={cn('crazy-mode-layer z-[2147481000]', crazyModeEnabled && 'is-active')}
      >
        <div className="crazy-grid" />
        <div className="crazy-stars" />
        {ORBS.map((orb) => (
          <div key={orb.className} className={orb.className} />
        ))}
      </div>

      <button
        type="button"
        onClick={toggleCrazyMode}
        className={cn(
          'rounded-2xl border px-4 py-3 transition-all duration-300',
          'flex items-center gap-2 text-xs sm:text-sm font-black uppercase tracking-wider shadow-[0_8px_28px_rgba(2,6,23,0.45)]',
          crazyModeEnabled
            ? 'border-fuchsia-300/60 bg-gradient-to-r from-fuchsia-600/80 via-cyan-500/80 to-emerald-500/80 text-white hover:scale-[1.03]'
            : 'border-white/15 bg-zinc-950/70 text-slate-200 hover:border-cyan-300/55 hover:text-cyan-100'
        )}
        style={{
          position: 'fixed',
          left: '16px',
          bottom: '16px',
          zIndex: 2147483601,
        }}
        aria-pressed={crazyModeEnabled}
        aria-label={`Hyperdrive mode ${crazyModeEnabled ? 'on' : 'off'}. Toggle with Ctrl+Shift+H.`}
        title={`Hyperdrive ${crazyModeEnabled ? 'ON' : 'OFF'} (Ctrl+Shift+H)`}
        data-aura-hyperdrive-launcher="true"
      >
        {crazyModeEnabled ? <Rocket className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
        <span>{crazyModeEnabled ? 'Hyperdrive On' : 'Hyperdrive'}</span>
      </button>
    </>,
    portalTarget
  );
};

export default CrazyModeToggle;
