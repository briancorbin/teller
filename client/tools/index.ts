// The tool registry — §E's second kind of panel. A tool panel's body
// is one `tool` block whose behavior is code; each tool lives in its
// own file so they port independently. Registering here is what makes
// a tool exist; the block renderer refuses names it can't find.

import type { ReactNode } from 'react';
import type { PanelBlock } from '../../core/panels.ts';
import type { BlockCtx } from '../panels/render.tsx';

export type ToolRenderer = (block: PanelBlock, ctx: BlockCtx) => ReactNode;

const tools = new Map<string, ToolRenderer>();

export function registerTool(name: string, render: ToolRenderer): void {
  tools.set(name, render);
}

export function toolOf(name: string): ToolRenderer | undefined {
  return tools.get(name);
}

// One import per tool — a tool that isn't imported doesn't exist.
import './roster.tsx';
import './runner.tsx';
import './encounters.tsx';
import './screens.tsx';
import './shelf.tsx';
import './plugins.tsx';
import './boards.tsx';
import './log.tsx';
