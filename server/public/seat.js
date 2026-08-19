// The seat — the first surface through the porting filter, and the
// resolve-with-sparse-write design made visible.
//
// The panel (panel.js) is the FLOOR: it edits stored values and shows
// the resolved reading to one side. The seat is a player's surface, so
// it flips the two: the player reads and edits the RESOLVED reading —
// the sheet as it plays — and every touch goes through one door
// (POST /entities/:id/entry), which stores only what was touched. The
// stored half stays sparse; the template stays underneath; the DM's
// panel still shows exactly what this character has made their own.
//
// Same control grammar as the floor (§7): the control follows the
// value's shape. What's different is only where a write lands.

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node[k] = v;
  }
  node.append(...children);
  return node;
}

function entryRow(list, entry, writeEntry) {
  const touch = (patch) => writeEntry({ list, name: entry.name, ...patch });

  if (entry.value === undefined && entry.max === undefined) {
    return el(
      'span',
      { class: 'chip' },
      entry.name,
      el('span', { class: 'x', title: 'remove', onclick: () => touch({ remove: true }) }, '×'),
    );
  }

  const name = el('span', { class: 'entry-name' }, entry.name);

  if (typeof entry.value === 'string') {
    return el(
      'div',
      { class: 'row' },
      name,
      el('input', {
        value: entry.value,
        onchange: (e) => touch({ value: e.target.value }),
      }),
    );
  }

  const value = typeof entry.value === 'number' ? entry.value : 0;
  const minus = el('button', { title: '−1', onclick: () => touch({ value: value - 1 }) }, '−');
  const plus = el('button', { title: '+1', onclick: () => touch({ value: value + 1 }) }, '+');

  if (typeof entry.max === 'number' && entry.max > 0) {
    const fill = el('div', { class: 'fill' });
    fill.style.width = `${Math.max(0, Math.min(100, (value / entry.max) * 100))}%`;
    return el(
      'div',
      { class: 'row' },
      name,
      minus,
      el('div', { class: 'bar' }, fill, el('div', { class: 'cap' }, `${value} / ${entry.max}`)),
      plus,
    );
  }

  return el(
    'div',
    { class: 'row' },
    name,
    minus,
    el('span', { class: 'num' }, String(value)),
    plus,
  );
}

function addEntry(list, writeEntry) {
  return el(
    'button',
    {
      class: 'add',
      onclick: () => {
        const name = prompt('name?');
        if (!name || !name.trim()) return;
        const raw = (prompt('value? (blank = held, number = count, words = text)') ?? '').trim();
        const edit = { list, name: name.trim() };
        if (raw) {
          const asNumber = Number(raw);
          edit.value = Number.isFinite(asNumber) ? asNumber : raw;
        }
        writeEntry(edit);
      },
    },
    '+ add',
  );
}

/**
 * The whole seat for one entity, in the ASSIGNED arrangement.
 *
 * Layouts are data, and the fact that there is more than one is the
 * point (the old world's seat-layouts.ts, ported): nobody knows what a
 * seat should look like until players reach for one. Two survive the
 * filter today — 'sheet' (arranged like the paper) and 'bare' (the
 * floor's grammar). A layout is presentation; neither can do anything
 * the other can't.
 *
 * `reads` is the resolved reading, `stored` the sparse half;
 * `writeEntry(edit)` posts one touch and `saveStored(entity)` PUTs the
 * stored half (name, notes — what never belonged to a template).
 * `stack` is {statuses, kinds} — the system's declarations, merged.
 */
export const SEAT_LAYOUTS = [
  { id: 'sheet', name: 'Sheet', blurb: 'Arranged like the paper you already know.' },
  { id: 'bare', name: 'Bare', blurb: "The floor's grammar — every value, one control each." },
];

export function renderSeat(stored, reads, writeEntry, saveStored, stack = {}, layout = 'sheet') {
  if (layout === 'bare') return renderBare(stored, reads, writeEntry, saveStored);
  return renderSheet(stored, reads, writeEntry, saveStored, stack);
}

function renderBare(stored, reads, writeEntry, saveStored) {
  const root = el('div', { class: 'panel seat' });

  const from = reads.refs?.from;
  root.append(
    el(
      'h1',
      {},
      el('input', {
        value: reads.name,
        onchange: (e) => {
          stored.name = e.target.value.trim() || stored.name;
          saveStored(stored);
        },
      }),
    ),
    el(
      'div',
      { class: 'row dim' },
      reads.type ? el('span', {}, reads.type) : '',
      from ? el('span', { class: 'chip ref' }, `from: ${from.name}`) : '',
    ),
  );

  for (const [listName, entries] of Object.entries(reads.lists ?? {})) {
    root.append(el('h2', {}, listName));
    for (const entry of entries) root.append(entryRow(listName, entry, writeEntry));
    root.append(addEntry(listName, writeEntry));
  }
  root.append(
    el('h2', {}, ''),
    el(
      'button',
      {
        class: 'add',
        onclick: () => {
          const name = prompt('list name?');
          if (!name || !name.trim()) return;
          const first = prompt('first entry?');
          if (!first || !first.trim()) return;
          writeEntry({ list: name.trim(), name: first.trim() });
        },
      },
      '+ add list',
    ),
  );

  root.append(el('h2', {}, 'notes'));
  root.append(
    el('textarea', {
      value: stored.notes ?? '',
      onchange: (e) => {
        const notes = e.target.value;
        if (notes.trim()) stored.notes = notes;
        else delete stored.notes;
        saveStored(stored);
      },
    }),
  );

  return root;
}

// ---------------------------------------------------------------- sheet
//
// "Arranged like the paper you already know." The skills ARE the
// left-hand column — moving them elsewhere is the one thing that would
// stop it reading as the sheet — and the statuses panel is the whole
// system list with a severity box on each: a menu of what can happen
// to you, not a report of what has. Severity writes go through the
// conditions kind, so easing one to nothing clears it here exactly as
// it does everywhere (the declaration's zero-rule, not this file's).

function sameName(a, b) {
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

function findIn(entries, name) {
  return (entries ?? []).find((e) => sameName(e.name, name));
}

function bigCounter(list, entry, writeEntry) {
  const value = typeof entry.value === 'number' ? entry.value : 0;
  const touch = (next) => writeEntry({ list, name: entry.name, value: next });
  const box = el('div', { class: 'vital' });
  box.append(
    el('div', { class: 'vital-name' }, entry.name),
    el(
      'div',
      { class: 'vital-row' },
      el('button', { class: 'big', onclick: () => touch(value - 1) }, '−'),
      el(
        'div',
        { class: 'vital-value' },
        String(value),
        typeof entry.max === 'number' ? el('span', { class: 'vital-max' }, ` / ${entry.max}`) : '',
      ),
      el('button', { class: 'big', onclick: () => touch(value + 1) }, '+'),
    ),
  );
  if (typeof entry.max === 'number' && entry.max > 0) {
    const fill = el('div', { class: 'fill' });
    fill.style.width = `${Math.max(0, Math.min(100, (value / entry.max) * 100))}%`;
    box.append(el('div', { class: 'bar wide' }, fill));
  }
  return box;
}

function renderSheet(stored, reads, writeEntry, saveStored, stack) {
  const root = el('div', { class: 'sheet' });
  const lists = reads.lists ?? {};
  const conditionsKind = (stack.kinds ?? []).find((k) => sameName(k.name, 'conditions'));
  const conditionsLabel = conditionsKind?.label ?? 'Conditions';
  const cap = conditionsKind?.domain?.cap;

  // -- header: who this is
  const meta = lists.meta ?? [];
  root.append(
    el(
      'header',
      { class: 'sheet-head' },
      el('input', {
        class: 'sheet-name',
        value: reads.name,
        onchange: (e) => {
          stored.name = e.target.value.trim() || stored.name;
          saveStored(stored);
        },
      }),
      el(
        'div',
        { class: 'sheet-sub dim' },
        reads.type ?? '',
        ...meta.map((m) => el('span', {}, ` · ${m.name}: ${m.value ?? ''}`)),
        reads.refs?.from ? el('span', {}, ` · from ${reads.refs.from.name}`) : '',
      ),
    ),
  );

  const columns = el('div', { class: 'sheet-cols' });
  root.append(columns);

  // -- left: the skills column, then the statuses menu
  const left = el('div', { class: 'sheet-col' });
  if (lists.skills?.length) {
    left.append(el('h2', {}, 'skills'));
    for (const skill of lists.skills) {
      left.append(
        el(
          'div',
          { class: 'skill-row' },
          el('span', { class: 'skill-name' }, skill.name),
          el('input', {
            class: 'skill-die',
            value: skill.value ?? '',
            onchange: (e) =>
              writeEntry({ list: 'skills', name: skill.name, value: e.target.value }),
          }),
        ),
      );
    }
  }
  const statuses = stack.statuses ?? [];
  if (statuses.length) {
    left.append(el('h2', {}, conditionsLabel.toLowerCase()));
    for (const status of statuses) {
      const held = findIn(lists.conditions, status.name);
      const severity = typeof held?.value === 'number' ? held.value : held ? 1 : 0;
      const touch = (next) =>
        writeEntry({ list: 'conditions', name: status.name, value: next });
      const uncapped = status.uncapped === true;
      left.append(
        el(
          'div',
          { class: `status-row${severity ? ' held' : ''}` },
          el(
            'span',
            { class: 'status-name', title: status.relief ? `relieved by ${status.relief}` : '' },
            status.name,
          ),
          status.relief ? el('span', { class: 'status-relief dim' }, status.relief) : '',
          el('button', { onclick: () => touch(severity - 1) }, '−'),
          el(
            'span',
            { class: 'status-severity' },
            severity ? String(severity) : '·',
            !uncapped && typeof cap === 'number' && severity
              ? el('span', { class: 'dim' }, `/${cap}`)
              : '',
          ),
          el('button', { onclick: () => touch(severity + 1) }, '+'),
        ),
      );
    }
  }
  columns.append(left);

  // -- middle: what you spend in a fight, big
  const mid = el('div', { class: 'sheet-col' });
  const resources = lists.resources ?? [];
  const vitals = resources.filter((r) => typeof r.max === 'number' && r.max > 0);
  const ledger = resources.filter((r) => !(typeof r.max === 'number' && r.max > 0));
  if (vitals.length) {
    mid.append(el('h2', {}, 'vitals'));
    for (const v of vitals) mid.append(bigCounter('resources', v, writeEntry));
  }
  if (ledger.length) {
    mid.append(el('h2', {}, 'pockets'));
    for (const entry of ledger) {
      const value = typeof entry.value === 'number' ? entry.value : 0;
      mid.append(
        el(
          'div',
          { class: 'ledger-row' },
          el('span', { class: 'entry-name' }, entry.name),
          el('button', { onclick: () => writeEntry({ list: 'resources', name: entry.name, value: value - 1 }) }, '−'),
          el('span', { class: 'num' }, String(value)),
          el('button', { onclick: () => writeEntry({ list: 'resources', name: entry.name, value: value + 1 }) }, '+'),
        ),
      );
    }
  }
  columns.append(mid);

  // -- right: everything written down
  const right = el('div', { class: 'sheet-col' });
  for (const [listName, entries] of Object.entries(lists)) {
    if (['skills', 'resources', 'conditions', 'meta'].includes(listName)) continue;
    right.append(el('h2', {}, listName));
    for (const entry of entries) {
      if (typeof entry.value === 'string' && entry.value.length > 40) {
        right.append(
          el('div', { class: 'trait' }, el('div', { class: 'trait-name' }, entry.name), entry.value),
        );
      } else {
        right.append(entryRow(listName, entry, writeEntry));
      }
    }
  }
  right.append(el('h2', {}, 'notes'));
  right.append(
    el('textarea', {
      value: stored.notes ?? '',
      onchange: (e) => {
        const notes = e.target.value;
        if (notes.trim()) stored.notes = notes;
        else delete stored.notes;
        saveStored(stored);
      },
    }),
  );
  columns.append(right);

  return root;
}
