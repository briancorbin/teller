// The standard blocks — §E's nouns, registered into the renderer.
// These start as plain readings of the data in the house grammar; the
// visual reckoning replaces their internals with the old app's
// components (the reference, not inspiration) without touching the
// block names or the BlockCtx seam.

import type { Entity, Entry } from '../../core/entity.ts';
import { card, sectionLabel } from '../lib/ui.ts';
import { registerBlock, Refusal, type BlockCtx } from './render.tsx';

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

// ---- header ------------------------------------------------------------

registerBlock('header', (_block, ctx) => {
  const e = subject(ctx);
  if (!e) return <Refusal>no entity to head</Refusal>;
  const accent =
    (e.type && (ctx.records.accents?.[e.type] as string | undefined)) ??
    undefined;
  return (
    <header className="flex items-baseline gap-3 px-1">
      <h1 className="font-serif text-2xl text-stone-100">{e.name}</h1>
      {e.type && (
        <span
          className={sectionLabel}
          style={accent ? { color: accent } : undefined}
        >
          {e.type}
        </span>
      )}
    </header>
  );
});

// ---- list --------------------------------------------------------------

registerBlock('list', (block, ctx) => {
  const e = subject(ctx);
  const name = typeof block.list === 'string' ? block.list : '';
  if (!name) return <Refusal>a list block with no list</Refusal>;
  const entries = entriesOf(e, name);
  return (
    <section className={`${card} flex flex-col gap-2`}>
      <p className={sectionLabel}>{name}</p>
      {entries.length === 0 && <Refusal>nothing here yet</Refusal>}
      {entries.map((entry) => (
        <div key={entry.name} className="flex items-baseline gap-2">
          <span className="text-sm text-stone-200">{entry.name}</span>
          {entry.value !== undefined && (
            <span className="ml-auto font-mono text-sm text-stone-300">
              {entry.value}
              {entry.max !== undefined && (
                <span className="text-stone-600"> / {entry.max}</span>
              )}
            </span>
          )}
        </div>
      ))}
    </section>
  );
});

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

// ---- rest (strays surface — the degradation contract, arranged) -------

registerBlock('rest', (block, ctx) => {
  const e = subject(ctx);
  if (!e) return null;
  const placed = new Set(
    (Array.isArray(block.except) ? block.except : []).map((n) =>
      String(n).toLowerCase(),
    ),
  );
  const strays = Object.keys(e.lists).filter(
    (k) => !placed.has(k.toLowerCase()),
  );
  if (!strays.length) return null;
  return (
    <>
      {strays.map((name) => (
        <section key={name} className={`${card} flex flex-col gap-2`}>
          <p className={sectionLabel}>{name}</p>
          {e.lists[name].map((entry) => (
            <div key={entry.name} className="flex items-baseline gap-2">
              <span className="text-sm text-stone-200">{entry.name}</span>
              {entry.value !== undefined && (
                <span className="ml-auto font-mono text-sm text-stone-300">
                  {entry.value}
                  {entry.max !== undefined && (
                    <span className="text-stone-600"> / {entry.max}</span>
                  )}
                </span>
              )}
            </div>
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
                <RenderInColumn key={j} block={b} ctx={ctx} />
              ) : null,
            )}
        </div>
      ))}
    </div>
  );
});

import { RenderBlock } from './render.tsx';
import type { PanelBlock } from '../../core/panels.ts';

function RenderInColumn({ block, ctx }: { block: PanelBlock; ctx: BlockCtx }) {
  return <RenderBlock block={block} ctx={ctx} />;
}

// ---- placeholders that the port will fill -----------------------------

for (const name of ['statuses', 'children', 'turn', 'tool']) {
  registerBlock(name, (block) => (
    <Refusal>
      '{String(block.tool ?? name)}' isn't ported to the new client yet
    </Refusal>
  ));
}
