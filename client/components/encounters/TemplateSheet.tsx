// A printing, read-only — the bestiary's own dialog, ported from the
// old app's CreatureSheet/Statblock (src/components/CreatureSheet.tsx,
// Statblock.tsx). The old sheet grouped a printed creature's `fields`
// into pools and prose by key; core-next's `Template` has no fields at
// all — a bestiary entry is `{id, name, type?, lists, notes?}`, the
// same shape an entity resolves through (rule 2 sharpened: `core/kind.ts`).
// So the grouping the old sheet did by hand (short numeric values as a
// pool grid, long prose under its own heading) is done here by KIND
// instead — one card per list, its entries laid out in the pool grid
// the old sheet used (`grid-cols-2 sm:grid-cols-4`) — with `notes` as
// the one prose block the new template shape still carries.
//
// It's a DIALOG, same as the old app, for the same reason: looking a
// printing up mid-fight is a detour, and a detour should announce
// itself and end.

import { useEffect } from 'react';
import { findEntry, type Entry } from '../../../core/entity.ts';
import type { Template } from '../../../core/stamp.ts';
import { btn, btnGhost, sectionLabel } from '../../lib/ui.ts';

function EntryCell({ entry }: { entry: Entry }) {
  return (
    <div className="rounded-lg bg-stone-950/60 px-3 py-2">
      {entry.value !== undefined && (
        <div className="font-mono text-sm text-amber-200">
          {entry.value}
          {typeof entry.max === 'number' && <span className="text-stone-600">/{entry.max}</span>}
        </div>
      )}
      <div className="text-[10px] uppercase tracking-wide text-stone-600">{entry.name}</div>
    </div>
  );
}

/** A status chip — an inflicted or tolerated condition, severity riding the name. */
function StatusChip({ entry }: { entry: Entry }) {
  return (
    <span className="rounded bg-sky-950 px-1.5 py-0.5 font-mono text-[10px] text-sky-300">
      {entry.name}
      {entry.value !== undefined ? ` ${entry.value}` : ''}
    </span>
  );
}

/**
 * One attack, read semantically off its `profile`/`inflicts` lists —
 * zero parsing (§I). A band heading groups these; this renders the
 * line the old app's `AttackLines` drew from parsed prose.
 */
function AttackLine({ attack }: { attack: Template }) {
  const profile = attack.lists?.profile ?? [];
  const inflicts = attack.lists?.inflicts ?? [];
  const cost = findEntry(profile, 'Cost');
  const damage = findEntry(profile, 'Damage');
  const aoe = findEntry(profile, 'AOE');
  const piercing = findEntry(profile, 'Piercing');
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 rounded-md bg-stone-950/60 px-3 py-1.5">
      <span className="text-sm text-stone-100">{attack.name}</span>
      {aoe && (
        <span className="rounded bg-stone-800 px-1.5 font-mono text-[10px] text-stone-400">
          AOE
        </span>
      )}
      {damage && <span className="font-mono text-sm text-amber-300">{damage.value}</span>}
      {piercing && (
        <span className="font-mono text-[10px] text-stone-500">
          piercing {piercing.value ?? ''}
        </span>
      )}
      {cost && <span className="font-mono text-[10px] text-stone-500">{cost.value} grit</span>}
      {inflicts.map((s) => (
        <StatusChip key={s.name} entry={s} />
      ))}
    </div>
  );
}

/** Attack children, band by band, in declared order — Melee, Short, Long. */
const BAND_ORDER = ['Melee', 'Short', 'Long'];

function AttacksSection({ template }: { template: Template }) {
  const attacks = (template.children ?? []).filter((c) => c.type === 'attack');
  if (!attacks.length) return null;
  const bandOf = (a: Template) => String(findEntry(a.lists?.profile ?? [], 'Band')?.value ?? '');
  const seen = [...new Set(attacks.map(bandOf))];
  const bands = [...BAND_ORDER.filter((b) => seen.includes(b)), ...seen.filter((b) => !BAND_ORDER.includes(b))];
  return (
    <div>
      <span className={sectionLabel}>Attacks</span>
      <div className="mt-2 space-y-2">
        {bands.map((band) => (
          <div key={band}>
            {band && (
              <div className="font-mono text-[10px] uppercase tracking-wide text-stone-600">
                {band}
              </div>
            )}
            <div className="mt-1 space-y-1">
              {attacks
                .filter((a) => bandOf(a) === band)
                .map((a) => (
                  <AttackLine key={a.id} attack={a} />
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** `tolerances` — a plain list on the foe itself (§I) — as status chips. */
function TolerancesSection({ entries }: { entries: Entry[] }) {
  if (!entries.length) return null;
  return (
    <div>
      <span className={sectionLabel}>Tolerances</span>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {entries.map((e) => (
          <StatusChip key={e.name} entry={e} />
        ))}
      </div>
    </div>
  );
}

/** `traits` — Features, Trophies, Frenzy: words as words, one prose block per entry. */
function TraitsSection({ entries }: { entries: Entry[] }) {
  if (!entries.length) return null;
  return (
    <div className="space-y-4">
      {entries.map((e) => (
        <div key={e.name}>
          <span className={sectionLabel}>{e.name}</span>
          <div className="mt-2 space-y-2">
            {String(e.value ?? '')
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line, i) => (
                <p key={i} className="text-[13px] leading-relaxed text-stone-300">
                  {line}
                </p>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function TemplateSheet({
  template,
  onClose,
  actions,
}: {
  template: Template;
  onClose: () => void;
  /** Row actions handed in by the caller — "add to the fight", etc. */
  actions?: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // `tolerances` and `traits` get their own rendering (status chips,
  // prose) — everything else still falls through to the pool grid
  // that's the bare-panel floor for anything teller doesn't recognise
  // (§7). Attack children never rode in `lists` at all.
  const lists = Object.entries(template.lists ?? {}).filter(
    ([key, entries]) => entries.length && key !== 'tolerances' && key !== 'traits',
  );
  const tolerances = template.lists?.tolerances ?? [];
  const traits = template.lists?.traits ?? [];
  const attacks = (template.children ?? []).filter((c) => c.type === 'attack');

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-stone-950/80 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-stone-800 bg-stone-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-baseline gap-2 border-b border-stone-800 px-5 py-4">
          <h2 className="font-serif text-2xl text-amber-50">{template.name}</h2>
          {template.type && (
            <span className="rounded bg-stone-800 px-1.5 py-0.5 text-[10px] text-stone-400">
              {template.type}
            </span>
          )}
          <button className={`${btnGhost} ml-auto`} onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>

        <div className="space-y-5 px-5 py-4">
          {lists.length === 0 &&
            attacks.length === 0 &&
            tolerances.length === 0 &&
            traits.length === 0 && (
              <p className="text-sm text-stone-600">nothing printed for this foe</p>
            )}
          {lists.map(([key, entries]) => (
            <div key={key}>
              <span className={sectionLabel}>{key}</span>
              <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {entries.map((e) => (
                  <EntryCell key={e.name} entry={e} />
                ))}
              </div>
            </div>
          ))}

          <AttacksSection template={template} />
          <TolerancesSection entries={tolerances} />
          <TraitsSection entries={traits} />

          {template.notes && (
            <div>
              <span className={sectionLabel}>Notes</span>
              <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-stone-300">
                {template.notes}
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-stone-800 px-5 py-3">
          {actions}
          <button className={btn} onClick={onClose}>
            done
          </button>
        </div>
      </div>
    </div>
  );
}
