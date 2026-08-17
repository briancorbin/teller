import { useState } from 'react';
import type { PackEntry, RulesPack, SystemTemplate } from '../../../worker/types';
import {
  findTag,
  sameTag,
  setTag,
  withoutTag,
  type Tag,
} from '../../../worker/tags';
import { InfoPopover } from './InfoPopover';
import { SheetPanel } from './SheetPanel';

// A standing scale (`SystemTemplate.ladders` — WiW's Reputation): one
// row per party, five tappable rungs, the current one lit. The roster
// comes from the pack section the ladder names — factions are world
// content, so the panel learns them at runtime and never from code —
// plus any stored standing whose name the roster doesn't know (strays
// never disappear).
//
// A standing is a held thing of the ladder's own kind, and the rungs
// are steppers over it (rule 1): tap a rung, the standing is written;
// tap the default rung and it is REMOVED, because "everyone starts
// Neutral" means the unstored state and a sheet full of stored defaults
// is noise in every bundle. The mod on the active rung is shown, never
// applied — the dice it modifies are in the player's hand.
//
// It used to be an ordinary field keyed `rep_<slug>`, so the party's
// name was slugged into a key and read back out of it, and every list
// of fields had to remember which ones were secretly standings. The
// party is the standing's NAME now (worker/kinds.ts).
//
// Standalone on purpose (blocks first, arrangement second). Horse
// bonds reuse the same shape as a second ladder, not a special case.

export function LadderPanel({
  ladder,
  held,
  packs = [],
  onHeld,
  lookup,
  note,
  fill = false,
}: {
  ladder: NonNullable<SystemTemplate['ladders']>[number];
  /** The standings this character holds on this ladder. */
  held: Tag[];
  packs?: RulesPack[];
  /** Absent on a surface that may look but not edit. */
  onHeld?: (next: Tag[]) => void;
  /** Finds a party's pack entry, so its description opens on tap. */
  lookup?: (name: string) => (PackEntry & { section: string }) | undefined;
  note?: string;
  fill?: boolean;
}) {
  const [openInfo, setOpenInfo] = useState<string | null>(null);

  // The roster: every entry name in the declared pack section, in pack
  // order, deduped across packs (campaign-declared order wins ties the
  // usual way — later read last).
  const roster: string[] = [];
  for (const pack of packs) {
    for (const section of pack.sections ?? []) {
      if (section.title !== ladder.section) continue;
      for (const entry of section.entries) {
        if (!roster.includes(entry.name)) roster.push(entry.name);
      }
    }
  }

  // Standings the character holds with parties no roster names.
  const strays = held.filter((t) => !roster.some((name) => sameTag(name, t)));
  const rows = [...roster, ...strays.map((t) => t.name)];

  const setStanding = (name: string, step: string) => {
    if (!onHeld) return;
    onHeld(
      step === ladder.defaultStep
        ? withoutTag(held, name)
        : setTag(held, name, step),
    );
  };

  const shown = openInfo ? lookup?.(openInfo) : undefined;

  return (
    <SheetPanel title={ladder.label} note={note ?? ladder.text} fill={fill} className="relative">
      <div className="divide-y divide-stone-800/80">
        {rows.map((name) => {
          const current = findTag(held, name)?.value ?? ladder.defaultStep;
          const entry = lookup?.(name);
          const active = ladder.steps.find((s) => s.label === current);
          return (
            <div
              key={name}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1"
            >
              <button
                type="button"
                disabled={!entry?.text}
                onClick={() => setOpenInfo(openInfo === name ? null : name)}
                aria-expanded={openInfo === name}
                aria-label={entry?.text ? `about ${name}` : name}
                className="min-w-[9rem] flex-1 rounded px-1 py-0.5 text-left text-[0.8rem] leading-tight text-stone-200 transition-colors enabled:hover:bg-stone-800/60 disabled:cursor-default"
              >
                {name}
              </button>
              <div className="flex items-center gap-1">
                {ladder.steps.map((step) => {
                  const lit = step.label === current;
                  return (
                    <button
                      key={step.label}
                      type="button"
                      disabled={!onHeld}
                      onClick={() => setStanding(name, step.label)}
                      aria-pressed={lit}
                      aria-label={`${name}: ${step.label}${step.mod ? ` (${step.mod})` : ''}`}
                      title={`${step.label}${step.mod ? ` ${step.mod}` : ''}`}
                      className="flex h-[1.15rem] w-[1.15rem] shrink-0 items-center justify-center rounded-[2px] border"
                      style={
                        lit
                          ? {
                              background: 'var(--sheet-accent, #f59e0b)',
                              borderColor: 'var(--sheet-accent, #f59e0b)',
                            }
                          : { borderColor: '#57534e' }
                      }
                    />
                  );
                })}
              </div>
              <span className="w-[7.5rem] font-mono text-[0.75rem] text-stone-400">
                {active ? (
                  <>
                    {active.label}
                    {active.mod && (
                      <span className="ml-1 text-stone-500">{active.mod}</span>
                    )}
                  </>
                ) : (
                  current
                )}
              </span>
            </div>
          );
        })}
      </div>

      {shown && <InfoPopover entry={shown} onClose={() => setOpenInfo(null)} />}
    </SheetPanel>
  );
}
