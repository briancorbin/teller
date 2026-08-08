import { useState } from 'react';
import type { Field } from '../../worker/types';
import { btnGhost, input, sectionLabel } from '../lib/ui';

// Static-ish stats: AC, speed, passive perception, whatever the system
// (or the table) decides matters. Values are strings on purpose —
// "30 ft", "17 (19 w/ shield)" are all legal. Track, don't compute.

export function FieldSection({
  fields,
  onChange,
  editable = false,
  label = 'Stats',
}: {
  fields: Field[];
  onChange: (next: Field[]) => void;
  editable?: boolean;
  label?: string;
}) {
  const [editing, setEditing] = useState(false);

  const update = (key: string, patch: Partial<Field>) =>
    onChange(fields.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  const remove = (key: string) => onChange(fields.filter((f) => f.key !== key));
  const add = () =>
    onChange([
      ...fields,
      { key: `f${Date.now().toString(36)}`, label: 'Label', value: '' },
    ]);

  if (fields.length === 0 && !editable) return null;

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
      {editing ? (
        <div className="space-y-2">
          {fields.map((field) => (
            <div key={field.key} className="flex items-center gap-2">
              <input
                className={`${input} w-36`}
                defaultValue={field.label}
                onBlur={(e) => update(field.key, { label: e.target.value })}
                aria-label="field label"
              />
              <input
                className={`${input} min-w-0 flex-1`}
                defaultValue={field.value}
                onBlur={(e) => update(field.key, { value: e.target.value })}
                aria-label="field value"
              />
              <button className={btnGhost} onClick={() => remove(field.key)} aria-label="remove field">
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {fields.map((field) => (
            <div
              key={field.key}
              className="rounded-lg border border-stone-800 bg-stone-900 px-3 py-1.5 text-center"
            >
              <div className="font-mono text-lg text-stone-100">
                {field.value || '—'}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-stone-500">
                {field.label}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
