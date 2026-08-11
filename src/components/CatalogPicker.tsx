import { useMemo, useState } from 'react';
import type {
  CatalogItem,
  Field,
  RulesPack,
  SystemTemplate,
} from '../../worker/types';
import { catalogOf, poolFields, type OwnCatalog } from '../../worker/items';
import { newLocalId } from '../lib/api';
import { btn, btnGhost, btnPrimary, card, input, sectionLabel } from '../lib/ui';
import { FieldSection } from './FieldSection';

// Everything a character could be handed, and the one place a table
// invents something the books never printed.
//
// The two catalogues are not interchangeable and this is where you feel
// why. A pack is a BOOK: static, as its author wrote it, replaced whole
// the next time you install a newer printing — so nothing here edits
// one. The campaign's own list is your table's, and it is editable to
// the last character, because that's the half that travels in a
// `.story` (rule 9).
//
// Which is why copying is a MINT and not an override. Take the book's
// rifle, change one number, and you have a different rifle — a new id,
// existing alongside the printed one rather than shadowing it. The
// alternative was the bestiary's shadow-by-id, and it would have meant
// a character pointing at the book's rifle silently starting to mean
// something else the day somebody retuned it, with nothing on the card
// to say so (see `catalogOf`).

/** The campaign's own shelf, as opposed to any pack's. */
const OWN = 'yours';

function matches(entry: CatalogItem, needle: string): boolean {
  if (!needle) return true;
  const q = needle.toLowerCase();
  return (
    entry.name.toLowerCase().includes(q) ||
    (entry.group ?? '').toLowerCase().includes(q) ||
    entry.fields.some((f) => f.value.toLowerCase().includes(q))
  );
}

/**
 * What an entry IS, in one line.
 *
 * Everything, filing included — this is the gunsmith's counter, and
 * Quality and Cost are most of the decision here. It's the play
 * surfaces that skip them (see `Field.filing`).
 */
function Summary({ fields }: { fields: Field[] }) {
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5">
      {fields.map((f) => (
        <span
          key={f.key}
          className={`whitespace-nowrap text-[11px] ${
            f.filing ? 'text-stone-600' : 'text-stone-400'
          }`}
        >
          <span className="uppercase tracking-wider text-stone-600">{f.label} </span>
          <span className="font-mono">{f.value}</span>
        </span>
      ))}
    </span>
  );
}

export function CatalogPicker({
  packs,
  own,
  dice,
  onPick,
  onOwnChange,
  onClose,
}: {
  packs: RulesPack[];
  /** The campaign's own gear. */
  own?: OwnCatalog;
  dice?: SystemTemplate['dice'];
  /** Hand this entry to whoever opened the picker. */
  onPick: (entry: CatalogItem) => void;
  /** Absent on a surface that may look but not write to the campaign. */
  onOwnChange?: (next: NonNullable<OwnCatalog>) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const ownIds = useMemo(
    () => new Set((own?.items ?? []).map((i) => i.id)),
    [own],
  );
  const entries = useMemo(
    () => [...catalogOf(packs, own).items.values()],
    [packs, own],
  );

  // Shelves derived from the entries themselves, so a group that
  // filters to nothing is never offered.
  //
  // A copy sits on TWO shelves, the bestiary's lesson: your own rifle is
  // still a rifle, and filtering to Rifles to find it and coming up
  // empty is the kind of thing that reads as data loss.
  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    const bump = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1);
    for (const e of entries) {
      if (ownIds.has(e.id)) bump(OWN);
      bump(e.group ?? 'other');
    }
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [entries, ownIds]);

  const found = useMemo(
    () =>
      entries.filter(
        (e) =>
          matches(e, query.trim()) &&
          (!group ||
            (group === OWN ? ownIds.has(e.id) : (e.group ?? 'other') === group)),
      ),
    [entries, query, group, ownIds],
  );

  const writeOwn = (items: CatalogItem[]) =>
    onOwnChange?.({ items, upgrades: own?.upgrades ?? [] });

  /** A new entry on the campaign's shelf, and open for editing. */
  const mint = (from?: CatalogItem) => {
    const entry: CatalogItem = from
      ? {
          ...from,
          id: newLocalId('itm'),
          name: `${from.name} (copy)`,
          // Deep enough that editing the copy can't reach back into the
          // book's own entry — the fields are the whole point of copying.
          fields: from.fields.map((f) => ({ ...f })),
          counters: from.counters?.map((c) => ({ ...c })),
        }
      : {
          id: newLocalId('itm'),
          name: 'New item',
          group: 'Yours',
          fields: [],
        };
    writeOwn([...(own?.items ?? []), entry]);
    setEditing(entry.id);
    setGroup(OWN);
  };

  const patch = (id: string, next: Partial<CatalogItem>) =>
    writeOwn((own?.items ?? []).map((e) => (e.id === id ? { ...e, ...next } : e)));

  const drop = (id: string) =>
    writeOwn((own?.items ?? []).filter((e) => e.id !== id));

  return (
    <section className={`${card} space-y-3 border-amber-900/60`}>
      <div className="flex items-center justify-between">
        <span className={sectionLabel}>Catalogue</span>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-stone-600">
            {query || group ? `${found.length} of ${entries.length}` : `${entries.length}`}
          </span>
          <button className={btnGhost} onClick={onClose} aria-label="close catalogue">
            ✕
          </button>
        </div>
      </div>

      <input
        className={`${input} w-full`}
        placeholder="rifle, 2G, $20…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="search the catalogue"
      />

      {groups.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {groups.map(([key, n]) => (
            <button
              key={key}
              className={`rounded-full px-2.5 py-0.5 text-[11px] transition-colors ${
                group === key
                  ? 'bg-amber-800 text-stone-50'
                  : 'bg-stone-800 text-stone-400 hover:bg-stone-700'
              }`}
              onClick={() => setGroup(group === key ? null : key)}
            >
              {key} <span className="text-stone-500">{n}</span>
            </button>
          ))}
        </div>
      )}

      <div className="max-h-96 space-y-1 overflow-y-auto pr-1">
        {found.length === 0 && (
          <p className="py-4 text-center text-sm text-stone-600">
            nothing by that name
          </p>
        )}
        {found.map((entry) => {
          const mine = ownIds.has(entry.id);
          const open = editing === entry.id;
          return (
            <div
              key={entry.id}
              className="rounded-lg border border-stone-800 bg-stone-900/60 px-3 py-2"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="break-words text-sm text-stone-100">
                      {entry.name}
                    </span>
                    {mine && (
                      <span className="shrink-0 rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-200">
                        yours
                      </span>
                    )}
                    {entry.slots !== undefined && (
                      <span className="shrink-0 font-mono text-[11px] text-stone-600">
                        {entry.slots} slots
                      </span>
                    )}
                  </div>
                  <Summary fields={entry.fields} />
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button className={btnPrimary} onClick={() => onPick(entry)}>
                    add
                  </button>
                  {onOwnChange && (
                    <button
                      className={btnGhost}
                      onClick={() => mint(entry)}
                      title="copy to this campaign — a new item with its own id, yours to change"
                    >
                      ⧉
                    </button>
                  )}
                  {mine && onOwnChange && (
                    <>
                      <button
                        className={btnGhost}
                        onClick={() => setEditing(open ? null : entry.id)}
                        title="edit this campaign's copy"
                      >
                        {open ? 'done' : 'edit'}
                      </button>
                      <button
                        className={`${btnGhost} hover:text-red-300`}
                        onClick={() =>
                          window.confirm(`Remove ${entry.name} from the catalogue?`) &&
                          drop(entry.id)
                        }
                        aria-label="remove from catalogue"
                      >
                        ✕
                      </button>
                    </>
                  )}
                </div>
              </div>

              {open && (
                <div className="mt-3 space-y-3 border-t border-stone-800 pt-3">
                  <div className="flex gap-2">
                    <input
                      className={`${input} min-w-0 flex-1`}
                      defaultValue={entry.name}
                      onBlur={(e) =>
                        e.target.value.trim() && patch(entry.id, { name: e.target.value.trim() })
                      }
                      aria-label="item name"
                    />
                    <input
                      className={`${input} w-24`}
                      defaultValue={entry.group ?? ''}
                      placeholder="group"
                      onBlur={(e) => patch(entry.id, { group: e.target.value.trim() || undefined })}
                      aria-label="group"
                    />
                    <input
                      className={`${input} w-20`}
                      type="number"
                      min={0}
                      defaultValue={entry.slots ?? ''}
                      placeholder="slots"
                      onBlur={(e) =>
                        patch(entry.id, {
                          slots: e.target.value === '' ? undefined : Number(e.target.value),
                        })
                      }
                      aria-label="upgrade slots"
                    />
                  </div>
                  <FieldSection
                    fields={entry.fields}
                    editable
                    label="Stats"
                    onChange={(fields) => patch(entry.id, { fields })}
                  />
                  {/* A pool field is what an upgrade can be pointed at,
                      so say which ones qualify rather than leaving
                      somebody to discover it by fitting one. */}
                  <p className="text-[11px] text-stone-600">
                    {poolFields(entry, dice).length > 0
                      ? `Upgrades can be pointed at: ${poolFields(entry, dice)
                          .map((f) => f.label)
                          .join(', ')}`
                      : 'No die pools yet — an upgrade will have nothing to modify.'}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {onOwnChange && (
        <button className={btn} onClick={() => mint()}>
          + new item
        </button>
      )}
    </section>
  );
}
