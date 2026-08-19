// The host — the first server on the new core, now with the one key.
//
// One runtime (§16): `node server/index.ts --data ~/.teller-next
// --campaign <slug>` and nothing else. No build, no bundler, no
// Cloudflare shape anywhere — routes call the Session, the Session
// calls the store, and the store is a file.
//
// Auth is rule 7, ported (server/auth.ts): the DM key is the root of
// trust, screens pair by code and hold role assignments, the stream
// takes a ticket because an EventSource can't send a header. A route
// never re-derives authority from anything but the key or the role.
//
// The client contract is small on purpose: JSON in, JSON out,
// `/api/stream` nudges and the page refetches. Serializers stay at the
// store boundary, so a route never sees a raw row.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, join, normalize, resolve as resolvePath } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { toEntity, type Ref } from '../core/entity.ts';
import {
  createCampaign,
  isDisplayRole,
  listCampaigns,
  openShelf,
  validSlug,
  type EntityDraft,
} from '../core/store.ts';
import {
  actorOf,
  adopted,
  canDm,
  canEditEntity,
  canWatch,
  checkTicket,
  displayHandle,
  loadDmKey,
  mintTicket,
  resolveAuth,
  STREAM_MINUTES,
  type Auth,
} from './auth.ts';
import { discoverPlugins, loadPlugins, providersOf } from '../core/plugins.ts';
import { panelDir, seedPanels } from '../core/panels-shelf.ts';
import { packDir, packPanelDir, systemIndexModule } from '../core/packs-shelf.ts';
import { systemDir, systemPanelDir } from '../core/systems-shelf.ts';
import { ACTIVE_CAMPAIGN, Host, Session, type EntryEdit } from './session.ts';
import type { TurnOp } from './turn.ts';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), 'public');
// The bundled client (client/ → vite → here). Preferred over PUBLIC
// when built, so the vanilla files remain the fallback until they die.
const DIST = join(dirname(fileURLToPath(import.meta.url)), 'dist');

type Reply = { status: number; body: unknown };

/**
 * Everything a route may know. The key rides along only for tickets.
 *
 * The HOST is what's passed, not the session: the active campaign is
 * swappable at runtime, so a route reads through the holder rather
 * than closing over one session for the life of the process. A host
 * with no campaign at all is a real state (a fresh data dir boots into
 * it, and the console lands on the campaign screen) — which is why
 * `host.session` is optional and the table's routes say so.
 */
export type Ctx = { host: Host; auth: Auth; key: string };

function reply(status: number, body: unknown): Reply {
  return { status, body };
}

const denied = () => reply(401, { error: 'DM key required' });
const notAtTable = () => reply(401, { error: 'not at this table' });
const noCampaign = () =>
  reply(503, { error: 'no campaign is active — pick one from the campaign screen' });

async function bodyOf(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Content code a human has ENABLED — the systems, packs and panels
 * whose compiled presentations this table is willing to run.
 *
 * Trust is a one-way street until something lists it: `codePending`
 * says "nobody has said yes yet", so the enable buttons disappear the
 * instant you press them and the answer becomes unreachable. This is
 * the other direction. Names come from the shelf and the panel
 * declarations; an id whose folder is gone still lists, by its id —
 * a row you can't see is a row you can't revoke.
 */
function trustedCode(
  session: Session,
): { id: string; name: string; kind: 'system' | 'pack' | 'panel' }[] {
  const panels = new Map(
    session.loaded
      .declarations('panels')
      .map((p) => p as { id?: string; name?: string; label?: string })
      .filter((p) => p.id)
      .map((p) => [p.id!, p.label ?? p.name ?? p.id!]),
  );
  const out: { id: string; name: string; kind: 'system' | 'pack' | 'panel' }[] = [];
  for (const { id, enabled } of session.shelf.pluginTrusts()) {
    if (!enabled) continue;
    if (id.startsWith('sys_')) {
      out.push({ id, name: session.shelf.system(id)?.name ?? id, kind: 'system' });
    } else if (id.startsWith('pak_')) {
      out.push({ id, name: session.shelf.pack(id)?.name ?? id, kind: 'pack' });
    } else if (id.startsWith('pan_')) {
      out.push({ id, name: panels.get(id) ?? id, kind: 'panel' });
    }
  }
  return out;
}

/**
 * The API, as one function — testable without a socket, servable with
 * one. Returns undefined for paths that aren't the API's.
 */
export async function handleApi(
  ctx: Ctx,
  method: string,
  url: URL,
  req: IncomingMessage,
): Promise<Reply | undefined> {
  const { host, auth, key } = ctx;
  const shelf = host.shelf;
  const parts = url.pathname.split('/').filter(Boolean); // ['api', …]
  if (parts[0] !== 'api') return undefined;
  const [, head, a, b] = parts;

  // -- screens ----------------------------------------------------------

  if (head === 'displays') {
    // A screen announcing itself. Unauthenticated on purpose: this is
    // how a screen comes into existence, and it confers nothing — a
    // brand new display is 'blank' and belongs to nobody until the DM
    // adopts it by the code it shows.
    if (method === 'POST' && a === 'hello' && !b) {
      const body = await bodyOf(req);
      let display =
        typeof body.id === 'string' ? shelf.display(body.id) : undefined;
      if (display) {
        shelf.touchDisplay(display.id);
        display = shelf.refreshCodeIfExpired(display);
      } else {
        display = shelf.createDisplay();
      }
      // The handle is told, not derived: a LAN origin is not a secure
      // context, so the client couldn't compute its own sha-256.
      return reply(200, { display, handle: displayHandle(display.id) });
    }

    // A screen reporting its own viewport — telemetry about the caller
    // itself, clamped hard, only ever writes the caller's own row.
    if (method === 'POST' && a === 'viewport' && !b) {
      const self = auth.display;
      if (!self) return reply(401, { error: 'display required' });
      const body = await bodyOf(req);
      const clamp = (n: unknown) =>
        typeof n === 'number' && Number.isFinite(n)
          ? Math.min(20000, Math.max(1, Math.round(n)))
          : null;
      const w = clamp(body.w);
      const h = clamp(body.h);
      if (!w || !h) return reply(400, { error: 'w and h required' });
      if (self.viewport?.w !== w || self.viewport?.h !== h) {
        shelf.setDisplayViewport(self.id, w, h);
      }
      return reply(200, { ok: true });
    }

    // Everything below is the DM arranging the room.
    if (!canDm(auth)) return denied();

    if (method === 'GET' && !a) {
      // Listing is the moment truth matters — sweep the ghosts first.
      shelf.expireUnclaimedDisplays();
      return reply(200, shelf.displays());
    }

    // Adopt a waiting screen by the code it's showing.
    if (method === 'POST' && a === 'claim' && !b) {
      const body = await bodyOf(req);
      const code = String(body.code ?? '').trim();
      if (!code) return reply(400, { error: 'pairing code required' });
      const found = shelf.displayByCode(code);
      if (!found) return reply(404, { error: 'no screen is showing that code' });
      const claimed = shelf.displays().filter((d) => !d.code).length;
      const name =
        (typeof body.name === 'string' && body.name.trim()) ||
        `Screen ${claimed + 1}`;
      const display = shelf.claimDisplay(found.id, name);
      host.room.changed('displays');
      return reply(200, display);
    }

    // "Which one of you is Screen 3?"
    if (method === 'POST' && a && b === 'identify') {
      const display = shelf.display(a);
      if (!adopted(display)) return reply(404, { error: 'display not found' });
      host.room.notify(displayHandle(display.id), 'identify');
      return reply(200, { ok: true });
    }

    if (a && !b && (method === 'PATCH' || method === 'DELETE')) {
      const display = shelf.display(a);
      if (!display) return reply(404, { error: 'display not found' });

      if (method === 'DELETE') {
        shelf.removeDisplay(a);
        // It's still connected: tell it to go look at itself and
        // discover it's a stranger again.
        host.room.notify(displayHandle(a), 'assign');
        host.room.changed('displays');
        return reply(200, { ok: true });
      }

      const body = await bodyOf(req);
      const patch: Parameters<typeof shelf.updateDisplay>[1] = {};
      if (typeof body.name === 'string') patch.name = body.name;
      if (typeof body.color === 'string') patch.color = body.color;
      if (body.role !== undefined) {
        if (!isDisplayRole(body.role)) {
          return reply(400, { error: `not a role: ${String(body.role)}` });
        }
        patch.role = body.role;
      }
      if (body.params && typeof body.params === 'object') {
        patch.params = body.params as Record<string, unknown>;
      }
      if (body.ppi === null || typeof body.ppi === 'number') patch.ppi = body.ppi;
      if (body.ppiY === null || typeof body.ppiY === 'number') patch.ppiY = body.ppiY;
      if (typeof body.position === 'number') patch.position = body.position;
      const updated = shelf.updateDisplay(a, patch);
      host.room.notify(displayHandle(a), 'assign');
      host.room.changed('displays');
      return reply(200, updated);
    }
  }

  // The stream's permission slip. The DM's own device rides as 'dm';
  // an adopted screen gets a ticket for its own handle and nothing else.
  if (method === 'GET' && head === 'ticket' && !a) {
    const slips = (handle: string) => ({
      handle,
      ticket: mintTicket(key, `stream:${handle}`, STREAM_MINUTES),
      // Art and maps ride in <img> tags, which can't send headers
      // either — same law, second subject.
      files: mintTicket(key, `files:${handle}`, STREAM_MINUTES),
    });
    if (adopted(auth.display)) {
      return reply(200, slips(displayHandle(auth.display.id)));
    }
    if (auth.key) return reply(200, slips('dm'));
    return notAtTable();
  }

  // -- which campaign this table is running (rule 9: ONE per host) ------
  //
  // The DM's door, and app chrome rather than a panel — it has to exist
  // BEFORE a campaign resolves, which is exactly when the panel merge
  // has nothing to say. Activating swaps the session under every screen
  // in the room; the displays are on the shelf, so they follow without
  // being touched.
  if (head === 'campaigns') {
    if (!canDm(auth)) return denied();
    if (!host.dataDir) return reply(501, { error: 'this host has no data dir' });

    if (method === 'GET' && !a) {
      return reply(200, {
        active: host.session?.campaign.slug ?? null,
        campaigns: host.list().map((c) => ({
          slug: c.slug,
          name: c.name,
          active: c.active,
          // The manifest's ref cached a name; the shelf may know a
          // better one. A system nobody has still lists — "you don't
          // have this" beats a blank column.
          system: c.system
            ? {
                id: c.system.id,
                name: shelf.system(c.system.id)?.name ?? c.system.name,
                installed: Boolean(shelf.system(c.system.id)),
              }
            : null,
        })),
      });
    }

    if (method === 'POST' && !a) {
      const body = await bodyOf(req);
      const name = String(body.name ?? '').trim();
      if (!name) return reply(400, { error: 'a campaign needs a name' });
      let system: Ref | undefined;
      if (typeof body.system === 'string' && body.system.trim()) {
        const row = shelf.system(body.system.trim());
        if (!row) return reply(400, { error: `no system ${body.system} on this shelf` });
        system = { id: row.id, name: row.name };
      }
      try {
        const started = host.start(name, system);
        return reply(201, { slug: started.campaign.slug, name, active: true });
      } catch (err) {
        return reply(400, { error: String(err) });
      }
    }

    if (method === 'POST' && a && b === 'activate') {
      if (!validSlug(a) || !listCampaigns(host.dataDir).includes(a)) {
        return reply(404, { error: `no campaign ${a} on this host` });
      }
      try {
        host.activate(a);
        return reply(200, { ok: true, slug: a });
      } catch (err) {
        return reply(400, { error: String(err) });
      }
    }
  }

  // -- the table itself. Watching requires being adopted (or the key). --

  if (!canWatch(auth)) return notAtTable();

  const session = host.session;

  if (method === 'GET' && head === 'campaign' && !a) {
    // A host with no campaign answers this one anyway, with nothing in
    // it — the key gate calls this to prove a key, and the console
    // reads `slug: null` as "land on the campaign screen". A 503 here
    // would read to the client as a bad key.
    if (!session) {
      return reply(200, {
        slug: null,
        manifest: null,
        system: null,
        packs: [],
        missing: [],
        watching: host.room.size,
      });
    }
    const { manifest, system, packs, missing } = session.loaded;
    return reply(200, {
      slug: session.campaign.slug,
      manifest,
      system: system ?? null,
      packs,
      missing,
      watching: session.watching,
    });
  }

  if (!session) return noCampaign();

  // Which system and packs this campaign runs on — the manifest's refs,
  // rewritten. An ABSENT (or emptied) pack list is not "no packs": it
  // restores the default, every pack for the system in arrival order,
  // because a host with one pack must never make anyone tick a box.
  if (method === 'PUT' && head === 'campaign' && a === 'refs' && !b) {
    if (!canDm(auth)) return denied();
    const body = await bodyOf(req);
    const manifest = session.campaign.root();
    const refs: Record<string, Ref | Ref[]> = { ...(manifest.refs ?? {}) };

    if ('system' in body) {
      if (body.system === null || body.system === '') delete refs.system;
      else if (typeof body.system === 'string') {
        const row = shelf.system(body.system);
        if (!row) return reply(400, { error: `no system ${body.system} on this shelf` });
        refs.system = { id: row.id, name: row.name };
      } else {
        return reply(400, { error: 'system must be a sys_ id or null' });
      }
    }

    if ('packs' in body) {
      if (body.packs === null || (Array.isArray(body.packs) && !body.packs.length)) {
        delete refs.packs;
      } else if (Array.isArray(body.packs)) {
        const declared: Ref[] = [];
        for (const raw of body.packs) {
          const id = String(raw ?? '').trim();
          if (!id) continue;
          const row = shelf.pack(id);
          // A pack that isn't on the shelf may still be declared — it
          // reports as missing at load rather than being refused here,
          // which is what lets a `.story` name packs you haven't got.
          declared.push({ id, name: row?.name ?? id });
        }
        if (declared.length) refs.packs = declared;
        else delete refs.packs;
      } else {
        return reply(400, { error: 'packs must be a list of pak_ ids, or null' });
      }
    }

    session.save({ ...manifest, refs }, actorOf(auth, String(body.actor ?? '')));
    session.reload();
    const { system, packs, missing } = session.loaded;
    return reply(200, { ok: true, system: system ?? null, packs, missing });
  }

  if (head === 'entities' && !a) {
    if (method === 'GET') {
      const parent =
        url.searchParams.get('parent') ?? session.loaded.manifest.id;
      return reply(
        200,
        session.campaign
          .children(parent)
          .map(({ id, name, type }) => ({ id, name, type: type ?? null })),
      );
    }
    if (method === 'POST') {
      if (!canDm(auth)) return denied();
      const body = await bodyOf(req);
      try {
        const entity = session.create(
          (body.draft ?? {}) as EntityDraft,
          actorOf(auth, String(body.actor ?? '')),
          typeof body.parentId === 'string' ? body.parentId : undefined,
        );
        return reply(201, entity);
      } catch (err) {
        return reply(400, { error: String(err) });
      }
    }
  }

  if (method === 'POST' && head === 'stamp' && !a) {
    if (!canDm(auth)) return denied();
    const body = await bodyOf(req);
    const slot = String(body.slot ?? 'bestiary');
    const templateId = String(body.templateId ?? '');
    const entity = session.stampFrom(
      slot,
      templateId,
      actorOf(auth, String(body.actor ?? '')),
      {
        name: typeof body.name === 'string' ? body.name : undefined,
        thick: body.thick === true,
        parentId: typeof body.parentId === 'string' ? body.parentId : undefined,
      },
    );
    if (!entity)
      return reply(404, {
        error: `no template ${templateId} in ${slot} — missing pack?`,
      });
    return reply(201, entity);
  }

  if (head === 'entities' && a && !b) {
    if (method === 'GET') {
      // Reading a whole entity is the seat's privilege for its own, and
      // the DM's for anyone — a passive surface gets the roster list.
      if (!canEditEntity(auth, a)) return denied();
      const entity = session.campaign.get(a);
      if (!entity) return reply(404, { error: `no entity ${a}` });
      if (url.searchParams.get('resolved') === '1') {
        return reply(200, session.reading(entity));
      }
      return reply(200, entity);
    }
    if (method === 'PUT') {
      if (!canEditEntity(auth, a)) return denied();
      const body = await bodyOf(req);
      const entity = toEntity({ ...((body.entity as object) ?? {}), id: a });
      if (!entity) return reply(400, { error: 'not an entity' });
      try {
        return reply(200, session.save(entity, actorOf(auth, String(body.actor ?? ''))));
      } catch (err) {
        return reply(404, { error: String(err) });
      }
    }
    if (method === 'DELETE') {
      if (!canDm(auth)) return denied();
      session.remove(a, actorOf(auth, url.searchParams.get('actor') ?? ''));
      return reply(200, { ok: true });
    }
  }

  // The seat's one door: edit the reading, store only the touch.
  if (method === 'POST' && head === 'entities' && a && b === 'entry') {
    if (!canEditEntity(auth, a)) return denied();
    const body = await bodyOf(req);
    const list = String(body.list ?? '').trim();
    const name = String(body.name ?? '').trim();
    if (!list || !name) return reply(400, { error: 'entry needs a list and a name' });
    const edit: EntryEdit = { list, name };
    if (typeof body.value === 'number' || typeof body.value === 'string') {
      edit.value = body.value;
    }
    if (body.max === null || typeof body.max === 'number') edit.max = body.max;
    if (body.remove === true) edit.remove = true;
    const saved = session.writeEntry(a, edit, actorOf(auth, String(body.actor ?? '')));
    if (!saved) return reply(404, { error: `no entity ${a}` });
    return reply(200, { stored: saved, reads: session.reading(saved) });
  }

  if (method === 'POST' && head === 'entities' && a && b === 'move') {
    if (!canDm(auth)) return denied();
    const body = await bodyOf(req);
    const parentId = String(body.parentId ?? '');
    if (!parentId) return reply(400, { error: 'move needs a parentId' });
    try {
      session.move(a, parentId, actorOf(auth, String(body.actor ?? '')));
      return reply(200, { ok: true });
    } catch (err) {
      return reply(404, { error: String(err) });
    }
  }

  // -- the shelf, read whole — what this machine holds (DM's business).
  if (method === 'GET' && head === 'shelf' && !a) {
    if (!canDm(auth)) return denied();
    return reply(200, {
      systems: shelf.systems(),
      packs: shelf.packs(),
      boards: shelf.boards().map(({ id, name }) => ({ id, name })),
    });
  }

  // -- the sweep door (§L phase 1). "Edit the folder, sweep, live" needs
  // somewhere to say sweep, and until this existed the panel work was
  // saying it through the plugin-enable POST — which was doing double
  // duty as a rebuild and lying about what it meant. This re-runs the
  // resolution law over whatever is on disk now and answers with the
  // load report, so a folder that didn't parse says so out loud instead
  // of quietly not being there.
  if (method === 'POST' && head === 'shelf' && a === 'sweep' && !b) {
    if (!canDm(auth)) return denied();
    session.reload();
    const { loaded } = session;
    return reply(200, {
      ok: true,
      system: loaded.system ?? null,
      packs: loaded.packs,
      missing: loaded.missing,
      packProblems: loaded.packProblems,
      panelProblems: loaded.panelProblems,
    });
  }

  // -- plugins over HTTP: §15's "enablement is a human act in the
  // console", finally in the console. Toggle and config reload the
  // load path live, so the enable gate and the running set never drift.
  //
  // The trust table this reads and writes is the same one a code-
  // carrying `.panel` rides (§E: "trust rides the plugins table") — and
  // a code-carrying PACK too (§L phase 2) — so this route doubles as the
  // code enablement endpoint for both. A `pan_` or `pak_` id reloads the
  // CONTENT stack (that's where their code is attached, at sweep);
  // anything else reloads the PLUGIN load path, as before.
  if (head === 'plugins') {
    if (!canDm(auth)) return denied();
    const dataDir = session.dataDir;
    if (!dataDir) return reply(501, { error: 'this host has no data dir' });
    if (method === 'GET' && !a) {
      const { found, problems } = discoverPlugins(dataDir, session.shelf);
      return reply(200, {
        found,
        problems: [...problems, ...session.pluginProblems],
        running: session.plugins.map((p) => p.manifest.id),
        // Trust that a human granted to CONTENT code, listed so it can
        // be taken back. Granting already had a door (the POST below);
        // revoking had none, because the only surfaces that offered the
        // toggle rendered while `codePending` — which is false the
        // moment you say yes, so the button vanished with the answer.
        trusted: trustedCode(session),
      });
    }
    const reloadPlugins = async () => {
      const result = await loadPlugins(dataDir, session.shelf);
      host.setPlugins(result.loaded, result.problems);
      session.changed('plugins');
    };
    if (method === 'POST' && a && !b) {
      const body = await bodyOf(req);
      if (typeof body.enabled !== 'boolean') {
        return reply(400, { error: 'enabled must be true or false' });
      }
      shelf.setPluginEnabled(a, body.enabled);
      if (a.startsWith('pan_') || a.startsWith('pak_') || a.startsWith('sys_')) {
        // Panel, pack and system code aren't a plugin's `provides` —
        // all three are attached to their declaration by the sweep, so
        // what needs re-running is the content stack, not the plugin
        // load path.
        session.reload();
      } else {
        await reloadPlugins();
      }
      return reply(200, { ok: true, running: session.plugins.map((p) => p.manifest.id) });
    }
    if (method === 'PUT' && a && b === 'config') {
      const body = await bodyOf(req);
      shelf.setPluginConfig(a, body.config);
      await reloadPlugins();
      return reply(200, { ok: true });
    }
  }

  // -- proposals (§15). The host assembles the snapshot, fans it out to
  // every enabled provider, and returns words. Playing any of it is the
  // DM's act — a proposal lands nowhere a human didn't put it (rule 1).
  if (method === 'POST' && head === 'propose' && a && !b) {
    if (!canDm(auth)) return denied();
    const point = a === 'turn' ? 'propose.turn' : a === 'narrate' ? 'propose.narrate' : undefined;
    if (!point) return reply(404, { error: `no such point: ${a}` });
    const body = await bodyOf(req);
    let payload: unknown = body.payload ?? {};
    if (point === 'propose.turn') {
      // Assemble the snapshot server-side: a fact the host holds and
      // doesn't pass on is a fact the model invents.
      const turn = session.turnState();
      const acting = turn.turn === null ? undefined : turn.order[turn.turn];
      const actingEntity = acting?.entityId
        ? session.campaign.get(acting.entityId)
        : undefined;
      const names = new Map(
        session.campaign
          .children(session.loaded.manifest.id)
          .map((e) => [e.id, e.name]),
      );
      payload = {
        round: turn.round,
        order: turn.order.map((e, i) => ({
          name: e.label ?? (e.entityId ? (names.get(e.entityId) ?? 'unknown') : '?'),
          score: e.score ?? null,
          acting: i === turn.turn,
        })),
        acting: actingEntity ? session.reading(actingEntity) : null,
        ...(typeof body.payload === 'object' && body.payload !== null
          ? (body.payload as object)
          : {}),
      };
    }
    const providers = providersOf(session.plugins, point);
    const proposals: { plugin: string; proposal?: unknown; error?: string }[] = [];
    for (const provider of providers) {
      try {
        const proposal = await provider.call(payload);
        proposals.push({ plugin: provider.id, proposal });
      } catch (err) {
        proposals.push({ plugin: provider.id, error: String(err) });
      }
    }
    return reply(200, { point, providers: providers.length, proposals });
  }

  // -- the turn order (rule 5). Everyone reads; the DM drives; a seat
  // may submit exactly one thing — a score for its own entity's row.
  if (head === 'turn' && !a) {
    if (method === 'GET') return reply(200, session.turnState());
    if (method === 'POST') {
      const body = await bodyOf(req);
      const op = body as unknown as TurnOp;
      if (typeof op.op !== 'string') return reply(400, { error: 'an op needs an op' });
      if (!canDm(auth)) {
        const seat = auth.display;
        const owns =
          op.op === 'score' &&
          adopted(seat) &&
          seat.role === 'seat' &&
          session
            .turnState()
            .order.some(
              (e) => e.id === op.entryId && e.entityId === seat.params.entityId,
            );
        if (!owns) return denied();
      }
      return reply(200, session.turnOp(op, actorOf(auth, String(body.actor ?? ''))));
    }
  }

  // -- the campaign's own template half — prep (§13), DM's business.
  if (head === 'templates' && a) {
    if (method === 'GET' && !b) return reply(200, session.campaign.templatesIn(a));
    if (!canDm(auth)) return denied();
    if (method === 'POST' && !b) {
      const body = await bodyOf(req);
      try {
        const made = session.campaign.putTemplate(
          a,
          body.template,
          actorOf(auth, String(body.actor ?? '')),
        );
        session.changed('templates');
        return reply(201, made);
      } catch (err) {
        return reply(400, { error: String(err) });
      }
    }
    if (method === 'DELETE' && b) {
      session.campaign.removeTemplate(b, actorOf(auth, url.searchParams.get('actor') ?? ''));
      session.changed('templates');
      return reply(200, { ok: true });
    }
  }

  // Deploy a prepared fight: stamp the foes, seed the order.
  if (method === 'POST' && head === 'encounters' && a && b === 'deploy') {
    if (!canDm(auth)) return denied();
    const body = await bodyOf(req);
    const result = session.deployEncounter(a, actorOf(auth, String(body.actor ?? '')));
    if (!result) return reply(404, { error: `no encounter ${a}` });
    return reply(200, result);
  }

  if (method === 'GET' && head === 'stack' && a && b) {
    if (a === 'declarations') return reply(200, session.loaded.declarations(b));
    if (a === 'templates') return reply(200, session.loaded.templates(b));
    if (a === 'record') return reply(200, session.loaded.record(b));
  }

  if (method === 'GET' && head === 'boards' && !a) {
    return reply(200, session.shelf.boards());
  }

  if (head === 'board-state' && a && !b) {
    if (method === 'GET') {
      return reply(200, session.campaign.boardState(a) ?? null);
    }
    if (method === 'PUT') {
      if (!canDm(auth)) return denied();
      const body = await bodyOf(req);
      session.putBoardState(a, body.data ?? null, actorOf(auth, String(body.actor ?? '')));
      return reply(200, { ok: true });
    }
  }

  if (method === 'GET' && head === 'events' && !a) {
    if (!canDm(auth)) return denied();
    return reply(
      200,
      session.campaign.events({
        entityId: url.searchParams.get('entity') ?? undefined,
        limit: Number(url.searchParams.get('limit') ?? 100) || 100,
      }),
    );
  }

  return reply(404, { error: `no route ${method} ${url.pathname}` });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function serveStatic(pathname: string, res: ServerResponse): boolean {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const root = existsSync(join(DIST, 'index.html')) ? DIST : PUBLIC;
  const path = normalize(join(root, rel));
  if (!path.startsWith(root) || !existsSync(path)) return false;
  try {
    const body = readFileSync(path);
    res.writeHead(200, {
      'Content-Type': MIME[extname(path)] ?? 'application/octet-stream',
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

/** The whole server, session + key in, listener out. Tests call this on port 0. */
export function serve(what: Session | Host, port: number, key: string) {
  // A Session is accepted for the callers that build one directly (the
  // tests, mostly) — it gets wrapped in a host whose room is the one it
  // already handed out, so nothing reconnects.
  const host = what instanceof Host ? what : Host.around(what);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    // A `.panel`'s compiled code (§E UN-DEFERRED) — served PLAIN, no
    // ticket: "panel code is app code, not player-secret content." Only
    // `.build` outputs are reachable, and only for a panel the sweep
    // actually found — trust decides whether the DECLARATION carries
    // this url in the first place, not whether the byte is fetchable
    // once someone has it.
    if (url.pathname.startsWith('/panel-code/')) {
      const dataDir = host.dataDir;
      const rel = decodeURIComponent(url.pathname.slice('/panel-code/'.length));
      const [panelId, ...fileParts] = rel.split('/').filter(Boolean);
      // The table's own panels first, then the systems', then the packs'
      // (§M — a system ships unbranded panels and a pack ships the
      // book's branded ones; both are ordinary `.panel` folders with
      // ordinary `pan_` ids, so this is one more place to look, never a
      // second scheme). Order here is only lookup order — precedence at
      // the table is the merge's business, not this route's.
      const dir =
        dataDir && panelId
          ? (panelDir(dataDir, panelId) ??
            systemPanelDir(dataDir, panelId) ??
            packPanelDir(dataDir, panelId))
          : undefined;
      const buildRoot = dir ? join(dir, '.build') : undefined;
      const path = buildRoot && fileParts.length
        ? normalize(join(buildRoot, ...fileParts))
        : undefined;
      if (!path || !buildRoot || !path.startsWith(buildRoot) || !existsSync(path)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not here');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[extname(path)] ?? 'application/octet-stream',
      });
      res.end(readFileSync(path));
      return;
    }

    // A pack's compiled presentations (§L phase 2) — served plain, on
    // the same terms as `/panel-code/`: this is app code, not
    // player-secret content, and trust decides whether anything DECLARES
    // these urls, not whether a byte is fetchable once someone has one.
    //
    // `/pack-code/system.js` is the `system` specifier's body: generated,
    // not stored, from whatever the campaign's content stack resolves to
    // right now — so a sweep regenerates it by definition and it can
    // never drift from the packs actually loaded. Empty stack, empty
    // module: importing `system` must never 404 a panel.
    if (url.pathname.startsWith('/pack-code/')) {
      const dataDir = host.dataDir;
      const rel = decodeURIComponent(url.pathname.slice('/pack-code/'.length));
      if (rel === 'system.js') {
        res.writeHead(200, {
          'Content-Type': 'text/javascript',
          'Cache-Control': 'no-store',
        });
        res.end(systemIndexModule(host.session?.loaded.presentations() ?? {}));
        return;
      }
      const [packId, ...fileParts] = rel.split('/').filter(Boolean);
      // One code door for the whole content shelf: a `pak_` id resolves
      // to a pack folder, a `sys_` id to a system folder (§M).
      const dir =
        dataDir && packId
          ? (packDir(dataDir, packId) ?? systemDir(dataDir, packId))
          : undefined;
      const buildRoot = dir ? join(dir, '.build') : undefined;
      const path = buildRoot && fileParts.length
        ? normalize(join(buildRoot, ...fileParts))
        : undefined;
      if (!path || !buildRoot || !path.startsWith(buildRoot) || !existsSync(path)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not here');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[extname(path)] ?? 'application/octet-stream',
      });
      res.end(readFileSync(path));
      return;
    }

    // Bytes from the data dir — pack art and board images — behind the
    // same ticket law as the stream (an <img> can't send headers).
    // Only art/ and map/ are reachable, and only inside the data dir.
    if (url.pathname.startsWith('/files/')) {
      const handle = url.searchParams.get('handle') ?? '';
      const ticket = url.searchParams.get('ticket');
      let valid = Boolean(handle) && checkTicket(key, `files:${handle}`, ticket);
      if (valid && handle !== 'dm') {
        const display = host.shelf
          .displays()
          .find((d) => displayHandle(d.id) === handle);
        valid = adopted(display);
      }
      const dataDir = host.dataDir;
      if (!valid || !dataDir) {
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        res.end('ticket required');
        return;
      }
      const rel = decodeURIComponent(url.pathname.slice('/files/'.length));
      const path = normalize(join(dataDir, rel));
      const allowed = ['art', 'map'].some((root) =>
        path.startsWith(join(dataDir, root) + '/'),
      );
      if (!allowed || !existsSync(path)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not here');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[extname(path)] ?? 'application/octet-stream',
        'Cache-Control': 'private, max-age=3600',
      });
      res.end(readFileSync(path));
      return;
    }

    // The stream can't send headers, so it presents a ticket instead —
    // signed by the one key over exactly this handle, and worthless for
    // anything else. A display's handle must still belong to an adopted
    // screen: a ticket identifies, it never grants a power the
    // assignment didn't already have (rule 7).
    if (url.pathname === '/api/stream') {
      const handle = url.searchParams.get('handle') ?? '';
      const ticket = url.searchParams.get('ticket');
      let valid = Boolean(handle) && checkTicket(key, `stream:${handle}`, ticket);
      if (valid && handle !== 'dm') {
        const display = host.shelf
          .displays()
          .find((d) => displayHandle(d.id) === handle);
        valid = adopted(display);
      }
      if (!valid) {
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        res.end('ticket required');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('retry: 2000\n\n');
      const unsubscribe = host.room.subscribe(
        (what) => {
          res.write(`data: ${what}\n\n`);
        },
        handle === 'dm' ? undefined : handle,
      );
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      req.on('close', () => {
        clearInterval(ping);
        unsubscribe();
      });
      return;
    }

    const auth = resolveAuth(host.shelf, key, {
      key: req.headers['x-teller-key'] as string | undefined,
      display: req.headers['x-teller-display'] as string | undefined,
    });

    const handled = await handleApi(
      { host, auth, key },
      req.method ?? 'GET',
      url,
      req,
    );
    if (handled) {
      res.writeHead(handled.status, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(JSON.stringify(handled.body));
      return;
    }

    if ((req.method ?? 'GET') === 'GET' && serveStatic(url.pathname, res)) {
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not here');
  });
  server.listen(port);
  return server;
}

// ---------------------------------------------------------------------
// `node server/index.ts --data ~/.teller-next --campaign <slug>`

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) out[arg.slice(2)] = argv[i + 1] ?? '';
  }
  return out;
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const dataDir = resolvePath(
    (args.data ?? join(homedir(), '.teller-next')).replace(/^~/, homedir()),
  );
  const port = Number(args.port ?? 4526);
  const slug = args.campaign;

  // Opened once, up front — seeding a default's trust row (below) and
  // every mode after it shares this one connection.
  const shelf = openShelf(dataDir);

  // The standard panels ship as files (§E): seed-if-absent, every boot,
  // regardless of which mode below runs — cheap, and it's what makes a
  // fresh `~/.teller-next/panels/` exist before anything reads it. The
  // shelf rides along so a freshly-minted default's code, if it carries
  // any, is trusted the moment it's seeded (§E: "not a ceremony for
  // your own hands").
  seedPanels(dataDir, shelf);

  // Plugin management — the CLI is where a HUMAN enables (§15). These
  // are commands, not server modes: they act on the shelf and exit,
  // campaign or no campaign.
  if ('plugins' in args || args.enable || args.disable || args.configure) {
    if ('plugins' in args) {
      const { found, problems } = discoverPlugins(dataDir, shelf);
      if (!found.length && !problems.length) {
        console.log(`no plugins in ${join(dataDir, 'plugins')}`);
      }
      for (const p of found) {
        console.log(
          `${p.enabled ? '[on] ' : '[off]'} ${p.manifest.id} · ${p.manifest.name}` +
            ` v${p.manifest.version} · provides ${p.manifest.provides.join(', ') || '(nothing)'}` +
            ` · needs ${p.manifest.needs.join(', ') || '(nothing)'}`,
        );
      }
      for (const p of problems) console.log(`  PROBLEM ${p.dir}: ${p.problem}`);
    } else if (args.enable || args.disable) {
      const id = args.enable || args.disable;
      shelf.setPluginEnabled(id, Boolean(args.enable));
      console.log(`${id} ${args.enable ? 'enabled' : 'disabled'}`);
    } else if (args.configure) {
      try {
        shelf.setPluginConfig(args.configure, JSON.parse(args.config ?? 'null'));
        console.log(`${args.configure} configured`);
      } catch (err) {
        console.error(`--config must be JSON: ${String(err)}`);
        process.exit(1);
      }
    }
    process.exit(0);
  }

  const key = loadDmKey(dataDir);
  const host = new Host(shelf, dataDir);
  const plugins = await loadPlugins(dataDir, shelf);
  host.setPlugins(plugins.loaded, plugins.problems);

  // `--campaign` is an explicit override that also becomes the
  // remembered choice; with no flag the host resumes whatever it was
  // running. A host with NEITHER boots anyway, into the no-campaign
  // state — the console lands on the campaign screen and the DM picks
  // one there. Exiting at this point was the old shape, and it made a
  // fresh install a dead end with no way out but the command line.
  const remembered = shelf.setting(ACTIVE_CAMPAIGN);
  const wanted = slug || remembered;
  if (slug && args.new) {
    const campaign = createCampaign(dataDir, slug, args.new);
    host.session = new Session(shelf, campaign, dataDir, host.room);
    host.session.plugins = plugins.loaded;
    host.session.pluginProblems = plugins.problems;
    shelf.setSetting(ACTIVE_CAMPAIGN, slug);
  } else if (wanted) {
    try {
      host.activate(wanted);
    } catch (err) {
      // A remembered campaign whose file went away is a note, never a
      // refusal to boot: the room's screens are still on the shelf.
      console.log(`  could not open '${wanted}': ${String(err)}`);
      if (wanted === remembered) shelf.setSetting(ACTIVE_CAMPAIGN, null);
    }
  }

  serve(host, port, key);

  const session = host.session;
  console.log(
    `teller-next · ${session?.campaign.slug ?? '(no campaign)'} · http://localhost:${port}`,
  );
  if (!session) {
    const have = listCampaigns(dataDir);
    console.log(
      have.length
        ? `  campaigns here: ${have.join(', ')} — pick one from the console`
        : `  no campaigns in ${dataDir} yet — start one from the console`,
    );
  }
  const { system, packs, missing, panelProblems } = session?.loaded ?? {
    system: undefined,
    packs: [],
    missing: [],
    panelProblems: [],
  };
  if (session) {
    console.log(
      `  system: ${system ? `${system.name} v${system.version}` : '(none)'}` +
        ` · packs: ${packs.length ? packs.map((p) => p.name).join(', ') : '(none)'}`,
    );
  }
  for (const miss of missing) {
    console.log(`  MISSING ${miss.slot}: ${miss.ref.name} (${miss.ref.id})`);
  }
  for (const p of panelProblems) console.log(`  PANEL PROBLEM ${p.dir}: ${p.problem}`);
  if (plugins.loaded.length) {
    console.log(
      `  plugins: ${plugins.loaded.map((p) => p.manifest.name).join(', ')}`,
    );
  }
  for (const p of plugins.problems) console.log(`  PLUGIN PROBLEM ${p.dir}: ${p.problem}`);
  // The host's own terminal is the DM's device — this is `teller key`.
  console.log(`  DM key: ${key}  (open /?console and paste it)`);
}
