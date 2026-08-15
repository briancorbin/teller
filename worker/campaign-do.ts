import type { SessionOp, SessionState, StreamEvent, InitiativeEntry } from './types';

// One campaign = one DO. Holds the LIVE session (initiative, turn,
// round) and fans state out to every connected client over SSE.
// Durable data (characters, campaigns, events) lives in D1 — the DO
// only relays pokes about it.

const EMPTY: SessionState = { initiative: [], turn: null, round: 1, notice: null };
const PING_MS = 25_000;

function sse(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

type Client = ReadableStreamDefaultController<Uint8Array>;

export class CampaignDO {
  /**
   * Clients are no longer anonymous: each carries the opaque handle of
   * the screen on the other end, so the console can speak to one panel
   * ("flash your name", "you're the map now") instead of shouting at
   * the room. A handle identifies; it never authorises.
   */
  private clients = new Map<Client, string | null>();
  private session: SessionState = EMPTY;
  private loaded = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private ctx: DurableObjectState) {}

  private async load(): Promise<void> {
    if (this.loaded) return;
    const stored = await this.ctx.storage.get<SessionState>('session');
    if (stored) this.session = { ...EMPTY, ...stored };
    this.loaded = true;
  }

  async fetch(request: Request): Promise<Response> {
    await this.load();
    const url = new URL(request.url);

    if (url.pathname.endsWith('/stream')) {
      return this.handleStream(url.searchParams.get('display'));
    }

    // Aimed at a single screen, by its opaque handle.
    if (url.pathname.endsWith('/notify') && request.method === 'POST') {
      const { handle, event } = await request.json<{
        handle: string;
        event: StreamEvent;
      }>();
      this.send(event, handle);
      return Response.json({ ok: true });
    }

    if (url.pathname.endsWith('/session')) {
      if (request.method === 'POST') {
        const op = await request.json<SessionOp>();
        await this.apply(op);
        return Response.json(this.session);
      }
      return Response.json(this.session);
    }

    if (url.pathname.endsWith('/broadcast') && request.method === 'POST') {
      const event = await request.json<StreamEvent>();
      this.broadcast(event);
      return Response.json({ ok: true });
    }

    return new Response('not found', { status: 404 });
  }

  private async apply(op: SessionOp): Promise<void> {
    const s = this.session;
    switch (op.op) {
      case 'set':
        s.initiative = op.initiative;
        if (s.turn !== null && s.turn >= s.initiative.length) {
          s.turn = s.initiative.length ? s.initiative.length - 1 : null;
        }
        break;
      case 'next':
        if (!s.initiative.length) break;
        if (s.turn === null) {
          s.turn = 0;
          s.round = 1;
        } else if (s.turn + 1 >= s.initiative.length) {
          s.turn = 0;
          s.round += 1;
        } else {
          s.turn += 1;
        }
        break;
      case 'prev':
        if (!s.initiative.length || s.turn === null) break;
        if (s.turn === 0) {
          s.turn = s.initiative.length - 1;
          s.round = Math.max(1, s.round - 1);
        } else {
          s.turn -= 1;
        }
        break;
      case 'end':
        s.turn = null;
        s.round = 1;
        s.rolling = false;
        break;
      case 'rolling':
        // Opening the phase wipes every score: a new fight is a new
        // roll, and a stale number left over from the last one would
        // silently sort someone into the wrong place.
        s.rolling = op.on;
        if (op.on) {
          s.initiative = s.initiative.map((e) => ({ ...e, score: null }));
          s.turn = null;
        }
        break;
      case 'score': {
        // Scores arrive one at a time, from whichever seat rolled — so
        // the list re-sorts on every arrival rather than waiting for
        // everyone. Nobody has to be last.
        s.initiative = s.initiative.map((e) =>
          e.id === op.entryId ? { ...e, score: op.score } : e,
        );
        const scored = (e: InitiativeEntry) =>
          typeof e.score === 'number' ? e.score : null;
        s.initiative = [...s.initiative].sort((a, b) => {
          const x = scored(a);
          const y = scored(b);
          // Nobody who hasn't rolled outranks somebody who has, and
          // among the unrolled the order they were added is kept.
          if (x === null && y === null) return 0;
          if (x === null) return 1;
          if (y === null) return -1;
          return y - x;
        });
        break;
      }
      case 'notice':
        s.notice = op.text?.trim() ? op.text.trim() : null;
        break;
      case 'shop':
        // Opening a shop (or switching vendors) starts with empty
        // counters — carts belong to a visit, not to a character. Same
        // reasoning as `rolling` wiping scores: stale state from the
        // last shop would silently ride into this one.
        s.store = op.vendorId
          ? { vendorId: op.vendorId, carts: {}, offered: {} }
          : null;
        break;
      case 'cart':
        if (!s.store) break;
        s.store = {
          ...s.store,
          carts: { ...s.store.carts, [op.characterId]: op.lines },
          // Editing a cart takes it back off the counter — what the DM
          // rules on must be what the player is looking at.
          offered: { ...s.store.offered, [op.characterId]: false },
        };
        break;
      case 'offer':
        if (!s.store) break;
        s.store = {
          ...s.store,
          offered: { ...s.store.offered, [op.characterId]: op.on },
        };
        break;
    }
    await this.ctx.storage.put('session', s);
    this.broadcast({ type: 'session', state: s });
  }

  private handleStream(handle: string | null): Response {
    const encoder = new TextEncoder();
    // Captured in start(), used in cancel() — assigned before any read.
    let ctrl: Client | null = null;
    const clients = this.clients;
    const hello = sse({ type: 'hello', state: this.session });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        ctrl = controller;
        clients.set(controller, handle);
        controller.enqueue(encoder.encode(hello));
      },
      cancel() {
        if (ctrl) clients.delete(ctrl);
      },
    });

    this.ensurePing();

    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
    });
  }

  private ensurePing(): void {
    if (this.pingTimer) return;
    this.pingTimer = setInterval(() => {
      this.broadcast({ type: 'ping' });
      if (!this.clients.size && this.pingTimer) {
        clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
    }, PING_MS);
  }

  private broadcast(event: StreamEvent): void {
    this.send(event, null);
  }

  /**
   * handle null = everyone; otherwise that screen's connections — and
   * every SHARED connection (`display=*`), which is one browser's
   * single socket standing in for all of its tabs (rule 6: six
   * connections per plain-HTTP origin, so tabs pool onto one).
   *
   * Shared sockets get targeted events tagged `to`, so the right tab
   * can claim its mail client-side. That widens delivery, not
   * authority: everything on this stream is already gated by the
   * campaign ticket, and a handle identifies a screen — it has never
   * granted anything (rule 7).
   */
  private send(event: StreamEvent, handle: string | null): void {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(sse(event));
    const tagged =
      handle !== null ? encoder.encode(sse({ ...event, to: handle })) : bytes;
    for (const [client, id] of this.clients) {
      if (handle !== null && id !== handle && id !== '*') continue;
      try {
        client.enqueue(handle !== null && id === '*' ? tagged : bytes);
      } catch {
        this.clients.delete(client);
      }
    }
  }
}
