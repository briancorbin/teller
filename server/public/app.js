// The minimal loop's client, now living under rule 7.
//
// Two ways in, matching the two families of authority:
//
//   * CONSOLE — the DM's own device. Opens `/?console`, pastes the one
//     key (printed by the host's terminal), and holds it in storage.
//     `/?entity=` and `/?board=` are console sub-pages.
//   * SCREEN — everything else. A bare visit is a screen: it says
//     hello, keeps its display id, shows its pairing code until the DM
//     adopts it, then renders whatever it was ASSIGNED. A screen never
//     chooses what it is.
//
// The stream takes a ticket (an EventSource can't send a header); an
// 'assign' nudge makes a screen re-ask what it is, 'identify' flashes
// its name. SSE nudges a refetch; a refetch never clobbers a control
// someone is typing in.

import { renderPanel } from '/panel.js';
import { renderSeat } from '/seat.js';

const app = document.getElementById('app');

const stored = {
  get key() { return localStorage.getItem('teller.key') ?? ''; },
  set key(v) { v ? localStorage.setItem('teller.key', v) : localStorage.removeItem('teller.key'); },
  get display() { return localStorage.getItem('teller.display') ?? ''; },
  set display(v) { v ? localStorage.setItem('teller.display', v) : localStorage.removeItem('teller.display'); },
};

async function api(method, path, body) {
  const headers = {};
  if (stored.key) headers['x-teller-key'] = stored.key;
  if (stored.display) headers['x-teller-display'] = stored.display;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    method,
    headers,
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

const ROLES = ['console', 'table', 'board', 'art', 'seat', 'badge', 'blank'];

// ---------------------------------------------------------------- console

async function consoleView() {
  const campaign = await api('GET', '/api/campaign');
  if (campaign.error) return keyView(campaign.error);
  const [roster, boards, displays, turn, encounters] = await Promise.all([
    api('GET', '/api/entities'),
    api('GET', '/api/boards'),
    api('GET', '/api/displays'),
    api('GET', '/api/turn'),
    api('GET', '/api/templates/encounters'),
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
      el('span', { class: 'dim' }, '  ·  '),
      el('a', { href: '#', onclick: (e) => { e.preventDefault(); stored.key = ''; location.hash = 'console'; current(); } }, 'lock'),
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
            { class: 'open', onclick: () => (location.hash = `entity=${row.id}`) },
            `${row.name}${row.type ? ` · ${row.type}` : ''}`,
          ),
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
            });
            location.hash = `entity=${made.id}`;
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
    el('h2', {}, 'turn'),
    turnPanel(turn, roster),
    el('h2', {}, 'encounters'),
    ...encounters.map((enc) =>
      el(
        'div',
        { class: 'row' },
        el('span', {}, enc.name),
        el('span', { class: 'dim' }, `${(enc.foes ?? []).reduce((n, f) => n + (f.count ?? 1), 0)} foes`),
        el(
          'button',
          {
            onclick: async () => {
              await api('POST', `/api/encounters/${enc.id}/deploy`, {});
              consoleView();
            },
          },
          'deploy',
        ),
        el(
          'button',
          {
            class: 'danger',
            onclick: async () => {
              if (!confirm(`remove ${enc.name}?`)) return;
              await api('DELETE', `/api/templates/encounters/${enc.id}`);
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
          const name = prompt('encounter name?');
          if (!name || !name.trim()) return;
          const foes = [];
          while (bestiary.length) {
            const lines = bestiary.map((t, i) => `${i + 1}. ${t.name}`).join('\n');
            const pick = prompt(`add which foe? (blank = done)\n${lines}`);
            if (!pick || !pick.trim()) break;
            const t = bestiary[Number(pick) - 1];
            if (!t) continue;
            const count = Number(prompt(`how many ${t.name}?`) ?? 1) || 1;
            foes.push({ templateId: t.id, count });
          }
          await api('POST', '/api/templates/encounters', {
            template: { name: name.trim(), foes },
          });
          consoleView();
        },
      },
      '+ new encounter',
    ),
    el('h2', {}, 'screens'),
    ...displays.map((d) => screenRow(d, roster, boards)),
    el(
      'div',
      { class: 'row' },
      el('input', { id: 'claim-code', placeholder: 'pairing code', maxLength: 6 }),
      el(
        'button',
        {
          class: 'add',
          onclick: async () => {
            const code = document.getElementById('claim-code')?.value ?? '';
            if (!code.trim()) return;
            const claimed = await api('POST', '/api/displays/claim', {
              code,
              name: prompt('name this screen?') ?? undefined,
            });
            if (claimed.error) alert(claimed.error);
            consoleView();
          },
        },
        'adopt',
      ),
    ),
    el('h2', {}, 'boards'),
    ...boards.map((b) =>
      el('div', { class: 'row' }, el('a', { href: `#board=${b.id}` }, b.name)),
    ),
    el('h2', {}, 'log'),
    el('div', { id: 'log', class: 'dim' }, 'loading…'),
  );

  const events = await api('GET', '/api/events?limit=12');
  document
    .getElementById('log')
    ?.replaceChildren(
      ...(events.error ? [] : events).map((e) =>
        el('div', {}, `${e.createdAt.slice(11, 19)} · ${e.actor} · ${e.kind}`),
      ),
    );
}

/** The runner: an ordered list, a current index, buttons that walk it. */
function turnPanel(turn, roster) {
  const names = new Map(roster.map((r) => [r.id, r.name]));
  const whoOf = (e) =>
    e.label ?? (e.entityId ? (names.get(e.entityId) ?? `missing: ${e.entityId}`) : '?');
  const op = async (body) => {
    await api('POST', '/api/turn', body);
    consoleView();
  };
  return el(
    'div',
    {},
    el(
      'div',
      { class: 'row' },
      el('span', { class: 'dim' }, `round ${turn.round}`),
      el('button', { onclick: () => op({ op: 'next' }) }, turn.turn === null ? 'start' : 'next'),
      el('button', { onclick: () => op({ op: 'prev' }) }, 'prev'),
      el('button', { onclick: () => op({ op: 'end' }) }, 'end'),
      el(
        'button',
        { onclick: () => op({ op: 'rolling', on: !turn.rolling }) },
        turn.rolling ? 'stop rolling' : 'roll!',
      ),
      turn.turn !== null
        ? el(
            'button',
            {
              title: 'ask the plugins for a proposal — words, nothing else',
              onclick: async () => {
                const out = await api('POST', '/api/propose/turn', {});
                const target = document.getElementById('proposals');
                if (!target) return;
                if (!out.providers) {
                  target.textContent = 'no plugin offers propose.turn (install + enable one)';
                  return;
                }
                target.textContent = out.proposals
                  .map((p) =>
                    p.error
                      ? `${p.plugin}: ${p.error}`
                      : p.proposal === undefined || p.proposal === null
                        ? `${p.plugin}: (nothing — configured?)`
                        : JSON.stringify(p.proposal, null, 2),
                  )
                  .join('\n\n');
              },
            },
            'assist',
          )
        : '',
    ),
    el('pre', { id: 'proposals', class: 'dim proposals' }, ''),
    ...turn.order.map((e, i) =>
      el(
        'div',
        { class: 'row' },
        el('span', { class: i === turn.turn ? '' : 'dim' }, i === turn.turn ? '▶' : '·'),
        el('span', { class: 'entry-name', title: e.entityId ?? '' }, whoOf(e)),
        turn.rolling || typeof e.score === 'number'
          ? el('input', {
              class: 'score',
              value: typeof e.score === 'number' ? String(e.score) : '',
              placeholder: '—',
              onchange: (ev) => {
                const n = Number(ev.target.value);
                op({ op: 'score', entryId: e.id, score: Number.isFinite(n) ? n : null });
              },
            })
          : '',
        el(
          'span',
          { class: 'x dim', title: 'remove', onclick: () => op({ op: 'remove', entryId: e.id }) },
          '×',
        ),
      ),
    ),
    el(
      'button',
      {
        class: 'add',
        onclick: () => {
          const lines = roster.map((r, i) => `${i + 1}. ${r.name}`).join('\n');
          const pick = prompt(`add who? (a number, or type a label)\n${lines}`);
          if (!pick || !pick.trim()) return;
          const linked = roster[Number(pick) - 1];
          op(linked ? { op: 'add', entityId: linked.id } : { op: 'add', label: pick.trim() });
        },
      },
      '+ add to order',
    ),
  );
}

/** One adopted-or-waiting screen in the console's list. */
function screenRow(d, roster, boards) {
  const jobOf = () => {
    if (d.role === 'seat') {
      const who = roster.find((r) => r.id === d.params.entityId);
      return who ? ` → ${who.name}` : ' → (unassigned)';
    }
    if (d.role === 'board') {
      const which = boards.find((b) => b.id === d.params.boardId);
      return which ? ` → ${which.name}` : '';
    }
    return '';
  };
  const roleSelect = el(
    'select',
    {
      onchange: async () => {
        const role = roleSelect.value;
        const patch = { role, params: {} };
        // A seat or a board points at something; ask which.
        if (role === 'seat') {
          const lines = roster.map((r, i) => `${i + 1}. ${r.name}`).join('\n');
          const pick = Number(prompt(`which entity?\n${lines}`) ?? 0);
          const who = roster[pick - 1];
          if (!who) return consoleView();
          const bare = confirm('sheet layout? (cancel = bare)') === false;
          patch.params = { entityId: who.id, layout: bare ? 'bare' : 'sheet' };
        }
        if (role === 'board' && boards.length) {
          const lines = boards.map((b, i) => `${i + 1}. ${b.name}`).join('\n');
          const pick = Number(prompt(`which board?\n${lines}`) ?? 0);
          if (boards[pick - 1]) patch.params = { boardId: boards[pick - 1].id };
        }
        await api('PATCH', `/api/displays/${d.id}`, patch);
        consoleView();
      },
    },
    ...ROLES.map((r) =>
      el('option', { value: r, selected: d.role === r }, r),
    ),
  );
  return el(
    'div',
    { class: 'row' },
    d.code
      ? el('span', { class: 'chip' }, `waiting · code ${d.code}`)
      : el('span', {}, `${d.name ?? '(unnamed)'}${jobOf()}`),
    d.code ? '' : roleSelect,
    d.code
      ? ''
      : el(
          'button',
          { title: 'flash its name on it', onclick: () => api('POST', `/api/displays/${d.id}/identify`) },
          'identify',
        ),
    el(
      'button',
      {
        class: 'danger',
        onclick: async () => {
          if (!confirm(`forget ${d.name ?? 'this screen'}?`)) return;
          await api('DELETE', `/api/displays/${d.id}`);
          consoleView();
        },
      },
      '×',
    ),
  );
}

/** The console's front door: the one key, typed once. */
function keyView(message) {
  app.replaceChildren(
    el('h1', {}, 'console'),
    message ? el('p', { class: 'missing' }, message) : '',
    el('p', { class: 'dim' }, 'paste the DM key — the host terminal prints it'),
    el(
      'div',
      { class: 'row' },
      el('input', { id: 'key-in', type: 'password', placeholder: 'DM key' }),
      el(
        'button',
        {
          onclick: () => {
            stored.key = document.getElementById('key-in')?.value.trim() ?? '';
            current(); // through the front door, so the stream comes up too
          },
        },
        'unlock',
      ),
    ),
  );
}

// ---------------------------------------------------------------- entity

async function entityView(id, seat) {
  const entity = await api('GET', `/api/entities/${id}`);
  if (entity.error) {
    app.replaceChildren(el('p', { class: 'missing' }, entity.error));
    return;
  }
  const save = async () => {
    await api('PUT', `/api/entities/${id}`, { entity });
    render();
  };
  const render = () => {
    app.replaceChildren(
      seat
        ? el('div', { class: 'crumb' }, `seat · ${entity.name}`)
        : el('div', { class: 'crumb' }, el('a', { href: '#console' }, '← console')),
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

// ---------------------------------------------------------------- seat

/** A player's own sheet: the resolved reading, sparse writes, the assigned arrangement. */
async function seatView(id, layout) {
  const [stored, reads, statuses, kinds, turn, roster] = await Promise.all([
    api('GET', `/api/entities/${id}`),
    api('GET', `/api/entities/${id}?resolved=1`),
    api('GET', '/api/stack/declarations/statuses'),
    api('GET', '/api/stack/declarations/kinds'),
    api('GET', '/api/turn'),
    api('GET', '/api/entities'),
  ]);
  if (stored.error) {
    app.replaceChildren(el('p', { class: 'missing' }, stored.error));
    return;
  }
  const writeEntry = async (edit) => {
    await api('POST', `/api/entities/${id}/entry`, edit);
    seatView(id, layout);
  };
  const saveStored = async (entity) => {
    await api('PUT', `/api/entities/${id}`, { entity });
    seatView(id, layout);
  };
  app.replaceChildren(
    el('div', { class: 'crumb' }, `seat · ${reads.name}`),
    seatTurnStrip(turn, roster, id),
    renderSeat(stored, reads, writeEntry, saveStored, { statuses, kinds }, layout),
  );
}

/** Whose turn it is, and — while rolling — the one thing a seat may say. */
function seatTurnStrip(turn, roster, myEntityId) {
  if (!turn.order.length) return el('span', {});
  const names = new Map(roster.map((r) => [r.id, r.name]));
  const whoOf = (e) => e.label ?? names.get(e.entityId) ?? '?';
  const acting = turn.turn === null ? null : turn.order[turn.turn];
  const mine = turn.order.find((e) => e.entityId === myEntityId);
  const myTurn = acting && acting.entityId === myEntityId;
  return el(
    'div',
    { class: 'row turn-strip' },
    el('span', { class: 'dim' }, `round ${turn.round}`),
    acting
      ? el('span', { class: myTurn ? 'your-turn' : '' }, myTurn ? '▶ your turn' : `▶ ${whoOf(acting)}`)
      : el('span', { class: 'dim' }, turn.rolling ? 'rolling…' : 'between fights'),
    turn.rolling && mine && typeof mine.score !== 'number'
      ? el('input', {
          class: 'score',
          placeholder: 'your roll',
          onchange: async (ev) => {
            const n = Number(ev.target.value);
            if (!Number.isFinite(n)) return;
            await api('POST', '/api/turn', { op: 'score', entryId: mine.id, score: n });
            current();
          },
        })
      : '',
  );
}

// ---------------------------------------------------------------- board

async function boardView(id, passive) {
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
    });
    boardView(id, passive);
  };

  app.replaceChildren(
    passive
      ? el('div', { class: 'crumb' }, 'board')
      : el('div', { class: 'crumb' }, el('a', { href: '#console' }, '← console')),
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
            passive
              ? ''
              : el(
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
    passive
      ? ''
      : el(
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

// ---------------------------------------------------------------- screen

/** A screen's whole life: hello, wait for adoption, render the job. */
let me = null; // { display, handle }

async function screenView() {
  me = await api('POST', '/api/displays/hello', stored.display ? { id: stored.display } : {});
  if (!me.display) {
    app.replaceChildren(el('p', { class: 'missing' }, 'the host is not answering'));
    return;
  }
  stored.display = me.display.id;
  const { display } = me;

  if (display.code) {
    // A stranger: show the code, wait to be adopted. The screen shows,
    // the DM types — the dumbest panel in the room needs no keyboard.
    app.replaceChildren(
      el('div', { class: 'pairing' },
        el('div', { class: 'dim' }, 'adopt this screen from the console'),
        el('div', { class: 'code' }, display.code),
        el('div', {}, el('a', { href: '/#console', class: 'dim' }, 'this is the DM device — open the console')),
      ),
    );
    setTimeout(screenView, 5000);
    return;
  }

  api('POST', '/api/displays/viewport', { w: innerWidth, h: innerHeight });

  await ensureStream();

  if (display.role === 'console') return consoleView();
  if (display.role === 'seat' && display.params.entityId) {
    return seatView(display.params.entityId, display.params.layout);
  }
  if (display.role === 'board' && display.params.boardId) {
    return boardView(display.params.boardId, true);
  }
  // Adopted, no job yet (blank / table / art / badge — those surfaces
  // arrive with their ports). Say who we are and hold.
  app.replaceChildren(
    el('div', { class: 'pairing' },
      el('div', { class: 'code', id: 'self-name' }, display.name ?? '(unnamed)'),
      el('div', { class: 'dim' }, `${display.role} · waiting for a job`),
    ),
  );
}

function flashIdentity() {
  const name = me?.display?.name ?? '(unnamed)';
  const color = me?.display?.color ?? 'var(--accent)';
  const overlay = el('div', { class: 'identify' }, name);
  overlay.style.background = color;
  document.body.append(overlay);
  setTimeout(() => overlay.remove(), 2500);
}

// ---------------------------------------------------------------- stream

let stream = null;

async function ensureStream() {
  if (stream) return;
  const slip = await api('GET', '/api/ticket');
  if (slip.error) return; // not at the table yet — screenView polls
  stream = new EventSource(`/api/stream?handle=${slip.handle}&ticket=${slip.ticket}`);
  stream.onmessage = (msg) => {
    if (msg.data === 'identify') return flashIdentity();
    if (msg.data === 'assign') return current();
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
    current();
  };
  stream.onerror = () => {
    // A dead ticket (or a restarted host): re-ticket rather than let
    // the EventSource retry a 401 forever.
    stream?.close();
    stream = null;
    setTimeout(ensureStream, 3000);
  };
}

// ---------------------------------------------------------------- boot

/**
 * Where to look is the URL's business: `#console`, `#entity=<id>`,
 * `#board=<id>`. The HASH routes, so several panels of one browser can
 * each hold their own view — navigating between them never reloads the
 * page (the stream stays up) and never mints a paired screen. The old
 * `?` spellings still work; a bare address is still a screen.
 */
function route() {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const search = new URLSearchParams(location.search);
  const pick = (k) => hash.get(k) ?? search.get(k);
  const has = (k) => hash.has(k) || search.has(k);
  return {
    entity: pick('entity'),
    board: pick('board'),
    console: has('console') || has('entity') || has('board'),
  };
}

function current() {
  const r = route();
  if (r.console) {
    if (!stored.key) return keyView();
    ensureStream();
    if (r.entity) return entityView(r.entity, false);
    if (r.board) return boardView(r.board, false);
    return consoleView();
  }
  return screenView();
}

window.addEventListener('hashchange', current);
current();
