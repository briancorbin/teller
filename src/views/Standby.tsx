import { useState } from 'react';
import type { Display } from '../../worker/types';
import { setDmKey } from '../lib/api';
import { btnPrimary, input } from '../lib/ui';

/**
 * A screen waiting to be told what it is.
 *
 * The code is the whole interface, and it's sized to be read across a
 * lit room — the DM types it into their console and this screen becomes
 * part of the table. Nothing here is a control: a screen never chooses
 * its own job.
 */
export function Standby({
  display,
  onUnlock,
}: {
  display: Display | null;
  onUnlock: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [key, setKey] = useState('');

  const unlock = () => {
    if (!key.trim()) return;
    setDmKey(key.trim());
    onUnlock();
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8 text-center">
      <h1 className="font-serif text-3xl text-stone-400">teller</h1>

      {display?.code ? (
        <div className="space-y-3">
          <p className="text-stone-500">Type this into your console</p>
          <p className="font-mono text-[clamp(3rem,18vw,9rem)] leading-none tracking-[0.15em] text-stone-100">
            {display.code}
          </p>
        </div>
      ) : (
        <p className="text-stone-500">Waking up…</p>
      )}

      {/* The one asymmetry: somebody has to hold the key first. */}
      {asking ? (
        <div className="flex w-full max-w-xs gap-2">
          <input
            autoFocus
            className={`${input} flex-1`}
            type="password"
            placeholder="DM key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && unlock()}
          />
          <button className={btnPrimary} onClick={unlock}>
            unlock
          </button>
        </div>
      ) : (
        <button
          className="text-sm text-stone-700 transition-colors hover:text-stone-400"
          onClick={() => setAsking(true)}
        >
          I'm the teller
        </button>
      )}
    </main>
  );
}

/**
 * "Which one of you is Screen 3?" — a full-bleed flash the console can
 * trigger on one panel. Console-driven and arriving over SSE, which is
 * how every setting reaches a passive surface.
 */
export function IdentifyFlash({ display }: { display: Display }) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4"
      style={{ backgroundColor: display.color || '#f59e0b' }}
    >
      <span className="font-serif text-[clamp(2rem,10vw,6rem)] leading-none text-stone-950">
        {display.name || 'this screen'}
      </span>
      <span className="font-mono text-sm uppercase tracking-widest text-stone-900/70">
        {display.role}
      </span>
    </div>
  );
}

/** Claimed, but not yet given a job. */
export function BlankScreen({ display }: { display: Display }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-950 p-8">
      <span className="font-serif text-2xl text-stone-800">{display.name}</span>
    </main>
  );
}
