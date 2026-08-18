// The minimal loop's three views, routed by query string:
//
//   /                → console: roster + create + stamp + boards
//   /?entity=<id>    → one entity's bare panel (console actor)
//   /?seat=<id>      → the same panel, as that seat (actor seat:<id>)
//   /?board=<id>     → one board's live state, primitive on purpose
//
// SSE nudges a refetch. A refetch never clobbers a control someone is
// typing in — if focus is in a field, the nudge waits for the next one.

import { renderPanel } from '/panel.js';

const app = document.getElementById('app');
const params = new URLSearchParams(location.search);

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}

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

// ---------------------------------------------------------------- views

async function consoleView() {
  const [campaign, roster, boards] = await Promise.all([
    api('GET', '/api/campaign'),
    api('GET', '/api/entities'),
    api('GET', '/api/boards'),
  ]);
  const bestiary = await api('GET', '/api/stack/templates/bestiary');

  app.replaceChildren(
    el('h1', {}, campaign.manifest.name),
    el(
      'div',
      { class: 'crumb' },
      campaign.system
        ? `${campaign.system.name} · packs: ${campaign.packs.map((p) => p.name).join(', ') || '(none)'}`
        : 'no system loaded',
      ...campaign.missing.map((m) =>
        el('span', { class: 'missing' }, `  MISSING ${m.slot}: ${m.ref.name}`),
      ),
    ),
    el('h2', {}, 'roster'),
    el(
      'div',
      { class: 'roster' },
      ...roster.map((row) =>
        el(
          'div',
          { class: 'row' },
          el(
            'button',
            { class: 'open', onclick: () => (location.search = `?entity=${row.id}`) },
            `${row.name}${row.type ? ` · ${row.type}` : ''}`,
          ),
          el('a', { href: `/?seat=${row.id}`, title: 'open as this seat' }, 'seat'),
          el(
            'button',
            {
              class: 'danger',
              onclick: async () => {
                if (!confirm(`remove ${row.name}?`)) return;
                await api('DELETE', `/api/entities/${row.id}`);
                consoleView();
              },
            },
            '×',
          ),
        ),
      ),
      el(
        'button',
        {
          class: 'add',
          onclick: async () => {
            const name = prompt('name?');
            if (!name || !name.trim()) return;
            const made = await api('POST', '/api/entities', {
              draft: { name: name.trim() },
              actor: 'console',
            });
            location.search = `?entity=${made.id}`;
          },
        },
        '+ new entity',
      ),
      bestiary.length
        ? el(
            'div',
            { class: 'row' },
            el('span', { class: 'dim' }, 'stamp:'),
            ...bestiary.map((t) =>
              el(
                'button',
                {
                  title: t.id,
                  onclick: async () => {
                    await api('POST', '/api/stamp', {
                      slot: 'bestiary',
                      templateId: t.id,
                      actor: 'console',
                    });
                    consoleView();
                  },
                },
                t.name,
              ),
            ),
          )
        : '',
    ),
    el('h2', {}, 'boards'),
    ...boards.map((b) =>
      el('div', { class: 'row' }, el('a', { href: `/?board=${b.id}` }, b.name)),
    ),
    el('h2', {}, 'log'),
    el('div', { id: 'log', class: 'dim' }, 'loading…'),
  );

  const events = await api('GET', '/api/events?limit=12');
  document
    .getElementById('log')
    ?.replaceChildren(
      ...events.map((e) =>
        el('div', {}, `${e.createdAt.slice(11, 19)} · ${e.actor} · ${e.kind}`),
      ),
    );
}

async function entityView(id, actor) {
  const entity = await api('GET', `/api/entities/${id}`);
  if (entity.error) {
    app.replaceChildren(el('p', { class: 'missing' }, entity.error));
    return;
  }
  const save = async () => {
    await api('PUT', `/api/entities/${id}`, { entity, actor });
    render();
  };
  const render = () => {
    app.replaceChildren(
      actor === 'console'
        ? el('div', { class: 'crumb' }, el('a', { href: '/' }, '← console'))
        : el('div', { class: 'crumb' }, `seat · ${entity.name}`),
      renderPanel(entity, save),
      el(
        'details',
        {},
        el('summary', { class: 'dim' }, 'reads as (resolved through templates)'),
        el('pre', { id: 'resolved' }, '…'),
      ),
    );
    api('GET', `/api/entities/${id}?resolved=1`).then((resolved) => {
      const target = document.getElementById('resolved');
      if (target) target.textContent = JSON.stringify(resolved, null, 2);
    });
  };
  render();
}

async function boardView(id) {
  const [boards, roster] = await Promise.all([
    api('GET', '/api/boards'),
    api('GET', '/api/entities'),
  ]);
  const board = boards.find((b) => b.id === id);
  const state = (await api('GET', `/api/board-state/${id}`)) ?? {};
  const placements = Array.isArray(state.placements) ? state.placements : [];
  // The placement stores where; the ENTITY supplies who (§5) — derived
  // at render, so a renamed character renames their token for free.
  const names = new Map(roster.map((r) => [r.id, r.name]));
  const whoOf = (p) =>
    p.label ?? (p.entityId ? (names.get(p.entityId) ?? `missing: ${p.entityId}`) : '?');
  const save = async () => {
    await api('PUT', `/api/board-state/${id}`, {
      data: { ...state, placements },
      actor: 'console',
    });
    boardView(id);
  };

  app.replaceChildren(
    el('div', { class: 'crumb' }, el('a', { href: '/' }, '← console')),
    el('h1', {}, board ? board.name : id),
    el('h2', {}, 'placements'),
    el(
      'table',
      {},
      el('tr', {}, el('th', {}, 'who'), el('th', {}, 'u'), el('th', {}, 'v'), el('th', {}, '')),
      ...placements.map((p, i) =>
        el(
          'tr',
          {},
          el('td', { title: p.entityId ?? '' }, whoOf(p)),
          el('td', {}, String(p.u)),
          el('td', {}, String(p.v)),
          el(
            'td',
            {},
            el(
              'button',
              {
                class: 'danger',
                onclick: () => {
                  placements.splice(i, 1);
                  save();
                },
              },
              '×',
            ),
          ),
        ),
      ),
    ),
    el(
      'button',
      {
        class: 'add',
        onclick: () => {
          const label = prompt('label (or entity id)?');
          if (!label) return;
          const u = Number(prompt('u?') ?? 0) || 0;
          const v = Number(prompt('v?') ?? 0) || 0;
          const placement = { u, v, sizeInches: 1 };
          if (label.startsWith('ent_')) placement.entityId = label;
          else placement.label = label;
          placements.push(placement);
          save();
        },
      },
      '+ place',
    ),
  );
}

// ---------------------------------------------------------------- boot

function current() {
  if (params.get('seat')) return entityView(params.get('seat'), `seat:${params.get('seat')}`);
  if (params.get('entity')) return entityView(params.get('entity'), 'console');
  if (params.get('board')) return boardView(params.get('board'));
  return consoleView();
}

const stream = new EventSource('/api/stream');
stream.onmessage = () => {
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
  current();
};

current();
