import { useState } from 'react';
import { SheetPanel } from './SheetPanel.tsx';

// The STATUSES block: the whole declared list, always, with a number in
// the box. Ported from the old app (src/components/sheet/StatusPanel.tsx)
// — the boxes are not checkboxes, they hold a Severity, and the column
// beside each name is the Skill that relieves it.
//
// **Nothing in this file is WiW.** The declared list comes off the
// system's own `statuses` declaration (name/relief/effect); a host with
// none renders no panel and still plays.

export type StatusDecl = { name: string; relief?: string; effect?: string };

type Row = {
  name: string;
  relief?: string;
  effect?: string;
  severity: number;
  loose?: boolean;
};

function StatusRow({
  row,
  onSet,
  open,
  onToggleInfo,
}: {
  row: Row;
  onSet: (next: number) => void;
  open: boolean;
  onToggleInfo: () => void;
}) {
  const on = row.severity > 0;
  return (
    <div className="flex items-center gap-1.5 py-0.5">
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
        disabled={!row.effect}
        onClick={onToggleInfo}
        aria-expanded={open}
        aria-label={row.effect ? `what does ${row.name} do` : row.name}
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
}: {
  /** The system's own declared statuses — empty means no panel. */
  declared: StatusDecl[];
  /** The entity's own `conditions` list — the stored truth. */
  entries: { name: string; value?: number | string }[];
  onWrite: (edit: { name: string; value?: number; remove?: boolean }) => void;
  title?: string;
  note?: string;
  fill?: boolean;
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
    effect: d.effect,
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

  const shown = openInfo ? rows.find((r) => r.name === openInfo) : undefined;

  return (
    <SheetPanel title={title} note={note} fill={fill} className="relative">
      <div className="divide-y divide-stone-800/70">
        {[...rows, ...loose].map((row) => (
          <StatusRow
            key={row.name}
            row={row}
            onSet={(next) => set(row.name, next)}
            open={openInfo === row.name}
            onToggleInfo={() => setOpenInfo(openInfo === row.name ? null : row.name)}
          />
        ))}
      </div>

      {shown?.effect && (
        <div className="mt-2 rounded-lg border border-amber-900/60 bg-stone-900 p-3">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-amber-200">{shown.name}</span>
            {shown.relief && (
              <span className="font-mono text-xs text-amber-400">{shown.relief}</span>
            )}
          </div>
          <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-stone-300">
            {shown.effect}
          </p>
        </div>
      )}
    </SheetPanel>
  );
}
