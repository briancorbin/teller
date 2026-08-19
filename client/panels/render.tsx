// Arrangement → DOM. A `.panel` is data (§E); this file is the
// renderer that walks its blocks. Degradation is the contract: an
// unknown block renders as a labeled refusal, a failed panel falls
// back to the floor, a subject panel with no entity says so — nothing
// blank, nothing silent.

import { Component, type ReactNode } from 'react';
import type { PanelBlock, PanelDef } from '../../core/panels.ts';
import { card, sectionLabel } from '../lib/ui.ts';

export type Glass = 'mounted' | 'held';

/** What every block receives — the seam that later becomes the rung-4
 * props contract (§E extended). Keep it clean: no globals. */
export type BlockCtx = {
  glass: Glass;
  /** Resolved subject entity, when the panel has one. */
  entity?: unknown;
  /** Merged records the identity layer consumes (accents, dials, …). */
  records: Record<string, Record<string, unknown>>;
  /** Sparse write to the subject (list, name, value/max/remove). */
  write?: (edit: Record<string, unknown>) => Promise<void>;
};

export type BlockRenderer = (block: PanelBlock, ctx: BlockCtx) => ReactNode;

const registry = new Map<string, BlockRenderer>();

export function registerBlock(name: string, render: BlockRenderer): void {
  registry.set(name, render);
}

export function Refusal({ children }: { children: ReactNode }) {
  return <p className="text-sm text-stone-600 italic">{children}</p>;
}

export function RenderBlock({
  block,
  ctx,
}: {
  block: PanelBlock;
  ctx: BlockCtx;
}) {
  const render = registry.get(block.block);
  if (!render)
    return <Refusal>this build doesn't know the block '{block.block}'</Refusal>;
  return <>{render(block, ctx)}</>;
}

/** Pick the authored arrangement for this glass — never reflow one
 * into the other (rule 6: two families, one question). */
export function arrangementOf(
  panel: PanelDef,
  glass: Glass,
): PanelBlock[] | undefined {
  return glass === 'mounted' ? (panel.mounted ?? panel.held) : (panel.held ?? panel.mounted);
}

class Boundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function PanelSurface({
  panel,
  ctx,
  fallback,
}: {
  panel: PanelDef;
  ctx: BlockCtx;
  fallback: ReactNode;
}) {
  const blocks = arrangementOf(panel, ctx.glass);
  if (!blocks?.length)
    return (
      <div className={card}>
        <p className={sectionLabel}>{panel.label ?? panel.name}</p>
        <Refusal>this panel declares no {ctx.glass} arrangement</Refusal>
      </div>
    );
  return (
    <Boundary fallback={fallback}>
      {blocks.map((b, i) => (
        <RenderBlock key={i} block={b} ctx={ctx} />
      ))}
    </Boundary>
  );
}
