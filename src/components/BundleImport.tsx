import { useRef, useState } from 'react';
import type { BundleSummary } from '../../worker/import';
import { api } from '../lib/api';
import { btnPrimary, card, input, sectionLabel } from '../lib/ui';

// Opening a `.tell` file.
//
// Two steps on purpose: choosing a file shows what's in it, and taking
// it is a separate decision. Looking in a box and emptying it into your
// campaign are different acts.
//
// The same control does both jobs. Without a campaign it makes one —
// "new campaign, click import, everything's there". With one, it merges
// into the table you're already running, which is how a module lands on
// top of a system you already have.

export function BundleImport({
  campaignId,
  onDone,
}: {
  /** Merge into this campaign; omit to create a new one. */
  campaignId?: string;
  onDone: (campaignId: string) => void;
}) {
  const [bundle, setBundle] = useState<{ file: File; summary: BundleSummary } | null>(
    null,
  );
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<string[] | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const look = async (file: File) => {
    setError('');
    setDone(null);
    setBusy(true);
    try {
      const summary = await api.inspectBundle(file);
      setBundle({ file, summary });
      // Offer the bundle's own name as a starting point, not as a rule.
      setName(summary.manifest.name ?? '');
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const take = async () => {
    if (!bundle) return;
    setBusy(true);
    try {
      const result = await api.importBundle(bundle.file, {
        campaignId,
        name: campaignId ? undefined : name,
      });
      setBundle(null);
      // Merging into a campaign you're looking at should report what
      // happened; creating one should just open it.
      if (campaignId) setDone([...result.applied, ...result.skipped]);
      onDone(result.campaignId);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`${card} space-y-3`}>
      <span className={sectionLabel}>
        {campaignId ? 'Add from a .tell file' : 'Open a .tell file'}
      </span>

      <input
        ref={fileRef}
        type="file"
        accept=".tell,.zip,application/zip"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void look(file);
          e.target.value = '';
        }}
      />

      {!bundle ? (
        <div className="flex items-center gap-3">
          <button
            className={btnPrimary}
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            choose a file…
          </button>
          <span className="text-sm text-stone-500">
            {campaignId
              ? 'a module, a bestiary, more maps'
              : 'a system, a campaign, foes, maps — whatever it carries'}
          </span>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="font-serif text-lg text-stone-100">
              {bundle.summary.manifest.name}
            </span>
            <span className="font-mono text-[11px] text-stone-600">
              {bundle.summary.manifest.system}
            </span>
          </div>
          <ul className="space-y-0.5">
            {bundle.summary.sections.map((s) => (
              <li key={s.name} className="text-sm text-stone-400">
                <span className="font-mono text-amber-400">{s.count}</span> {s.label}
              </li>
            ))}
          </ul>
          {bundle.summary.missingSystem && (
            <p className="text-sm text-amber-500/80">
              Needs the “{bundle.summary.missingSystem}” system, which this bundle
              doesn't include — import its core file first.
            </p>
          )}

          {!campaignId && (
            <label className="block space-y-1">
              <span className={sectionLabel}>Call this campaign</span>
              <input
                className={`${input} w-full`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={bundle.summary.manifest.name}
              />
            </label>
          )}

          <div className="flex items-center gap-2">
            <button className={btnPrimary} disabled={busy} onClick={take}>
              {busy ? 'unpacking…' : campaignId ? 'add it' : 'bring it in'}
            </button>
            <button
              className="text-sm text-stone-600 hover:text-stone-300"
              onClick={() => setBundle(null)}
            >
              cancel
            </button>
          </div>
        </div>
      )}

      {done && (
        <ul className="space-y-0.5">
          {done.map((line, i) => (
            <li key={i} className="text-sm text-stone-400">
              {line}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-amber-500/80">{error}</p>}
    </section>
  );
}
