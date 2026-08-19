// The standard blocks — §E's nouns, registered into the renderer.
//
// The visual reckoning: these blocks' internals now match the old app's
// components (the reference, not inspiration) — Vitals, TagSection,
// Counters (Big/Ledger/Rows), the sheet chrome and the Grit cylinder —
// without touching the block names or the BlockCtx seam.

import { useEffect, useState } from 'react';
import type { Entity, Entry } from '../../core/entity.ts';
import type { PanelBlock } from '../../core/panels.ts';
import { api, fileUrl } from '../lib/api.ts';
import { card, sectionLabel } from '../lib/ui.ts';
import { CounterStepper } from '../components/Vitals.tsx';
import { TagSection } from '../components/TagSection.tsx';
import { BigGauge, LedgerRow, SkillRow, stepValue } from '../components/Counters.tsx';
import { Cylinder, dialable } from '../components/sheet/Cylinder.tsx';
import { HealthPanel } from '../components/sheet/HealthPanel.tsx';
import { SheetGauge } from '../components/sheet/SheetGauge.tsx';
import { SheetPanel } from '../components/sheet/SheetPanel.tsx';
import { StatusPanel, type StatusDecl } from '../components/sheet/StatusPanel.tsx';
import { registerBlock, Refusal, RenderBlock, type BlockCtx } from './render.tsx';

/** 'skills' → 'Skills'. The one heading this file supplies rather than reads off a pack. */
function titleCase(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function subject(ctx: BlockCtx): Entity | undefined {
  return ctx.entity as Entity | undefined;
}

function entriesOf(e: Entity | undefined, list: string): Entry[] {
  if (!e) return [];
  const key = Object.keys(e.lists).find(
    (k) => k.toLowerCase() === list.toLowerCase(),
  );
  return key ? e.lists[key] : [];
}

function accentOf(ctx: BlockCtx, e: Entity | undefined): string | undefined {
  return e?.type ? (ctx.records.accents?.[e.type] as string | undefined) : undefined;
}

function dialOf(ctx: BlockCtx, entry: Entry): string | undefined {
  return ctx.records.dials?.[entry.name] as string | undefined;
}

/** An entry by name, wherever it lives — the `pins` record names an
 * entry, never a list, so a pinned field could be under `stats`,
 * `meta`, anywhere. */
export function entryNamed(e: Entity | undefined, name: string): Entry | undefined {
  if (!e) return undefined;
  for (const entries of Object.values(e.lists)) {
    const hit = entries.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (hit) return hit;
  }
  return undefined;
}

/** The entries the system pinned to this counter — Defense, for WiW Health. */
function pinsOf(ctx: BlockCtx, e: Entity | undefined, entry: Entry): Entry[] {
  const names = (ctx.records.pins?.[entry.name] as string[] | undefined) ?? [];
  return names
    .map((n) => entryNamed(e, n))
    .filter((x): x is Entry => x !== undefined);
}

function filterEntries(entries: Entry[], filter: unknown): Entry[] {
  const capped = (e: Entry) => typeof e.max === 'number' && e.max > 0;
  if (filter === 'capped') return entries.filter(capped);
  if (filter === 'uncapped') return entries.filter((e) => !capped(e));
  return entries;
}

/** A path from a records slot, resolved to a fetchable url — or nothing. */
function useArt(path: string | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!path) {
      setUrl(undefined);
      return;
    }
    let cancelled = false;
    fileUrl(path).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);
  return url;
}

// ---- header --------------------------------------------------------------
// Old sheet header grammar: a serif name, the type as an accent-coloured
// caption, and the pack's own portrait for that type (ported plate shape
// from src/components/sheet/SheetHeader.tsx — trimmed to what the panel
// declares: no player/trade fields, no spend chips yet).

function HeaderBlock({ ctx }: { ctx: BlockCtx }) {
  const e = subject(ctx);
  const accent = accentOf(ctx, e);
  const portraitPath = e?.type
    ? (ctx.records.portraits?.[e.type] as string | undefined)
    : undefined;
  const portraitUrl = useArt(portraitPath);

  if (!e) return <Refusal>no entity to head</Refusal>;
  return (
    <header className="flex items-center gap-3 px-1">
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-serif text-2xl text-stone-100">{e.name}</h1>
        {e.type && (
          <span
            className={`block ${sectionLabel}`}
            style={accent ? { color: accent } : undefined}
          >
            {e.type}
          </span>
        )}
      </div>
      {portraitUrl && (
        <img
          src={portraitUrl}
          alt=""
          className="h-[4.2rem] w-[4.2rem] shrink-0 rounded-full border-2 object-cover"
          style={{ borderColor: accent ? `${accent}88` : '#57534e' }}
        />
      )}
    </header>
  );
}

registerBlock('header', (_block, ctx) => <HeaderBlock ctx={ctx} />);

// ---- brand -----------------------------------------------------------
// The system's mark, when a pack brought one (record 'brand'). Sized as
// the vanilla client's own `.brand-logo`.

function BrandBlock({ ctx }: { ctx: BlockCtx }) {
  const logoPath = ctx.records.brand?.logo as string | undefined;
  const url = useArt(logoPath);
  if (!url) return null;
  return <img src={url} alt="" className="mx-auto block max-h-[4.5rem] max-w-[60%]" />;
}

registerBlock('brand', (_block, ctx) => <BrandBlock ctx={ctx} />);

// ---- list ------------------------------------------------------------
// `as` maps to the old app's counter layouts; a per-entry `dials` record
// of 'cylinder' overrides whatever the arrangement asked for, same as
// the vanilla client's presentation() — the system's word for THIS name
// beats the panel's generic one.

/** The floor's own auto grammar, one entry: bare → chip, string → row, number → stepper. */
function AutoEntry({
  entry,
  onWrite,
}: {
  entry: Entry;
  onWrite: (edit: Record<string, unknown>) => void;
}) {
  if (entry.value === undefined) {
    return (
      <span className="flex w-fit items-center gap-1.5 overflow-hidden rounded-full bg-amber-950/60 py-1 pl-2.5 pr-2 text-xs text-amber-200">
        {entry.name}
        <button
          className="text-amber-500/60 transition-colors hover:text-red-300"
          onClick={() => onWrite({ remove: true })}
          title="remove"
        >
          ✕
        </button>
      </span>
    );
  }
  if (typeof entry.value === 'string') {
    return (
      <div className="flex items-baseline gap-2">
        <span className="text-sm text-stone-200">{entry.name}</span>
        <span className="ml-auto font-mono text-sm text-stone-300">{entry.value}</span>
      </div>
    );
  }
  return (
    <CounterStepper
      entry={entry}
      onBump={(d) => onWrite({ value: stepValue(entry, d) })}
    />
  );
}

registerBlock('list', (block, ctx) => {
  const e = subject(ctx);
  const name = typeof block.list === 'string' ? block.list : '';
  if (!name) return <Refusal>a list block with no list</Refusal>;
  const as = typeof block.as === 'string' ? block.as : 'auto';
  const accent = accentOf(ctx, e);
  const entries = filterEntries(entriesOf(e, name), block.filter);

  const write = (entryName: string, edit: Record<string, unknown>) =>
    ctx.write?.({ list: name, name: entryName, ...edit });

  if (as === 'chips') {
    if (!entries.length) return null;
    return (
      <TagSection
        entries={entries}
        onWrite={(edit) => write(edit.name, edit)}
        label={name}
      />
    );
  }

  // A read-only glance strip — the generic stat chips the old app drew
  // under a seat layout that doesn't place its own fields (every layout
  // but Sheet). Not `chips` (TagSection): these are fixed named values,
  // not a removable tag list, and offering a ✕ on "Charm" made no sense.
  if (as === 'strip') {
    if (!entries.length) return null;
    return (
      <div className="flex flex-wrap gap-1">
        {entries.map((entry) => (
          <span key={entry.name} className="rounded-md bg-stone-900 px-2 py-1 text-xs">
            <span className="font-mono text-stone-100">{entry.value ?? '—'}</span>
            <span className="ml-1 uppercase tracking-wider text-stone-500">{entry.name}</span>
          </span>
        ))}
      </div>
    );
  }

  if (as === 'rows') {
    if (!entries.length) return null;
    return (
      <SheetPanel title={titleCase(name)} className="w-full">
        <div className="divide-y divide-stone-800/80">
          {entries.map((entry) => (
            <SkillRow key={entry.name} entry={entry} accent={accent} />
          ))}
        </div>
      </SheetPanel>
    );
  }

  // The `sheet` layout's own gauge treatment — a pinned counter (Health,
  // with Defense beside it) gets `HealthPanel`; a counter dialled a
  // cylinder (Grit) gets `Cylinder`; anything else falls to `SheetGauge`,
  // a ring for a small ceiling or a bar-and-steppers otherwise. Every one
  // of the three wears the same ruled `SheetPanel` chrome, which is the
  // whole difference from the plain `big` tile the other five layouts use.
  if (as === 'sheet') {
    if (!entries.length) return null;
    return (
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))' }}
      >
        {entries.map((entry) => {
          const pinned = pinsOf(ctx, e, entry);
          if (pinned.length) {
            return (
              <HealthPanel
                key={entry.name}
                entry={entry}
                pinned={pinned}
                onSet={(v) => write(entry.name, { value: v })}
              />
            );
          }
          if (dialOf(ctx, entry) === 'cylinder' && dialable(entry)) {
            return (
              <Cylinder
                key={entry.name}
                entry={entry}
                onSet={(v) => write(entry.name, { value: v })}
                accent={accent}
              />
            );
          }
          return (
            <SheetGauge
              key={entry.name}
              entry={entry}
              onSet={(v) => write(entry.name, { value: v })}
            />
          );
        })}
      </div>
    );
  }

  if (as === 'big') {
    if (!entries.length) return null;
    return (
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))' }}
      >
        {entries.map((entry) =>
          dialOf(ctx, entry) === 'cylinder' && dialable(entry) ? (
            <Cylinder
              key={entry.name}
              entry={entry}
              onSet={(v) => write(entry.name, { value: v })}
              accent={accent}
            />
          ) : (
            <BigGauge
              key={entry.name}
              entry={entry}
              onWrite={(v) => write(entry.name, { value: v })}
            />
          ),
        )}
      </div>
    );
  }

  if (as === 'ledger') {
    if (!entries.length) return null;
    return (
      <div className="flex flex-col">
        {entries.map((entry) => (
          <LedgerRow
            key={entry.name}
            entry={entry}
            onWrite={(v) => write(entry.name, { value: v })}
          />
        ))}
      </div>
    );
  }

  if (as === 'bars') {
    if (!entries.length) return null;
    return (
      <div className="flex flex-col gap-2">
        {entries.map((entry) => (
          <CounterStepper
            key={entry.name}
            entry={entry}
            onBump={(d) => write(entry.name, { value: stepValue(entry, d) })}
          />
        ))}
      </div>
    );
  }

  // auto — the floor's grammar, dressed in a labelled card.
  return (
    <section className={`${card} flex flex-col gap-2`}>
      <p className={sectionLabel}>{name}</p>
      {entries.length === 0 && <Refusal>nothing here yet</Refusal>}
      {entries.map((entry) => (
        <AutoEntry
          key={entry.name}
          entry={entry}
          onWrite={(edit) => write(entry.name, edit)}
        />
      ))}
    </section>
  );
});

// ---- statuses ----------------------------------------------------------
// The system's statuses (`/api/stack/declarations/statuses`), drawn the
// way the printed sheet does — the WHOLE declared list, always, each row
// a Severity box and the relieving Skill underneath the name (ported
// `StatusPanel`, not a chip strip). The entity's own `conditions` list
// is the stored truth; the declaration only supplies the row and the
// relief/effect text.

function StatusesBlock({ ctx }: { ctx: BlockCtx }) {
  const e = subject(ctx);
  const [decls, setDecls] = useState<StatusDecl[] | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    api<StatusDecl[]>('/api/stack/declarations/statuses')
      .then((d) => {
        if (!cancelled) setDecls(d);
      })
      .catch(() => {
        if (!cancelled) setDecls([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!e || !decls) return null;
  const entries = entriesOf(e, 'conditions');

  return (
    <StatusPanel
      declared={decls}
      entries={entries}
      onWrite={(edit) => ctx.write?.({ list: 'conditions', ...edit })}
    />
  );
}

registerBlock('statuses', (_block, ctx) => <StatusesBlock ctx={ctx} />);

// ---- notes -------------------------------------------------------------

registerBlock('notes', (_block, ctx) => {
  const e = subject(ctx);
  if (!e?.notes) return null;
  return (
    <section className={`${card} flex flex-col gap-2`}>
      <p className={sectionLabel}>notes</p>
      <p className="text-sm whitespace-pre-wrap text-stone-300">{e.notes}</p>
    </section>
  );
});

// ---- children ----------------------------------------------------------
// A nested entity gets its own small card — name, type, and its lists in
// the floor's plain grammar. Not a full sheet-in-a-sheet; a stray in the
// same sense `rest` catches strays, just one level down.

registerBlock('children', (_block, ctx) => {
  const e = subject(ctx);
  if (!e?.children?.length) return null;
  return (
    <>
      {e.children.map((child) => (
        <section key={child.id} className={`${card} flex flex-col gap-2`}>
          <div className="flex items-baseline gap-2">
            <p className="text-sm font-medium text-stone-100">{child.name}</p>
            {child.type && <span className={sectionLabel}>{child.type}</span>}
          </div>
          {Object.entries(child.lists).map(([listName, entries]) => (
            <div key={listName} className="flex flex-col gap-1">
              <p className="text-[10px] uppercase tracking-widest text-stone-600">
                {listName}
              </p>
              {entries.map((entry) => (
                <div key={entry.name} className="flex items-baseline gap-2 text-sm">
                  <span className="text-stone-300">{entry.name}</span>
                  {entry.value !== undefined && (
                    <span className="ml-auto font-mono text-stone-400">
                      {entry.value}
                      {entry.max !== undefined && (
                        <span className="text-stone-600"> / {entry.max}</span>
                      )}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </section>
      ))}
    </>
  );
});

// ---- rest (strays surface — the degradation contract, arranged) -------

registerBlock('rest', (block, ctx) => {
  const e = subject(ctx);
  if (!e) return null;
  const placed = new Set(
    (Array.isArray(block.except) ? block.except : []).map((n) =>
      String(n).toLowerCase(),
    ),
  );
  // Every entry name a `pins` declaration already drew somewhere else
  // (Defense, pinned into Health's own panel) — excluded per-ENTRY
  // rather than dropping its whole list, so a sibling stat the system
  // never pinned (Speed, beside Defense in `stats`) still surfaces here.
  const pinned = new Set(
    Object.values((ctx.records.pins as Record<string, string[]> | undefined) ?? {})
      .flat()
      .map((n) => n.toLowerCase()),
  );
  const strays = Object.keys(e.lists).filter((k) => !placed.has(k.toLowerCase()));
  const sections = strays
    .map((name) => ({
      name,
      entries: e.lists[name].filter((entry) => !pinned.has(entry.name.toLowerCase())),
    }))
    .filter((s) => s.entries.length > 0);
  if (!sections.length) return null;
  return (
    <>
      {sections.map(({ name, entries }) => (
        <section key={name} className={`${card} flex flex-col gap-2`}>
          <p className={sectionLabel}>{name}</p>
          {entries.map((entry) => (
            <AutoEntry
              key={entry.name}
              entry={entry}
              onWrite={(edit) => ctx.write?.({ list: name, name: entry.name, ...edit })}
            />
          ))}
        </section>
      ))}
    </>
  );
});

// ---- columns -----------------------------------------------------------

registerBlock('columns', (block, ctx) => {
  const cols = Array.isArray(block.columns) ? block.columns : [];
  return (
    <div className="flex gap-4">
      {cols.map((col, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col gap-4">
          {Array.isArray(col) &&
            col.map((b, j) =>
              b && typeof b === 'object' && 'block' in b ? (
                <RenderInColumn key={j} block={b as PanelBlock} ctx={ctx} />
              ) : null,
            )}
        </div>
      ))}
    </div>
  );
});

function RenderInColumn({ block, ctx }: { block: PanelBlock; ctx: BlockCtx }) {
  return <RenderBlock block={block} ctx={ctx} />;
}

// ---- tool (dispatch into the registry) --------------------------------
// The tool files are imported HERE, not from the registry: they import
// registerTool from tools/index.ts, so the registry importing them back
// was a cycle — and the first tool evaluated before the registry's Map
// existed (TDZ). The consumer imports both sides; the graph is a tree.

import { toolOf } from '../tools/index.ts';
import '../tools/roster.tsx';
import '../tools/runner.tsx';
import '../tools/encounters.tsx';
import '../tools/screens.tsx';
import '../tools/shelf.tsx';
import '../tools/plugins.tsx';
import '../tools/boards.tsx';
import '../tools/log.tsx';

registerBlock('tool', (block, ctx) => {
  const name = typeof block.tool === 'string' ? block.tool : '';
  const render = toolOf(name);
  if (!render)
    return <Refusal>this build doesn't know the tool '{name || '?'}'</Refusal>;
  return <>{render(block, ctx)}</>;
});

// The 'turn' block registers in tools/runner.tsx — it and the runner
// tool are one port and share their pieces.
