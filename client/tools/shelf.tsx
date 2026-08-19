// The 'shelf' tool — what this host holds, ported in the old app's
// library/store list-card grammar (src/components/BooksPanel.tsx,
// StorePanel.tsx: a card per section, a row per item, a dim chip for
// the version/status). Read-mostly, same as the vanilla client's shelf
// tool (`server/public/app.js`) — installing a system or pack is still
// the sweep's job (drop it in the data dir), never a console upload.
//
// `/api/shelf` says what's on the host; `/api/campaign` says which of
// it this table actually runs on, and in what precedence order — the
// "runs #N" chip and the missing-ref lines mirror the vanilla tool.

import { registerTool } from './index.ts';
import { api } from '../lib/api.ts';
import { useLive } from '../lib/use-session.ts';
import { card, sectionLabel } from '../lib/ui.ts';

type ShelfSystem = { id: string; name: string; version: number };
type ShelfPack = { id: string; system?: string; name: string; version: number };
type ShelfBoard = { id: string; name: string };
type ShelfOut = { systems: ShelfSystem[]; packs: ShelfPack[]; boards: ShelfBoard[] };

type CampaignOut = {
  slug: string;
  system: { id: string; name: string; version: number } | null;
  packs: { id: string; name: string; version: number }[];
  missing: { slot: 'system' | 'pack'; ref: { id: string; name: string } }[];
};

function ShelfTool() {
  const { data } = useLive(
    () => Promise.all([api<ShelfOut>('/api/shelf'), api<CampaignOut>('/api/campaign')]),
    [],
  );
  if (!data) return null;
  const [shelf, campaign] = data;
  const declaredAt = new Map(campaign.packs.map((p, i) => [p.id, i]));

  return (
    <div className="space-y-3">
      <section className={`${card} space-y-2`}>
        <div className="flex items-center justify-between">
          <span className={sectionLabel}>Systems</span>
          <span className="font-mono text-[11px] text-stone-600">{shelf.systems.length}</span>
        </div>
        <ul className="space-y-1">
          {shelf.systems.map((s) => (
            <li key={s.id} className="flex items-center gap-2 rounded-md bg-stone-900 px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate text-sm text-stone-100" title={s.id}>
                {s.name}
              </span>
              <span className="font-mono text-[11px] text-stone-600">v{s.version}</span>
            </li>
          ))}
          {shelf.systems.length === 0 && (
            <li className="text-sm text-stone-600">no systems on this host</li>
          )}
        </ul>
      </section>

      <section className={`${card} space-y-2`}>
        <div className="flex items-center justify-between">
          <span className={sectionLabel}>Packs</span>
          <span className="font-mono text-[11px] text-stone-600">{shelf.packs.length}</span>
        </div>
        <ul className="space-y-1">
          {shelf.packs.map((p) => {
            const at = declaredAt.get(p.id);
            return (
              <li key={p.id} className="flex items-center gap-2 rounded-md bg-stone-900 px-2 py-1.5">
                <span className="min-w-0 flex-1 truncate text-sm text-stone-100" title={p.id}>
                  {p.name}
                </span>
                <span className="font-mono text-[11px] text-stone-600">
                  v{p.version}
                  {p.system ? ` · ${p.system}` : ''}
                </span>
                {at !== undefined ? (
                  <span className="rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-amber-300">
                    runs #{at + 1}
                  </span>
                ) : (
                  <span className="font-mono text-[11px] text-stone-600">not declared</span>
                )}
              </li>
            );
          })}
          {shelf.packs.length === 0 && (
            <li className="text-sm text-stone-600">no packs on this host</li>
          )}
        </ul>
      </section>

      <section className={`${card} space-y-2`}>
        <div className="flex items-center justify-between">
          <span className={sectionLabel}>Boards</span>
          <span className="font-mono text-[11px] text-stone-600">{shelf.boards.length}</span>
        </div>
        <ul className="space-y-1">
          {shelf.boards.map((b) => (
            <li key={b.id} className="rounded-md bg-stone-900 px-2 py-1.5 text-sm text-stone-100">
              {b.name}
            </li>
          ))}
          {shelf.boards.length === 0 && (
            <li className="text-sm text-stone-600">no boards on this host</li>
          )}
        </ul>
      </section>

      <section className={`${card} space-y-2`}>
        <span className={sectionLabel}>This campaign</span>
        {campaign.system ? (
          <p className="text-sm text-stone-300">
            {campaign.system.name} v{campaign.system.version} · packs in precedence:{' '}
            {campaign.packs.length ? campaign.packs.map((p) => p.name).join(' → ') : '(all for the system)'}
          </p>
        ) : (
          <p className="text-sm text-stone-600">no system resolved</p>
        )}
        {campaign.missing.map((m, i) => (
          <p key={i} className="font-mono text-[11px] text-amber-500/80">
            missing {m.slot}: {m.ref.name} ({m.ref.id})
          </p>
        ))}
        <p className="text-[11px] text-stone-600">
          installing is still the sweep's job — drop a system or pack in the data dir and it
          shows up here on its own. there is no upload from the console.
        </p>
      </section>
    </div>
  );
}

registerTool('shelf', () => <ShelfTool />);
