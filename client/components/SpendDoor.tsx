// The way in to a declared advancement menu — the door and the menu
// behind it, in one block.
//
// It lived in the seat chrome, which synthesized a block carrying an
// `onOpen` callback because only code could open the overlay. §M-5a
// takes the chrome apart, and 'More' becomes an ordinary `.panel` file
// — a declaration cannot write a function into JSON, so the block had
// to become self-sufficient or the file could never carry it. It reads
// exactly what every other block reads: the subject and the merged
// records (`spends` — a system that declares none grows no button).
//
// The face is SUMMONED (§L phase 3) and `SpendFloor` is the answer for
// `undefined`: a system that prints its own advancement page ships
// `SpendMenu.tsx` and gets it; a system that ships none still gets a
// working menu, because a price and a counter need no vocabulary.

import { useEffect, useState } from 'react';
import type { Entity } from '../../core/entity.ts';
import { locate, toSpends, type SpendPlan } from '../../core/effects.ts';
import { numberOf } from '../../core/entity.ts';
import type { Template } from '../../core/stamp.ts';
import { api } from '../lib/api.ts';
import { presentationOf, useSystemFaces } from '../lib/presentations.ts';
import { usePanelNote } from '../lib/rules.ts';
import { applyPlan, loadCatalog, spendWorld } from '../lib/spend.ts';
import { card, sectionLabel } from '../lib/ui.ts';
import type { BlockCtx } from '../panels/render.tsx';
import { SpendFloor, type SpendMenuProps } from './SpendFloor.tsx';

/**
 * The menu, opened over whatever screen is showing.
 *
 * Bounded on purpose (rule 6): the PAGE never scrolls, on either family
 * of glass, so the overlay is a fixed panel with a max height and its
 * own scroll region — the "deliberate shelf" exemption, which is the
 * only kind of scrolling a screwed-down panel may be asked for.
 */
function SpendOverlay({
  ctx,
  entity,
  onClose,
}: {
  ctx: BlockCtx;
  entity: Entity;
  onClose: () => void;
}) {
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [catalog, setCatalog] = useState<Template[]>([]);
  const note = usePanelNote();
  useSystemFaces();
  useEffect(() => {
    let cancelled = false;
    loadCatalog().then((all) => {
      if (!cancelled) setCatalog(all);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const spends = toSpends(ctx.records.spends);
  if (!spends) return null;
  const accent = entity.type
    ? (ctx.records.accents?.[entity.type] as string | undefined)
    : undefined;
  const Menu = presentationOf<typeof SpendFloor>('SpendMenu') ?? SpendFloor;
  const props: SpendMenuProps = {
    spends,
    world: spendWorld(entity, ctx.records, catalog),
    note: note(spends.label ?? spends.counter),
    accent,
    onSet: (write) => {
      void api(`/api/entities/${entity.id}/entry`, { body: write });
    },
    onBuy: (plan: SpendPlan) =>
      applyPlan(entity.id, plan, catalog).then(
        () => setProblem(undefined),
        (err: unknown) => {
          // Never silent: a purchase the server refused (stamping is the
          // DM's own door) says so in the server's own words, and the
          // writes that DID land are visible on the sheet behind this.
          setProblem(err instanceof Error ? err.message : String(err));
          throw err;
        },
      ),
  };
  return (
    <div
      role="dialog"
      aria-label={spends.label ?? spends.counter}
      className="fixed inset-0 z-30 flex items-center justify-center bg-stone-950/80 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-[34rem] flex-col overflow-y-auto rounded-xl border border-stone-700 bg-stone-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-end px-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            aria-label="close"
            className="rounded-md px-2 py-1 text-sm text-stone-400 hover:bg-stone-800 hover:text-stone-200"
          >
            ✕
          </button>
        </div>
        <Menu {...props} />
        {problem && <p className="px-4 pb-4 text-sm italic text-stone-500">{problem}</p>}
      </div>
    </div>
  );
}

/**
 * The door itself. Deliberately NOT a chip on the top bar: that bar
 * carries what a TURN spends (`use`), and this is what a CAREER spends
 * — the old app kept it on More as `PrestigePanel`, and so does teller.
 */
export function SpendDoor({ ctx }: { ctx: BlockCtx }) {
  const [open, setOpen] = useState(false);
  const entity = ctx.entity as Entity | undefined;
  const spends = toSpends(ctx.records.spends);
  if (!entity || !spends) return null;
  const label = spends.label ?? spends.counter;
  const wallet = numberOf(locate(entity, spends.counter)?.entry) ?? 0;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`${label}: ${wallet}`}
        className={`${card} flex items-center gap-3 text-left transition-colors hover:bg-stone-800/40`}
      >
        <span className={sectionLabel}>{label}</span>
        <span
          className="flex h-7 min-w-[2.6rem] items-center justify-center rounded-full border px-2.5 font-mono text-sm text-stone-100"
          style={{
            borderColor: 'var(--sheet-accent, #f59e0b)',
            background: 'color-mix(in srgb, var(--sheet-accent, #f59e0b) 12%, transparent)',
          }}
        >
          {wallet}
        </span>
        <span className="ml-auto text-xs uppercase tracking-widest text-stone-500">open ▸</span>
      </button>
      {open && <SpendOverlay ctx={ctx} entity={entity} onClose={() => setOpen(false)} />}
    </>
  );
}
