import { useState } from 'react';
import type { RuleHit } from '../../lib/rules.ts';
import { SheetPanel } from './SheetPanel.tsx';

// The STATUSES block: the whole declared list, always, with a number in
// the box. Ported from the old app (src/components/sheet/StatusPanel.tsx)
// — the boxes are not checkboxes, they hold a Severity, and the column
// beside each name is the Skill that relieves it.
//
// **Nothing in this file is WiW.** The declared list comes off the
// system's own `statuses` declaration (name/relief/effect); a host with
// none renders no panel and still plays.
//
// **The popover's body is the PACK's words, and only those** (rule 4's
// split): the SYSTEM says the mechanic exists and what relieves it, the
// PACK says what the book wrote about it. `effect` is a keyword on the
// declaration ('daze'), not prose, and rendering it as a description
// put a machine word where a sentence belonged. So the body comes off
// `lookup` — the merged sections reading (`client/lib/rules.ts`), the
// same path the rules tool reads — and a status with no entry opens
// nothing at all. An absent description is absent, never substituted.
// Popped as an ABSOLUTE overlay, not inline, so opening it never pushes
// mounted glass into overflow (rule 6 — mounted never scrolls).

export type StatusDecl = { name: string; relief?: string; effect?: string };

type Row = {
  name: string;
  relief?: string;
  severity: number;
  loose?: boolean;
};

function StatusRow({
  row,
  onSet,
  open,
  onToggleInfo,
  hasInfo,
  info,
}: {
  row: Row;
  onSet: (next: number) => void;
  open: boolean;
  onToggleInfo: () => void;
  hasInfo: boolean;
  /** What to show when open — the pack entry's own words, or nothing. */
  info?: { meta?: string; section?: string; text: string; page?: number };
}) {
  const on = row.severity > 0;
  return (
    <div className="relative flex items-center gap-1.5 py-0.5">
      <button
        type="button"
        disabled={!on}
        onClick={() => onSet(row.severity - 1)}
        aria-label={`reduce ${row.name}`}
        className="h-7 w-4 shrink-0 rounded text-stone-500 transition-colors hover:bg-stone-800 hover:text-stone-100 disabled:pointer-events-none disabled:opacity-0"
      >
        −
      </button>

      <button
        type="button"
        onClick={() => onSet(row.severity + 1)}
        aria-label={`raise ${row.name}`}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[3px] border-2 font-mono text-sm transition-colors"
        style={{
          borderColor: on ? 'var(--sheet-accent, #f59e0b)' : '#57534e',
          color: on ? 'var(--sheet-accent, #f59e0b)' : 'transparent',
        }}
      >
        {row.severity || 0}
      </button>

      <button
        type="button"
        disabled={!hasInfo}
        onClick={onToggleInfo}
        aria-expanded={open}
        aria-label={hasInfo ? `what does ${row.name} do` : row.name}
        className="min-w-0 flex-1 rounded px-1 py-0.5 text-left transition-colors enabled:hover:bg-stone-800/60 disabled:cursor-default"
      >
        <span
          className={`block break-words font-serif text-[0.9rem] font-bold uppercase leading-tight tracking-wide ${
            on ? '' : 'opacity-55'
          }`}
          style={{ color: on ? 'var(--sheet-accent, #f59e0b)' : '#a8a29e' }}
        >
          {row.name}
        </span>
        {row.relief && (
          <span className="block break-words text-[8px] uppercase leading-tight tracking-[0.14em] text-stone-500">
            {row.relief}
          </span>
        )}
      </button>

      {/* A bounded overlay off the ROW, not the panel — opening it must
          never push mounted glass into overflow (rule 6), and pinning it
          to the row (rather than the panel's bottom edge) keeps it out
          of a clipped panel's dead zone for every row but the last. */}
      {open && info && (
        <div className="absolute left-6 right-0 top-full z-20 mt-0.5 max-h-32 overflow-y-auto rounded-lg border border-amber-900/60 bg-stone-950 p-3 shadow-xl">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-amber-200">{row.name}</span>
            {(row.relief || info.meta) && (
              <span className="font-mono text-xs text-amber-400">{row.relief ?? info.meta}</span>
            )}
            {info.section && (
              <span className="ml-auto text-[10px] uppercase tracking-wider text-stone-600">
                {info.section}
              </span>
            )}
          </div>
          <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-stone-300">
            {info.text}
          </p>
          {info.page !== undefined && (
            <p className="mt-1 font-mono text-[10px] text-stone-600">p.{info.page}</p>
          )}
        </div>
      )}
    </div>
  );
}

export function StatusPanel({
  declared,
  entries,
  onWrite,
  title = 'Statuses',
  note,
  fill = false,
  lookup,
}: {
  /** The system's own declared statuses — empty means no panel. */
  declared: StatusDecl[];
  /** The entity's own `conditions` list — the stored truth. */
  entries: { name: string; value?: number | string }[];
  onWrite: (edit: { name: string; value?: number; remove?: boolean }) => void;
  title?: string;
  note?: string;
  fill?: boolean;
  /** Rule-entry lookup, additive — a status with no matching entry opens nothing. */
  lookup?: (name: string) => RuleHit | undefined;
}) {
  const [openInfo, setOpenInfo] = useState<string | null>(null);

  const severityOf = (name: string) => {
    const hit = entries.find((e) => e.name.toLowerCase() === name.toLowerCase());
    if (!hit) return 0;
    return typeof hit.value === 'number' ? hit.value : hit.value !== undefined ? 1 : 1;
  };

  const rows: Row[] = declared.map((d) => ({
    name: d.name,
    relief: d.relief,
    severity: severityOf(d.name),
  }));

  const known = new Set(declared.map((d) => d.name.trim().toLowerCase()));
  const loose: Row[] = entries
    .filter((e) => !known.has(e.name.trim().toLowerCase()))
    .map((e) => ({
      name: e.name,
      severity: typeof e.value === 'number' ? e.value : 1,
      loose: true,
    }));

  if (!rows.length && !loose.length) return null;

  const set = (name: string, next: number) => {
    if (next <= 0) onWrite({ name, remove: true });
    else onWrite({ name, value: next });
  };

  const allRows = [...rows, ...loose];

  const infoFor = (row: Row) => {
    const hit = lookup?.(row.name);
    if (!hit || !hit.text.trim()) return undefined;
    return { meta: hit.meta, section: hit.section, text: hit.text, page: hit.page };
  };

  return (
    <SheetPanel title={title} note={note} fill={fill}>
      <div className="divide-y divide-stone-800/70">
        {allRows.map((row) => (
          <StatusRow
            key={row.name}
            row={row}
            onSet={(next) => set(row.name, next)}
            open={openInfo === row.name}
            onToggleInfo={() => setOpenInfo(openInfo === row.name ? null : row.name)}
            hasInfo={Boolean(infoFor(row))}
            info={openInfo === row.name ? infoFor(row) : undefined}
          />
        ))}
      </div>
    </SheetPanel>
  );
}
