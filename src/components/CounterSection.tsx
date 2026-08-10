import { useState } from 'react';
import type { Counter } from '../../worker/types';
import { newLocalId } from '../lib/api';
import { bigBtn, btnGhost, iconBtn, input, sectionLabel } from '../lib/ui';
import { ClockFace } from './ClockFace';

// Renders ANY list of counters — HP, spell slots, Prestige, ammo. The
// component has no idea which game it's in; that's the point.

function CounterRow({
  counter,
  big,
  editing,
  onChange,
  onRemove,
}: {
  counter: Counter;
  big: boolean;
  editing: boolean;
  onChange: (next: Counter) => void;
  onRemove: () => void;
}) {
  const bump = (delta: number) => {
    let next = counter.current + delta;
    if (counter.max !== null) next = Math.min(next, counter.max);
    next = Math.max(next, 0);
    onChange({ ...counter, current: next });
  };

  if (editing) {
    const isClock = counter.display === 'clock';
    return (
      <div className="flex items-center gap-2">
        <input
          className={`${input} min-w-0 flex-1`}
          defaultValue={counter.name}
          onBlur={(e) => onChange({ ...counter, name: e.target.value })}
          aria-label="counter name"
        />
        <input
          className={`${input} w-20`}
          type="number"
          placeholder="max"
          defaultValue={counter.max ?? ''}
          onBlur={(e) =>
            onChange({
              ...counter,
              max: e.target.value === '' ? null : Number(e.target.value),
            })
          }
          aria-label="counter max"
        />
        <button
          className={`${btnGhost} ${isClock ? 'text-amber-300' : ''}`}
          disabled={counter.max === null}
          onClick={() =>
            onChange({ ...counter, display: isClock ? undefined : 'clock' })
          }
          aria-label={`render ${counter.name} as a ${isClock ? 'number' : 'progress clock'}`}
          title={
            counter.max === null
              ? 'set a max to render as a clock'
              : isClock
                ? 'render as a number'
                : 'render as a progress clock'
          }
        >
          ◔
        </button>
        <button
          className={`${btnGhost} ${counter.hidden ? 'text-amber-300' : ''}`}
          onClick={() => onChange({ ...counter, hidden: !counter.hidden || undefined })}
          aria-label={`${counter.hidden ? 'reveal' : 'hide'} ${counter.name}`}
          title={
            counter.hidden
              ? 'hidden from board & badge — tap to reveal'
              : 'hide from board & badge'
          }
        >
          {counter.hidden ? 'hidden' : 'hide'}
        </button>
        <button className={btnGhost} onClick={onRemove} aria-label="remove counter">
          ✕
        </button>
      </div>
    );
  }

  const low =
    counter.max !== null && counter.max > 0 && counter.current / counter.max <= 0.25;
  /** Nothing entered here yet — no ceiling, and nothing counted. */
  const blank = counter.max === null && counter.current === 0;
  const refillable = counter.max !== null && counter.current < counter.max;
  const clock = counter.display === 'clock' && counter.max !== null && counter.max > 0;

  return (
    <div className="flex items-center gap-3">
      <button className={big ? bigBtn : iconBtn} onClick={() => bump(-1)} aria-label={`decrease ${counter.name}`}>
        −
      </button>
      <div className="min-w-0 flex-1 text-center">
        {clock ? (
          <div className="flex flex-col items-center">
            <ClockFace
              current={counter.current}
              max={counter.max!}
              size={big ? 72 : 52}
              onClick={() => bump(1)}
              label={`${counter.name}: ${counter.current} of ${counter.max} — tap to advance`}
            />
          </div>
        ) : (
          <div
            className={`font-mono tabular-nums ${big ? 'text-3xl' : 'text-xl'} ${
              low ? 'text-red-400' : blank ? 'text-stone-600' : 'text-stone-100'
            }`}
          >
            {counter.current}
            {/*
              An unset ceiling is shown as "/—" rather than left off.
              A bounded stat whose max nobody has filled in — Health on a
              fresh character — otherwise renders as a bare "0", which
              reads as a corpse instead of an empty field. The dash says
              "no maximum", and a 0 under it is dimmed so a blank counter
              looks blank rather than alarming.
            */}
            <span className="text-stone-600">/{counter.max ?? '—'}</span>
          </div>
        )}
        <div className="truncate text-xs text-stone-400">
          {counter.name}
          {counter.hidden && <span className="ml-1 text-stone-600">· hidden</span>}
        </div>
      </div>
      <button className={big ? bigBtn : iconBtn} onClick={() => bump(1)} aria-label={`increase ${counter.name}`}>
        +
      </button>
      {counter.max !== null && (
        <button
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-sm text-stone-500 transition-colors hover:bg-stone-800 hover:text-amber-300 disabled:opacity-0"
          disabled={!refillable}
          onClick={() => onChange({ ...counter, current: counter.max! })}
          aria-label={`refill ${counter.name}`}
          title="refill to max"
        >
          ↻
        </button>
      )}
    </div>
  );
}

export function CounterSection({
  counters,
  onChange,
  editable = false,
  big = false,
  label = 'Counters',
}: {
  counters: Counter[];
  onChange: (next: Counter[]) => void;
  editable?: boolean;
  big?: boolean;
  label?: string;
}) {
  const [editing, setEditing] = useState(false);

  const update = (id: string, next: Counter) =>
    onChange(counters.map((c) => (c.id === id ? next : c)));
  const remove = (id: string) => onChange(counters.filter((c) => c.id !== id));
  const add = () =>
    onChange([
      ...counters,
      { id: newLocalId('ctr'), name: 'New counter', current: 0, max: null },
    ]);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <span className={sectionLabel}>{label}</span>
        {editable && (
          <div className="flex gap-1">
            {editing && (
              <button className={btnGhost} onClick={add}>
                + add
              </button>
            )}
            <button className={btnGhost} onClick={() => setEditing(!editing)}>
              {editing ? 'done' : 'edit'}
            </button>
          </div>
        )}
      </div>
      {counters.length === 0 && (
        <p className="text-sm text-stone-600">nothing tracked yet</p>
      )}
      <div className="space-y-2">
        {counters.map((counter) => (
          <CounterRow
            key={counter.id}
            counter={counter}
            big={big}
            editing={editing}
            onChange={(next) => update(counter.id, next)}
            onRemove={() => remove(counter.id)}
          />
        ))}
      </div>
    </section>
  );
}
