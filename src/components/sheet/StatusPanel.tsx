import { useState } from 'react';
import type { PackEntry } from '../../../worker/types';
import { formatTag, parseTag, sameTag } from '../../lib/tags';
import { InfoPopover } from './InfoPopover';
import { SheetPanel } from './SheetPanel';

// The STATUSES block: the whole list, always, with a number in the box.
//
// Two things a filled-in sheet corrects about the blank one. The boxes
// are **not checkboxes** — they hold a Severity, and the example has a 1
// on Afraid and a 2 on Trapped. And the rotated column down the left is
// not decoration: it's the Skill that RELIEVES each status, which is the
// single most useful thing on the panel and the reason it's printed
// beside the box rather than buried in the text.
//
// **Nothing in this file is WiW.** The repo carries no status names, no
// effect text and no skill assignments — all of it comes out of the
// reader's own pack, from the section the campaign's vocabulary names
// ("Statuses" here, "Conditions" elsewhere). `meta` is the relieving
// skill, `text` is the effect. A host with no pack renders no panel and
// still plays.
//
// The whole list shows whether or not you have any of them, exactly like
// the page. That's the point of the printed panel: it's a menu of what
// can happen to you, not a report of what has.

type Row = {
  name: string;
  /** The Skill that relieves it, when the pack says. */
  relief?: string;
  entry?: PackEntry & { section?: string };
  severity: number;
  /** A tag nobody declared — kept so nothing a person typed disappears. */
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
      {/* Down is only offered when there's something to come down from —
          the `Refill` precedent: always rendered, so nothing shifts when
          it becomes available. */}
      <button
        type="button"
        disabled={!on}
        onClick={() => onSet(row.severity - 1)}
        aria-label={`reduce ${row.name}`}
        className="h-7 w-4 shrink-0 rounded text-stone-500 transition-colors hover:bg-stone-800 hover:text-stone-100 disabled:pointer-events-none disabled:opacity-0"
      >
        −
      </button>

      {/* The box you write the number in. Tapping raises it, which is the
          direction it moves when something hits you. */}
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

      {/* The name IS the disclosure. A separate ⓘ cost a column this
          panel doesn't have the width for, and made the smallest target
          in the row the one carrying the rules text. Stacking the
          relieving Skill under the name keeps both without a second
          column, which is what lets this fit beside Health. */}
      <button
        type="button"
        disabled={!row.entry?.text}
        onClick={onToggleInfo}
        aria-expanded={open}
        aria-label={row.entry?.text ? `what does ${row.name} do` : row.name}
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
  entries,
  tags,
  onChange,
  title,
  note,
  relievers = [],
  fill = false,
}: {
  /** The declared list, from the pack. Empty means no panel. */
  entries: (PackEntry & { section?: string })[];
  tags: string[];
  onChange: (next: string[]) => void;
  title: string;
  /** The line the sheet sets under the heading. Pack-supplied only. */
  note?: string;
  /** Grow to fill the column — see `SheetPanel`. */
  fill?: boolean;
  /**
   * The Skills that can relieve a status — the declared skill block.
   *
   * Used to tell a STATUS from a RULE ABOUT statuses. A pack's Statuses
   * section holds both: seven things that can happen to you, and then
   * "Severity" and "Relieving Statuses", which explain how the first
   * seven work. They're all `PackEntry` and nothing in the data marks
   * the difference.
   *
   * The panel's own subtitle is the discriminator — *relieved by rolling
   * with the associated Skill* — so a row here is an entry whose `meta`
   * names one of the character's Skills. That's derived from what the
   * system already declares rather than a list of titles to skip, and
   * the explainers aren't lost: they're still in the console's rules
   * panel, where a rule belongs.
   *
   * No skills declared, no filter — every entry gets a row, because a
   * system teller knows nothing about should lose nothing.
   */
  relievers?: string[];
}) {
  const [openInfo, setOpenInfo] = useState<string | null>(null);

  const severityOf = (name: string) => {
    const hit = tags.find((t) => sameTag(t, name));
    if (hit === undefined) return 0;
    const { value } = parseTag(hit);
    // A bare tag with no number is present at strength 1 — someone typed
    // "Afraid" and meant it, and reading that as 0 would erase them.
    return value ?? 1;
  };

  const statuses = relievers.length
    ? entries.filter((e) =>
        relievers.some((skill) =>
          (e.meta ?? '').toLowerCase().includes(skill.toLowerCase()),
        ),
      )
    : entries;

  const declared = statuses.map<Row>((entry) => ({
    name: entry.name,
    relief: entry.meta,
    entry,
    severity: severityOf(entry.name),
  }));

  // Anything on the character that the pack never listed. It still shows,
  // because a tag a person typed is a fact about their character and no
  // declaration outranks it (rule 1).
  const known = new Set(statuses.map((e) => e.name.trim().toLowerCase()));
  const loose = tags
    .map((t) => parseTag(t))
    .filter((t) => !known.has(t.name.trim().toLowerCase()))
    .map<Row>((t) => ({ name: t.name, severity: t.value ?? 1, loose: true }));

  const set = (name: string, next: number) => {
    const others = tags.filter((t) => !sameTag(t, name));
    onChange(next <= 0 ? others : [...others, formatTag(name, next)]);
  };

  if (!declared.length && !loose.length) return null;

  const shown = openInfo
    ? declared.find((r) => r.name === openInfo)?.entry
    : undefined;

  return (
    <SheetPanel title={title} note={note} fill={fill} className="relative">
      <div className="divide-y divide-stone-800/70">
        {[...declared, ...loose].map((row) => (
          <StatusRow
            key={row.name}
            row={row}
            onSet={(next) => set(row.name, next)}
            open={openInfo === row.name}
            onToggleInfo={() =>
              setOpenInfo(openInfo === row.name ? null : row.name)
            }
          />
        ))}
      </div>

      {shown && <InfoPopover entry={shown} onClose={() => setOpenInfo(null)} />}
    </SheetPanel>
  );
}
