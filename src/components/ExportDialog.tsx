import { useState } from 'react';
import { api } from '../lib/api';
import { btn, btnPrimary, sectionLabel } from '../lib/ui';

// WHAT GOES IN THE FILE — asked, not assumed.
//
// teller used to decide: the export dropped the creatures on the table
// because "a bundle's job is to start a table, not to preserve one".
// That's a reasonable thing for a PERSON to want and a bad thing for a
// format to insist on, and it meant the only export the console could
// produce was a backup with the fight missing from it.
//
// Brian, 2026-08-16: "you get to decide WHAT gets included in the
// export. Full backup with entire undo scaffolding since the dawn of
// time? sure, totally your call. Just want the maps and encounter
// scaffolding? also cool."
//
// So everything is on, and every part of it can come off. The two
// presets aren't modes — they're just both ends of the same switches,
// there so the common cases are one tap instead of five.

type Section = {
  key: string;
  label: string;
  hint: string;
  /** Roughly how much this one weighs, for the choice to be informed. */
  heft?: 'heavy' | 'light';
};

const SECTIONS: Section[] = [
  {
    key: 'assets',
    label: 'Map art and handouts',
    hint: 'the images themselves — usually most of the file',
    heft: 'heavy',
  },
  {
    key: 'live',
    label: 'The fight in progress',
    hint: 'creatures on the table right now, with their wounds and conditions',
  },
  {
    key: 'events',
    label: 'History',
    hint: 'what happened here — turns resolved, foes deployed, tables cleared',
  },
  {
    key: 'undo',
    label: 'Undo history',
    hint: 'the snapshot behind every edit; the bulk of the log, and it only means anything on this host',
    heft: 'heavy',
  },
  {
    key: 'books',
    label: 'Book references',
    hint: 'which rulebooks this campaign expects — named, never copied',
    heft: 'light',
  },
];

/** Everything but the two heavy, host-specific parts. */
const SNAPSHOT = ['undo', 'events'];

export function ExportDialog({
  campaignId,
  name,
  onClose,
  onError,
}: {
  campaignId: string;
  name: string;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const [without, setWithout] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const toggle = (key: string) =>
    setWithout((w) => (w.includes(key) ? w.filter((k) => k !== key) : [...w, key]));

  const save = () => {
    setBusy(true);
    api
      .downloadBundle(campaignId, name, without)
      .then(onClose)
      .catch((e) => onError(String(e instanceof Error ? e.message : e)))
      .finally(() => setBusy(false));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-stone-950/80 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-stone-800 bg-stone-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-stone-800 px-5 py-4">
          <h2 className="font-serif text-xl text-amber-50">Save “{name}” as a .story</h2>
          <p className="mt-1 text-[12px] leading-snug text-stone-500">
            A backup of this game, or a starting point for someone else's — the same file
            either way. What's in it is your call.
          </p>
        </div>

        <div className="space-y-3 px-5 py-4">
          <div className="flex gap-2">
            <button
              className={`${btn} text-xs`}
              onClick={() => setWithout([])}
              aria-pressed={without.length === 0}
            >
              everything
            </button>
            <button
              className={`${btn} text-xs`}
              onClick={() => setWithout(SNAPSHOT)}
              aria-pressed={without.join() === SNAPSHOT.join()}
            >
              a starting point
            </button>
          </div>

          <div>
            <span className={sectionLabel}>Include</span>
            <div className="mt-2 space-y-1.5">
              {SECTIONS.map((s) => {
                const on = !without.includes(s.key);
                return (
                  <button
                    key={s.key}
                    className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition-colors ${
                      on ? 'bg-stone-950/60 hover:bg-stone-950' : 'bg-stone-900 hover:bg-stone-800'
                    }`}
                    onClick={() => toggle(s.key)}
                    aria-pressed={on}
                  >
                    <span
                      className={`mt-0.5 font-mono text-xs ${
                        on ? 'text-amber-400' : 'text-stone-700'
                      }`}
                    >
                      {on ? '☑' : '☐'}
                    </span>
                    <span className="min-w-0">
                      <span
                        className={`block text-[13px] ${on ? 'text-stone-100' : 'text-stone-600'}`}
                      >
                        {s.label}
                        {s.heft === 'heavy' && (
                          <span className="ml-1.5 font-mono text-[10px] text-stone-600">large</span>
                        )}
                      </span>
                      <span className="block text-[11px] leading-snug text-stone-600">
                        {s.hint}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Always in, and worth saying so — the commonest worry about
              handing someone a file is what rode along inside it. */}
          <p className="text-[11px] leading-snug text-stone-600">
            Always included: the campaign, its system, your cast, prepared fights, the
            bestiary and the scenes. Packs and books are <em>referenced</em>, never copied —
            whoever opens this needs their own.
          </p>
        </div>

        <div className="flex items-center gap-2 border-t border-stone-800 px-5 py-3">
          <button className={`${btn} ml-auto`} onClick={onClose}>
            cancel
          </button>
          <button className={btnPrimary} disabled={busy} onClick={save}>
            {busy ? 'writing…' : 'save the file'}
          </button>
        </div>
      </div>
    </div>
  );
}
