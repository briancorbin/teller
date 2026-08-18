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
 * The whole seat for one entity. `reads` is the resolved reading,
 * `stored` the sparse half; `writeEntry(edit)` posts one touch and
 * `saveStored(entity)` PUTs the stored half (name, notes — the fields
 * that never belonged to a template).
 */
export function renderSeat(stored, reads, writeEntry, saveStored) {
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
