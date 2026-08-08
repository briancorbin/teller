import type { SessionOp, SessionState, StreamEvent } from './types';

// One campaign = one DO. Holds the LIVE session (initiative, turn,
// round) and fans state out to every connected client over SSE.
// Durable data (characters, campaigns, events) lives in D1 — the DO
// only relays pokes about it.

const EMPTY: SessionState = { initiative: [], turn: null, round: 1, notice: null };
const PING_MS = 25_000;

function sse(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export class CampaignDO {
  private clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
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

    if (url.pathname.endsWith('/stream')) return this.handleStream();

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
        break;
      case 'notice':
        s.notice = op.text?.trim() ? op.text.trim() : null;
        break;
    }
    await this.ctx.storage.put('session', s);
    this.broadcast({ type: 'session', state: s });
  }

  private handleStream(): Response {
    const encoder = new TextEncoder();
    // Captured in start(), used in cancel() — assigned before any read.
    let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null;
    const clients = this.clients;
    const hello = sse({ type: 'hello', state: this.session });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        ctrl = controller;
        clients.add(controller);
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
    const bytes = new TextEncoder().encode(sse(event));
    for (const client of this.clients) {
      try {
        client.enqueue(bytes);
      } catch {
        this.clients.delete(client);
      }
    }
  }
}
