# Reaching the table

Designed and built 2026-08-13 (TEL-84). A buddy should be able to join
from his house — and the HOST decides how. Reachability is pluggable,
the same way packs and books are: teller defines the socket, the owner
decides what plugs in.

`teller host` prints THE address (rule 6). This doc is about which
addresses there are to print.

## The invariant that makes every route safe

**The transport never carries authority** (rule 7).

Every route delivers a stranger to a pairing-code screen and nothing
else. Joining still requires the Warden reading that code off the
stranger's screen and typing it into the console. The warden key never
leaves the host; a relay or tunnel is a pipe, never a party.

The consequence worth stating plainly: **swapping transports cannot
change who is in a campaign.** That is why this menu can be open-ended
without a security review per entry, and why `host/reach.mjs` contains
no auth code at all — there is nothing for it to do.

What a public URL *does* expose is the pairing screen itself, the
unauthenticated `/api/health`, and the ability to create standby
display rows by asking. None of those is a way in. The rest of the API
answers only to the key or to a role the DM assigned.

## The menu

**Two of these are the answer; the rest are for when they aren't.**
LAN in the room, Tailscale for anyone outside it (Brian, 2026-08-13 —
asking a remote player to install Tailscale is reasonable: it's free,
it's one sign-in, and they do it once). Routes 3 and 5 exist for the
genuine one-off, and route 4 is punted.

### 1. LAN — the default, and the one that always works

Zero dependencies, zero configuration, no internet. A cabin with no
signal plays forever. This is not a fallback; it is the design.

Every mounted panel in the room should be pointed at a LAN address and
nothing else — a Pi kiosk boots to the same address for years, and
none of the routes below can promise that.

```bash
teller host
```

**Tradeoff:** plain HTTP, which costs you two things the client already
works around and must keep working around: no secure-context crypto
(`crypto.subtle`, `randomUUID`, OPFS, PWA install), and HTTP/1.1's
six-connections-per-origin ceiling with an SSE stream permanently
holding one. See rule 6.

### 2. Tailscale — THE remote route

If a tailnet interface is up, `teller host` notices and prints its
address alongside the room's. There is no integration beyond noticing,
and that is the point: Tailscale already solved identity, NAT traversal
and encryption, and it solved them better than teller would.

Verified end to end on a live tailnet 2026-08-13, including a real
iPad: pairing code, adoption by the Warden, and role-derived authority
all behave exactly as they do on the LAN (a seat could edit its own
character and nothing else, and could not read the campaign). The
transport really does carry no authority.

**How a remote player joins.** Share the *machine*, not the tailnet:
admin console → Machines → the host → ⋯ → **Share…**, and send them
the link. They accept with their own free Tailscale account, and they
get that one host — not your NAS, not your other laptop. Revoke from
the same menu.

**Scope it before you send the link.** A share exposes the whole
machine over the tailnet, not just port 4525 — on the machine this was
built against that also meant an AirPlay receiver, two Python servers
and a stray dev server. A Tailscale ACL limiting that user to
`host:4525` is the fix. Note that ACLs are allow-lists and a fresh
tailnet ships with a blanket allow-all rule, so a narrow rule added
beside it changes nothing; tighten the default first and confirm with
the admin console's ACL tester.

```
  over your tailnet
    http://granite.tailac56ea.ts.net:4525
    http://100.69.144.9:4525
```

**The name comes first because it's the one worth writing down.** An
address is a lease; a name is not. MagicDNS answers an ordinary reverse
lookup, so `dns.reverse` hands us the name with no Tailscale CLI, no
daemon socket and no dependency — the same "notice what's already true"
move as the detection itself. The lookup is best-effort with a 500ms
ceiling: booting the table never waits on DNS, and a resolver that
won't answer just leaves the number standing on its own.

The address stays printed underneath because **MagicDNS is the other
end's setting**, not yours. A guest who has it switched off can still
reach the number.

Detection is deliberately fussy. An address in 100.64.0.0/10 is not
proof — that range is carrier-grade NAT and your ISP may have leased
you one on a real NIC. teller only calls an interface a tailnet when
the CGNAT address is corroborated by Tailscale's own ULA prefix
(`fd7a:115c:a1e0`) on the same interface, or the interface is named
`tailscale*`. An uncorroborated CGNAT address is treated as what it is
and left off the list rather than advertised as something it isn't.

That corroboration is not paranoia for its own sake. On the machine
this was built against, Tailscale sits on `utun6` — one of **nine**
`utun` interfaces, with nothing in the name to distinguish it. The ULA
is what identifies it; a name-based guess would have been useless.

**Tradeoff:** everyone joining needs Tailscale installed and a share
accepted. That's judged acceptable — free, one sign-in, done once — but
it does mean a VPN client on their machine, which not every work laptop
allows. Still plain HTTP, so rule 6's two curses remain.

### 3. Cloudflare quick tunnel — the genuine one-off

For the person playing once who won't install a VPN for one night.
Route 2 is the answer for anyone you'll see again.

```bash
teller host --tunnel cloudflared
```

Requires `cloudflared` on PATH (`brew install cloudflared`). teller
spawns it as a **managed child**: it comes up with the host, its minted
URL is printed at boot, and it is killed on exit. That is not
politeness — a tunnel that outlives the host it points at is a URL that
502s at somebody else's table.

**Tradeoffs, and they are real:**

- **The URL rotates every run.** That is what "quick" means. Right for
  a friend dropping in tonight, wrong for anything you bolt to a wall.
- **It is public.** Anyone with the link reaches the pairing screen. By
  rule 7 that is not a way in, but it is a door that exists, and the
  link is guessable-adjacent in the way any shared URL is.
- **Cloudflare terminates TLS.** They can see the traffic. Noted for
  the paranoid; the same is true of route 4.
- If cloudflared dies mid-session, teller says so and keeps serving the
  room. The table does not care about the tunnel.

**The nice consequence:** an HTTPS origin retroactively dissolves BOTH
of rule 6's LAN curses — secure-context APIs work, and HTTP/2
multiplexing removes the six-connection SSE ceiling. **This changes
nothing about what the client may assume.** The client must still work
on plain LAN HTTP; that law stays, because route 1 is the one that
always works.

### 4. teller.ink relay — punted (Brian, 2026-08-13)

**teller.ink is a landing page. Play does not happen there, and no
relay is being built.** `--tunnel teller` is recognised and refuses
with a pointer to what does work. Routes 2, 3 and 5 cover every case
anyone has actually had.

Kept in the menu because the analysis is worth not re-deriving, and
because it stays the natural sustainable hosted tier if it's ever
wanted:

- **Don't write a relay.** Proxying teller means tunnelling SSE — the
  whole live session is a long-lived streaming response, so you'd be
  framing streams both ways while a single Durable Object per table
  holds the host socket plus every browser's open response, and carries
  every map image and rulebook PDF. That's building a tunnel product to
  avoid depending on one.
- **Write a control plane instead.** Named Cloudflare Tunnels, minted
  by teller.ink via the Cloudflare API against a host keypair (no
  account needed), token stored in `~/.teller/`. Cloudflare does NAT
  traversal, TLS and routing; teller.ink owns only the name registry
  and never proxies a byte. The host-side work is already done — it's
  the same managed child as route 3 with a different argument.
- **Use `‹name›.teller.ink`, not `‹name›.play.teller.ink`.** Universal
  SSL covers one wildcard level. A third level needs Advanced
  Certificate Manager; dropping `play.` makes the cert free.

Two things that would have to be decided first, and neither is
technical:

- **Rule 4a says teller hosts no content.** A relay streams the DM's
  rulebook PDFs through teller.ink's zone. That's transit rather than
  hosting, but "we host nothing" and "everything flows through us" are
  different postures, and the first was load-bearing enough to
  restructure the bundle format over (TEL-62). The control-plane design
  sidesteps it — teller.ink mints a name and proxies nothing.
- **It must never be the only path.** "Accounts allowed, never
  required" (rule 7) applies to transports too: showing up at a
  friend's table must never mean signing up for anything. That's why
  it's fourth of five, not first.

Its own ticket: host keypair registration, rendezvous protocol, edge
TLS.

### 5. Bring your own reverse proxy

Caddy, nginx, a VPS, whatever you already run. Point it at
`http://<host>:4525`. teller has no opinion and no code involved.

Two things to get right, and they are the two that bite:

- **Do not buffer.** SSE is the live session. nginx needs
  `proxy_buffering off;` and HTTP/1.1 upstream.
- **Do not time out long reads.** The stream is long-lived by design
  and pings every 25s.

teller's own end is verified clean: `text/event-stream` with
`cache-control: no-cache`, chunked transfer, first event flushed
immediately, and node's request/headers timeouts disabled on the host
(`host/serve.mjs`).

## Liveness over a slow link

A screen heartbeats every 20s (`src/lib/use-display.ts`); the console
calls it live within 60s (`src/components/DisplaysPanel.tsx`). Three
missed beats of slack, which is plenty for WAN latency — a remote seat
does not flicker in the screen list because someone's uplink hiccuped.

## Where this goes

TEL-84 is the transport prerequisite for TEL-55 (remote seats, the
hybrid table). The local-first architecture is what makes that coherent
at all: the host is already the authority, so a remote seat is just a
screen that happens to be far away. Camera/AV traffic later raises the
bandwidth stakes on route 4 specifically.

## Code

- `host/reach.mjs` — address classification, route resolution, the
  managed cloudflared child.
- `host/serve.mjs` — prints every live route at boot; closes the tunnel
  on SIGINT/SIGTERM.
- `host/cli.mjs` — `--tunnel`, resolved before anything binds a port.
