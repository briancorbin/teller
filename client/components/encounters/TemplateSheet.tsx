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
import type { Entry } from '../../../core/entity.ts';
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

  const lists = Object.entries(template.lists ?? {}).filter(([, entries]) => entries.length);

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
          {lists.length === 0 && (
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
