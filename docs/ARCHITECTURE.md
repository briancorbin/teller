# ARCHITECTURE — the layers, and what may change what

Decided 2026-08-16 (Brian), across one long conversation that started as
"rework the Warden console" and turned out to be about the thing
underneath every console screen.

**Why this file exists.** Every stuck question that day was a LAYER
confusion wearing a different costume — where do statuses live, what IS
a condition, should Talents be a character property, why is reputation
hiding in a field key. Each got resolved locally, by carving a namespace
into whichever list was nearest, three times in one codebase. They were
one question: *what is allowed to define what?* This file answers it
once so it stops being answered ad hoc.

It describes the shape teller is being built toward. Where something is
not built, it says so. Nothing here is a plan to build it.

**How this file relates to the RULES** (Brian, 2026-08-16): the rules in
`CLAUDE.md` were written before there was an architecture — seven of the
original nine in a single sitting, as that file admits. They are not
gospel and shouldn't be treated as such until the architecture they're
supposed to protect actually exists. This file is that architecture
being written down; the rules harden as it stabilises, not before.

Two caveats that keep this from being a licence. The rules file already
separates *assumed* from *learned*, and a **learned** rule is a scar —
something broke, and the sentence is the stitches. Bending one means
re-deriving the failure, not shrugging. And a rule that a new design
merely *appears* to collide with usually doesn't: the panel section
below looked like it needed rule 6 relaxed, and the resolution turned
out to satisfy rule 6 exactly. Check whether the latitude is needed
before spending it.

---

## The stack

```
Session      what's live tonight
Campaign     this table's arrangement — wins
Pack         the world and the words
System       how the game works (declarative)
─────────────────────────────────────────────  ← the trust boundary
Plugin       what a System is allowed to say (code)
Core         the primitives and the surfaces
```

Below the line is code. Above it is data. That line is also the security
boundary and the "did a human choose to install this" boundary, and it
being the same line in all three senses is not a coincidence — it's what
makes the model explainable to someone who isn't reading this file.

Each layer **proposes** to the ones below; the merge is always the same
shape — system → packs (in the campaign's declared order) → campaign,
**later wins by name**. That's `bestiaryFor`, and now `statusesFor`, and
it should remain the only merge in the codebase. Rule 1 then sits on top
of all of it:

> Core holds it · Plugin extends what can be said · System proposes ·
> Pack enriches · Campaign decides · **a human overrules.**

---

## 1 · Core

**Is:** the software. Three responsibilities, not two — the first
draft of this file said "primitives and surfaces" and left out the
whole third of it that keeps the lights on:

1. **The primitives** — what can be stored. The closed set (door 1).
2. **The surfaces** — the roles, and what each may see and do.
3. **The plumbing** — persistence, transport, auth, routing, sync,
   asset serving, the event log, undo.

**May:** store, log, undo, render, pair screens, serve, sync, roll
declared dice.

**May not:** know a single game concept. No `hp`, no Skill, no Trapped
(rule 2).

**Authored by:** us. **Delivered as:** a release. **Identity:** none.

Core is the only layer with no file, no id and no author — it is the one
thing you cannot hand to someone as content. Everything above it is a
thing you can give away, and that asymmetry is why the layers above all
need identity schemes and Core doesn't.

*Naming note:* "Engine" was considered and rejected. The thesis sentence
is "the humans at the table are the rules engine"; naming the code layer
Engine puts the project in contradiction with its own central line. And
"core type" is already a phrase carrying weight — see the contract
below.

## 2 · Plugin

**Is:** code that extends what a System is allowed to say.

**May:** register implementations against named extension points —
compute a proposal, render a widget, contribute a surface, replace a
default (order initiative *this* way).

**May not:** **add a way to store.** See the constraint below. Also: not
part of any merge. Plugins *load*; content *merges*.

**Authored by:** anyone. **Delivered as:** a file in `~/.teller/plugins/`,
deliberately enabled. **Identity:** minted id (not built).

**Nothing here is built.** Plugin is a named, empty slot. See "the one
confirmed instance" below for why it stays empty.

## 3 · System

**Is:** how the game works — kinds, dice, vocabulary, statuses, skills,
progression, creation.

**May:** declare what kinds of thing exist and what they're called;
rename Core's vocabulary (Warden, not DM); declare dice; propose
defaults and starting kits.

**May not:** carry the book's prose. Know about a specific monster, town
or NPC.

**Authored by:** anyone. **Delivered as:** a `systems` row today
(migration 0007); `.system` eventually. **Identity:** a hand-chosen slug
(`'wiw'`) — see door 2.

## 4 · Pack

**Is:** the world and the words — bestiary, prose, catalogue, trades,
statuses' descriptions, art.

**May:** add content freely; add a new status (a supplement making a
mechanical claim is its author's affair); restate one the system already
has, to fix a spelling or supply a visual.

**May not:** redefine the system's base list, change dice, or change
what a Skill is. The system carries the mechanic; the pack carries the
book's words about it (rule 4, 2026-08-16).

**Authored by:** whoever holds the rights. **Delivered as:** `.pack`, or
a folder on the shelf. **Identity:** minted `pak_`.

*Naming note:* "Book" is disqualified — teller already has books (PDFs,
`bok_` content hashes). "Compendium" is Foundry's word.

## 5 · Campaign

**Is:** one table's arrangement — which system, which packs in what
order, the characters, encounters, scenes, handouts, and its own
additions.

**May:** override anything above it. This is where rule 1 lives.

**May not:** nothing. It wins.

**Authored by:** the DM, usually. **Delivered as:** `.story`.
**Identity:** `cmp_`.

*Naming note, and the one vocabulary change this conversation made:*
"Story" and "Campaign" both named this layer — the file and the row —
and two words for one layer is exactly the smell that produced the
namespace hacks. **The layer is Campaign; `.story` is the file a
Campaign travels in.** Same relationship a pack has to `.pack`. This
also reframes TEL-87: the question stops being "is a distributed
`.story` a different thing from a backup" and becomes "does a Campaign
have one portable form or two," which is a question about `rights` and
manifest identity.

## 6 · Session

**Is:** what's live — turn order and index, fog, deployed foes, active
scene, paired displays.

**May:** change fast and be discarded.

**May not:** hold anything authored. Everything it touches is stored as
Campaign data; the DO is a cache with opinions about latency.

**Authored by:** nobody. **Delivered as:** `CampaignDO` + SSE. Never a
file.

---

## Inside Core — seams, not modules

The question that prompted this (Brian, 2026-08-17): storage, server↔panel
communication, routing, AI, connection protocols — all Core, and should
they be isolated modules?

All Core, yes. There is no layer beneath it and nothing above it can
supply any of it. But **isolation is not the useful unit here.** The
single package is deliberate (`CLAUDE.md`: no workspace), and at ~11k
lines with one author, package boundaries cost more ceremony than they
catch. A module is only *one* way to enforce a seam; a chokepoint
function, a type that refuses to expose the wrong thing, or a lint rule
is usually cheaper and catches the actual failure instead of a proxy for
it.

Three seams earn enforcement. Only one of them is currently unguarded.

**1 · The runtime seam — the important one, held by discipline alone.**
`CLAUDE.md`: *keep route handlers runtime-agnostic or this dies.* The
Cloudflare coupling is three things — `env.ASSETS.fetch`, one
`crypto.subtle` call, and the Durable Object — and `host/d1.mjs`,
`r2.mjs`, `durable.mjs`, `assets.mjs` supply each against `node:sqlite`
and local disk.

The failure is a route reaching for an `env.` API only one runtime has,
and **it is silent on whichever runtime you happen to be developing
on.** That profile — invisible until someone else runs it — is what
justifies structural prevention. The cheap fix isn't a package, it's an
`Env` type that doesn't expose non-portable APIs to route code. A
boundary the compiler holds beats one a comment holds.

**2 · The public-snapshot boundary.** What a passive surface may see:
notes stripped, NPC numbers never shown. A security boundary, so it
should be one function nothing can route around. Mostly already is.

**3 · The authorization boundary** (rule 7). Role-derived, never
re-derived from a secret the client holds. Already concentrated in
`worker/tickets.ts` plus the role lookup.

Everything else — routing, storage, sync — is the worker doing its job.
Splitting it buys ceremony.

**Where size is actually doing damage**, and it isn't architectural:
`worker/index.ts` at ~2,000 lines and `worker/types.ts` at ~2,260. That's
code organisation, worth doing on its own terms, and it neither blocks
nor informs anything in this file.

---

## The degradation contract

Brian, 2026-08-16, and the best idea of that day:

> **Nothing above Core is required.** When teller meets something it
> can't handle, it degrades to something the humans can still operate.

This is not error handling. It's the membership test for Core, and it
gives the definition that everything else hangs off:

> **A core type is the most a human can still operate with no help.**

A `{name, value?}` with no declaration attached is a label you can add,
edit and remove. That's the floor. Every system-declared kind is the
same primitive with a declaration on top — which is why a kind this
build has never heard of isn't an error case, it's the same renderer
with the heading it was given and no constraints.

The test was run for real (a campaign with no system at all, 2026-08-16)
and found a genuine crash: an unrecognised `effect` name indexed a
record, returned `undefined`, and the next property access white-screened
the console. Fixed by `stateVisual()` in `src/components/token-visuals.ts`,
whose comment states the rule — *losing the colour is a fine
degradation; losing the console is not.*

**Reading forgiving, writing strict** is the same contract at the file
edge, and it is permanent policy rather than a migration window: a file
authored against an older shape can arrive at any time, and a database
migration cannot reach a file that doesn't exist yet. See
`worker/tags.ts`.

---

## Plugin and System, and why they are two things

The first framing tried was that a system delivered as code and a system
delivered as a file are the same layer, differently delivered —
*substitution*. That's wrong, and Brian's correction is the reason this
section exists: code should extend **what a system can say** —
*composition*.

The difference is whether a plugin serves systems its author never met.
Someone wants a hex-crawl travel clock; Core has no clock. Under
substitution they must write their whole system in code, and it serves
one game. Under composition they ship a `clock` plugin, and WiW, D&D and
a system nobody has written yet can all declare a clock in a `.system`
file. One is a fork; the other is an ecosystem.

The mapping Brian reached for holds up: **TypeScript is the System
layer** — declarative, adds no runtime capability, erased before
execution, describes and constrains what's underneath. **React and
Angular are the Plugin layer** — they add capability, and content is
then written against them.

### The constraint that keeps the contract alive

> **A plugin may extend what can be declared. It may never add a way to
> store.**

Everything a plugin introduces bottoms out in Core's primitives, and the
plugin declares what its thing **degrades to** in those terms. Missing
the clock plugin, the clock is a counter with a label: you lose the
behaviour and keep the game.

The consequence is the reason door 1 matters: **Core's primitive list is
the plugin API surface.** It's what every plugin author codes against
and what every `.system` file declares in terms of, and it cannot be
quietly changed later.

Who may add what, in one table — and note that only the bottom row can
add storage:

| | may add | may not add |
|---|---|---|
| **System** | vocabulary, meaning, presentation config | behaviour, storage |
| **Plugin** | behaviour, relationships, organisation, rendering | **storage** |
| **Core** | storage | — |

The useful consequence: **"just write a plugin" does not dodge the Core
gate for storage requests.** A plugin can't store either, so the escape
hatch only relieves pressure for BEHAVIOUR requests — which are the ones
that should be relieved. The gate holds by construction rather than by
policing.

### Uninstall it and look — the compliance test

The storage rule is not enforceable by the type system. A plugin can
always fake new storage by encoding structure into an existing
primitive: a graph as JSON in a `notes` field, a relationship as
`{ name: 'barrett→bess', value: 1 }`. That is the
mechanic-hiding-in-a-text-field bug, committed deliberately, by someone
whose code we don't control.

It is, however, self-auditing — because of the contract that's already
here:

> **Uninstall the plugin and look at what's left.** If the data reads as
> something a human can operate, the plugin played fair. If it reads as
> a blob nobody can act on, it cheated.

So the degradation contract isn't only a resilience property; it's the
compliance test for the storage rule, it takes ten seconds, and anyone
can run it on a plugin they didn't write.

### What "modifying Core" has to mean

Taken literally it kills the floor — if plugins can rewrite Core, Core
isn't a floor and degradation is meaningless. The three readings that
survive are all one mechanism:

- **on top of** — compute a proposal, render a widget
- **alongside** — a new pane, a new surface, an integration
- **modifying** — *replace a named default*, not rewrite

All three are **a plugin registering implementations against named
extension points**. That is a far smaller API than "code that runs
alongside Core," and it is the version that can be versioned.

### Three tiers, in the order they get cheap to allow

| Tier | Shape | Runs where | Trust needed |
|---|---|---|---|
| **Proposer** | `(state, question) → proposal` | both runtimes, sandboxable | none — it cannot act |
| **Surface** | renders a widget or pane | client only | low |
| **Effectful** | lights, audio, network, disk | Node host only, never Workers | full |

The proposer tier is pure, so it is portable across both runtimes and
safe to run from a stranger's file. The effectful tier cannot exist on
Workers at all and is where the dual-runtime rule gets expensive.

**The proposer tier already has a working reference implementation, and
it shipped before we had a name for it.** Run `worker/assistant.ts`
through the three-question test: it holds no state a human needs
recorded (it proposes; results land in ordinary slots), it isn't
universal, and losing it means the Warden makes the call themselves.
Three for three → plugin. Its shape matches exactly — four exports, two
of them config predicates, two of them `(state, question) → proposal`,
and **zero database writes**. It's even optional by configuration
already: no `assistant.json` means no assistant and no button, never a
nag, which is the degradation contract written before it was stated.

So when the proposer interface is eventually extracted, it gets
extracted from something that works rather than designed against a
guess. And it confirms the pattern for Scan: build it shaped like a
plugin, ship it inside Core, extract the interface when there is a
**second one of the same tier** — not a second one overall.

### The one confirmed instance, and what it corrected

`docs/SYSTEMS.md` surveys all 23 Guidebook subsystems, including the six
that aren't built, and records a verdict on each. **It found six gaps
and every one is declarative** — counter/max adjustments, deferred Grit
(which it admits may just be a table scribble), the horse/mech entity
question, a hidden bestiary field, per-turn local state, and proposing
macros. The audited template vocabulary is nine keys, all marked "sound,
general."

So **WiW as a whole does not need a plugin.**

The exception is Forstall **Scan** (§20): guess a monster's six-digit
Kurtz Frequency with green/yellow/red feedback per digit. It is
literally Mastermind. There is no JSON vocabulary that expresses it
without inventing a Mastermind-shaped key.

That corrected the tier ranking. Proposers looked like the interesting
middle, on the assumption that code would be needed for game *math*. The
survey says math is declarable; what isn't declarable is **interaction**.
So:

> A plugin isn't the escape hatch for systems that don't fit. It's the
> escape hatch for **experiences** — minigames, widgets, integrations.

### The "is it a plugin?" test

Three questions. Scan answers all three the same way:

1. **Does it hold state a human needs recorded?** No — the frequency is
   a hidden bestiary field, which is already Core.
2. **Is it universal across systems?** No — it's one device in one book.
3. **If you lose it, does someone just say a sentence out loud?** Yes —
   "two green, one yellow."

Three for three → plugin. Run statuses through it and you get three for
three the other way → Core. Note that Scan's degradation is *perfect*:
the fallback is literally how you'd play it at a table with no computer.

**Caveat, stated deliberately.** The survey's verdicts on unbuilt
sections are PREDICTIONS, and predictions about what fits have been
wrong three times in one week — severity, Talents and the relief skill
all type-checked as "fits" right up until something had to read them
back. Treat "the survey says it's declarative" as strong evidence, not
proof. The likeliest place it's wrong is §18/§19, which the doc itself
refuses to decide.

---

## Panels — how declared data gets presented

*Direction, not settled (Brian, 2026-08-16). Nothing here is built
beyond the embryo noted below.*

**The gap this fills.** Declaring a kind gets you a generic list of
name/value pairs. That is the correct FLOOR — it's the degradation
target, and it has to stay ugly-but-operable. It is a terrible CEILING.
The seat looks the way it does today because ~20 hand-written components
in `src/components/sheet/` know what a Cylinder, a Track, a Reticle and
a Ladder are. Without a way to express layout, every new kind is a
generic list forever, and "declare a kind" stops being a real answer to
anyone who cares how their game looks.

**The seam already exists in embryo.** `SystemTemplate.screens` declares
named screens with an icon, which kinds they show, which counters ride
along, and flags for the arms/rest screens; `SeatView` consumes it. So a
system already authors part of its own seat, and the idea is proven at
small scale. But it only splits **what a character carries** — which is
the same tell as `marks.prefix` and `ladders[].prefix`: it grew for one
need and was never generalised.

### The one rule: a panel proposes, the ROLE decides

"Assign any panel to any screen" collides with three separate
commitments, and all three resolve the same way — which is rule 1's
shape, applied to surfaces:

- **Passive surfaces never grow buttons** (rule 6). The table is the
  GROUND; `board`, `art` and `badge` are passive. → Whether a panel's
  controls are LIVE is a property of the screen's role, not of the
  panel. The same panel renders interactive on a seat and inert on a
  badge.
- **Player-safe means player-safe.** Passive surfaces consume `/public`
  — notes stripped, NPC numbers never shown. → The DATA a panel receives
  is whatever the role's snapshot contains. A panel asks; the role
  serves; what's missing degrades, which is already the contract.
- **The console's pane list is authoritative** (`src/lib/panes.ts`) — a
  pane nobody can be assigned to is a pane that doesn't exist. → Panels
  don't get to invent roles. They fill one.

> **A panel declares layout and intent. The screen's role decides what
> it may show and whether its controls are live.**

A panel cannot make a table TV interactive or a badge leak NPC health by
being assigned there, which is what makes "any panel on any screen"
safe to actually mean.

### Two arrangements, not one responsive layout

Rule 6 is unusually specific here because it cost a day: **content
renders at designed size, always.** `FitBox` was removed. A layout that
overflows mounted glass is **clipped, and the clip is the diagnostic** —
the fix is design (fewer blocks, a shelf, a split), never a transform
shrinking type until nobody can read it. So "the panel figures out how
to render on whatever screen it's on" is precisely the thing that rule
forbids.

It doesn't need to. The codebase asks exactly ONE device question —
`wide` in `SeatView`: is this glass **mounted** or **held**? Mounted has
plentiful width and fixed height, never scrolls, clips. Held has scarce
width and elastic height, runs at natural size, may scroll down.

So a panel carries **two authored arrangements**. Plural, not adaptive.
One decision point instead of a device matrix, it's already the line the
client draws, and the clip stays a diagnostic instead of something the
format papers over. **This satisfies rule 6 rather than bending it** —
checked before assuming otherwise.

### A panel is layout + components. A plugin is new components.

The revolver that rotates when you click to reload is *behaviour*, not
layout. This is where declarative layout formats die: they grow
conditionals, then expressions, then they're a bad programming language.

The escape route is already built. **`dials` maps a counter to a
`cylinder` face** — the revolver is *already declarable*. So:

> A panel picks from a vocabulary of components. When someone wants a
> behaviour Core doesn't ship, that's a **plugin contributing a
> component** — the same escape hatch, one layer up.

Which is why the panel format never needs to be complete, and must never
grow control flow. Assets ride along exactly as pack art already does:
relative inside the bundle, resolved to a key at install (TEL-88).

### Degradation is what lets this start tiny

A panel teller can't render falls back to the generic kind rendering. So
**panels are enhancement over a default, never the only way to see the
data** — the format doesn't have to be right on day one, or complete
ever. That's the biggest de-risking factor available here and it costs
nothing, because the contract already exists.

### Which layer, and when

**A facet of System**, not a new layer: declarative presentation, above
Plugin, below Pack. Declared by a system, pack or plugin; **assigned by
the Campaign**, since Displays-assignment is a table's act. Same merge,
campaign wins.

The `.panel` extension question is deliberately deferred — `CLAUDE.md`'s
own rule is that *a new extension tracks a different kind of thing, not
a different degree of completeness*, and whether a panel is a different
KIND from a system is real but downstream. Packaging follows the format;
it doesn't lead it.

**Sequencing, and this is the corner-avoidance:** door 3 says don't
serialise `.system` until Core's kinds exist. The same logic applies
harder here — **don't design a layout language before you know what data
shapes it lays out.** Kinds first, panels second.

The empirical route is unusually good, because this isn't greenfield:
there are ~20 hand-written components in `src/components/sheet/`. The
way to find this format is to ask *"what would express THESE?"* — not to
invent vocabulary and hope. Extend `screens` incrementally as kinds
land and let the format fall out of the third or fourth thing that
doesn't fit.

**The failure mode, named so it's recognisable:** treating this as
"design the layout language" and stalling for a month. The tractable
version is that `screens` already exists and grows.

---

## The resolution law

The structure is package-management-shaped, and two of npm's properties
would be fatal here.

**npm resolves or dies; teller degrades.** A missing dependency in npm
means the app doesn't boot. Here, missing means reduced. The platform
teller actually resembles is **the web** — an unknown CSS property is
dropped and the page still renders, an unrecognised element becomes an
inert box, `<video>` falls back to its children. Progressive enhancement
is the degradation contract, invented forty years earlier. Structure
from npm; semantics from the browser.

**npm's registry is what rule 4a forbids for content.** The alternative
was already chosen: content addressing. A book's id is the sha-256 of
its own bytes, so two people who own the same rulebook derive the same
id without coordinating. That's Git and Nix, not npm. The other reason
to stay away: a DM at a table cannot debug a version conflict, and the
moment installing a campaign means resolving a graph, local-first is
dead.

So, the law — most of which is already how packs and books behave, and
none of which had been stated generally:

> Everything above Core is referenced **by id**, never carried.
> Resolution is *do I have it* — there is no range, no transitive graph,
> no lockfile. What's present is merged in declared precedence order.
> What's absent is **reported as missing and degraded**, never fatal.

**Compatibility is the one real gap.** A pack authored against WiW v12
installs happily on v19 and nothing notices. Harmless with one author;
the first genuine support burden the moment there are two, because the
failure is silent — a status that quietly stops matching, a catalogue
group that stopped existing. The smallest fix that stays on the right
side of rule 1: a pack or system may state **which system version it was
authored against**, as a claim, shown to a human when it doesn't match,
never enforced and never blocking.

**Resist version ranges for as long as possible.** The moment a pack
says `wiw@^2` you have signed up for a resolver, and resolvers are how
"it works at my table" becomes a support channel.

---

## What teller may host

Rule 4a says "teller hosts no content. Not packs, not books." Brian,
2026-08-16: that was aimed at IP, and plugins didn't exist when it was
written. **This is the third time rule 4 has been found too broad, in
exactly the pattern the rule's own history documents** — a real
constraint stated as a wider one that was easier to remember.

The narrowing generalises rather than carving an exception, because the
distinguishing property was never code-versus-prose:

> **teller may host anything whose author can authorize its
> redistribution.**

A plugin qualifies trivially — functional, author-owned. So does a
`homebrew` pack, which rule 4 *already* says its author may hand out
freely. A `licensed` or `personal` pack does not, and never will,
because its author usually cannot grant what they'd be granting.

This finally gives **`rights` a job**. At the table it correctly gates
nothing; hosting is the one place the answer has to be machine-readable.

**Two costs, both standing obligations rather than one-time builds:**

- **Code is a fine smuggling container.** "A plugin carries no IP" is a
  claim about intent, not a property of the format — nothing prevents a
  plugin whose source is a const array of stat blocks. And
  `rights: homebrew` is a self-declaration teller **cannot verify** and
  must never present as verified (rule 4). Hosting therefore means
  acquiring a reporting-and-takedown posture.
- **Hosting executables is a security posture.** A registry of code that
  runs on DMs' machines is a supply chain. This is where the tier split
  stops being a nicety: a proposer is sandboxable, and *surface* — the
  tier the survey says is actually needed — touches the DOM.

**Nothing is hosted, and nothing should be built.** The precedent is one
line down from the rule in question: *"v0 of that is a GitHub repo of
JSON, not a platform."* Same answer — the plugin registry v0 is a README
in `teller-ink/plugins`; installing means putting a file in
`~/.teller/plugins/` and deliberately enabling it. Revocable by deleting
a line from a markdown file rather than by operating a takedown process.

What would change the answer: **a second person writing a plugin.**
Until then a registry is infrastructure for an ecosystem of one.

**One place the pack precedent is deliberately broken.** A pack dropped
in the folder auto-installs on the sweep. A plugin must not. Code on
disk should be *seen and offered*, never enabled by a sweep — "drop it
in the folder and it runs" is a fine rule for data and a bad one for
executables.

---

## The one-way doors

Almost everything here is a two-way door and can wait. Three are not —
door 1 has since been walked through and is recorded as decided; doors 2
and 3 are still open.

### Door 1 — Core's primitive list is CLOSED *(decided 2026-08-16, Brian)*

Not "what is the complete list" — that's the big version of the
question and it isn't the one that has to be answered. The one that does
is whether the list is **closed**: must a System express everything it
declares in terms of primitives Core already has?

Answer **yes** and future kinds are additive and non-breaking, because
they're declarations over an existing primitive. Answer **no** — or
answer nothing, which is today's answer — and every new kind adds a
`CharacterData` field, a migration, a serializer coercion and a PATCH
allowlist entry, which is rule 2 being violated once per kind forever.

The evidence that it's already being answered "no" by default: the
character has four named lists, and three system-declared kinds have had
to carve namespaces inside them — statuses were a string with a number
on the end (fixed 2026-08-16), Talents live behind a `"Talent: "` prefix
(`SystemTemplate.marks`), reputation lives behind a `rep_` field-key
prefix (`SystemTemplate.ladders`). Same primitive underneath all three:
`{ name, value? }`.

**The line worth keeping, once drawn:** a field is *filled in*; a kind
is a *subset held*. Skills and counters — the character has every one,
always. Statuses, Talents, standings — the system declares a population
and the character holds some of it. Standings already behave this way:
nothing is stored until a party moves off `defaultStep`.

**Closed means the list of places to put bytes is fixed, and nothing
above Core may add to it.** Systems get unlimited expressiveness in what
they DECLARE; they don't get to invent storage. The nearest analogy is
`data-*` attributes and CSS custom properties — one closed mechanism,
unlimited author vocabulary, and the browser never grows a new attribute
type per author.

It does not mean the primitives are frozen forever. It means an addition
is a deliberate Core-version change rather than a side effect of
somebody authoring a system. **The question is who can cause one.**

The honest cost: `Record<string, Tag[]>` knows less at compile time than
`marks: Mark[]`. But it isn't safety being lost — consumers already do
dynamic lookups (`system.marks.prefix`, `ladders[].prefix`); this makes
the existing dynamism explicit and gives it one code path instead of
three bespoke ones.

### The escalation ladder

Three outcomes, in the order to try them (Brian, 2026-08-16):

1. **Declare a kind.** Free, ungated, no approval — the overwhelming
   majority. The system decides what goes in the store and how it's
   presented and used.
2. **A Core addition.** Strict, rare, gated on Brian doing it or
   approving it.
3. **A plugin.** For anything bespoke that doesn't belong in Core.

The triage between them reuses tests already in this file:

- **Does it hold state a human needs recorded?** No — it acts or renders
  → **plugin** (the three-question test above).
- Yes → **can it honestly be a list of `{ name, value? }`?** Yes →
  **declare a kind**.
- No — it genuinely has structure (ordering that matters, a
  relationship, a shape) → **Core addition**.

**The tell for that last case is this codebase's own recurring bug: if
you find yourself putting a second fact into the name or the value,
it isn't a kind.** Four instances so far, every one of which appeared to
fit — severity on the end of a tag string, a Talent's category behind a
`"Talent: "` prefix, the relieving skill in a free-text `meta`,
reputation behind a `rep_` field-key prefix. The pattern that caused the
bugs is the test for when a Core addition is actually warranted.

### Why Core specifically is the gated layer

Not maintainer's privilege — **Core is the only layer with no version
negotiation.** Every other layer is referenced by id and degrades when
absent: a missing pack, system or plugin costs something and the table
plays on. Core is referenced by nothing; it is simply whatever build is
running. So a Core addition is the only change in this architecture that
cannot be degraded around, opted into per-table, or rolled back for one
campaign.

That also predicts the pressure the gate exists to resist. Nobody will
ask for a Core addition because something is impossible; they'll ask
because a real property would be *nicer* than a kind. That's
ergonomics — and ergonomics is what the System declaration layer is for.

### What a Core addition would actually look like

Worth working the strongest candidate, because the answer is
instructive. §18/§19 — horses and mechs — is the one the survey
explicitly refuses to decide, and it needs **ownership**: this horse
belongs to that character.

1. Holds state a human needs recorded? **Yes** → a storage question,
   not a plugin.
2. Honestly `{ name, value? }`? `{ name: 'Owner', value: 'Barrett' }` —
   apparently **yes**.

→ declare a kind, not a Core addition. The strongest candidate on the
board resolves one rung down, which is decent evidence the closed set is
genuinely sufficient.

Except that's a **label, not a reference**. Rename Barrett and it
silently breaks. Store `chr_a91f…` instead and it resolves correctly but
degrades terribly — an opaque id fails "the most a human can operate
with no help." A thing that must **resolve AND degrade** has to carry
both: a stable id for machines, and a human-readable name allowed to go
stale without breaking the link. `{ name, value? }` cannot hold that
without putting a second fact in one of its two slots — which is exactly
the tell.

**So a resolvable reference is the one credible Core addition currently
visible**, and it arrives the day a horse becomes an entity rather than
an item. Not hypothetical: it's queued behind a question
`docs/SYSTEMS.md` deliberately left open.

### The two "anything goes" buckets — and only one is new

Brian, 2026-08-16: a generic fallback store is reasonable. It is, but
the instinct covers two different needs with two different answers, and
conflating them is how the closed set would get undermined.

**For RECORD that doesn't fit a kind — it already exists: `notes`.**
Free text, human-readable, human-editable, degrades perfectly because
prose is the one format that needs no interpreter. That is the sanctioned
anything-goes bucket for game facts, and nothing new is required.

**For plugin SCRATCH — that's the genuine gap.** A widget's
in-progress state is not a record and shouldn't be forced to pretend it's
a kind: Scan's guesses-so-far this session, a pane's collapsed sections,
a cached layout. The rule that keeps this from becoming a hole:

> The scratch store holds state that is **not the table's record**, it
> is namespaced per plugin, and it carries **no durability guarantee** —
> teller may drop it, and it never travels in a `.story`.

That last clause is the enforcement, and it makes misuse self-punishing
rather than policed: if throwing it away loses something the table wants
back, it was record and belonged in a kind. Scratch that doesn't travel
also falls straight out of rule 9 — a bundle carries what you wrote, and
nobody wrote a cache.

Scan demonstrates both halves at once: the Kurtz Frequency is **record**
(a hidden bestiary field, and it must outlive the plugin); the guess grid
is **scratch** (losing it costs nothing — you re-enter three digits).

Name it for the contract — `scratch`, not `data` or `state` — so the
durability promise is legible at the call site. Not built; nothing needs
it until the first plugin exists.

### `tags` is the un-kinded kind — and conditions live there

Decided 2026-08-17, on contact with the code, and it REVERSES the line
this file carried for a day ("statuses and standings are moving").
Standings moved. Statuses stay, and the reason is the contract:

`StatusPanel` deliberately merges two sources — the declared list from
the pack, and any LOOSE tag nobody declared, so a Warden typing
"Bleeding" mid-session isn't lost. Split declared statuses into
`kinds.status` and leave undeclared ones in `tags`, and the panel reads
two lists, a newly typed condition has to pick one, and "Trapped" and
"Bleeding" — the same fact from a human's side — get stored in
different places. Move ALL tags into `kinds.status` instead and the
un-kinded bucket disappears, taking the degradation target with it: a
system declaring no statuses would have nowhere to put a typed
condition.

So `tags` is kind zero. **`kinds` holds the kinds BEYOND the default**,
which is what the store was always for. The floor keeps its name.

(The cost side agreed: `tags` is on seven entity types — characters,
NPCs, blueprints, encounter foes, items, both template seeds — so this
was the widest sweep available, on the one kind that already worked, to
make the design worse.)

**What's left of this door is nothing.** The store exists
(`worker/kinds.ts`), marks and standings are in it, and `marks.prefix`
and `ladders[].prefix` are both gone. `wip/marks` (`496d6e9`) was
premised on the open answer and is superseded — delete it; its one
durable catch, the PATCH allowlist entry, is in.

### Door 2 — System identity is a hand-chosen slug *(open, cheap now)*

`migration 0007`: `system TEXT PRIMARY KEY`, values `'wiw'` and
`'dnd5e'`. That's fine while systems are rows seeded from our own
source. It breaks the moment systems travel as files, because two people
will both write `'wiw'` and there is no way to tell the copies apart —
the exact problem `pak_` ids were minted to solve, and the lesson the
lesson-blueprints already taught: identity is the id, never the name.

Adding a minted `sys_` id costs a column and a migration over two rows
today. After other people author systems it costs a compatibility break.

It also settles a question that's been open separately: **can a built-in
system be deleted?** Today no — `getSystem` re-seeds from
`worker/templates.ts` when the row is missing, so a Campaign cannot
actually overrule a shipped system, which quietly contradicts the
through-line. With a minted id, a shipped system is a row like any
other and re-seeding by name stops being the mechanism.

### Door 3 — writing `.system` too early *(open; ordering, not work)*

`SystemTemplate` grew nine keys organically and two of them —
`marks.prefix` and `ladders[].prefix` — are workarounds for the missing
Core type in door 1. Serialising it as-is freezes two hacks into a
public format that other people will author against.

**Close door 1, then serialise.** The order is the whole decision.

### Explicitly two-way — safe to defer indefinitely

Whether Plugin ever ships; the plugin API shape (discover it empirically
from the second minigame, never by designing around the first); the
tiers and sandboxing; hosting and any registry; whether a horse is a
character or an item (unless it turns out to change Core's type list, in
which case it's door 1 wearing a hat); the console IA split; the design
system. **None of those are behind any of the three doors** — in
particular the console redesign and the design-system work are blocked
on nothing in this file.

---

## Open questions

- **Doors 2 and 3**, above — system identity, and the ordering that
  keeps `.system` from freezing two hacks. Door 1 is decided; what
  remains of it is a build.
- **Can a kind declare its value domain?** Numeric with a cap, versus an
  ordered step list — the difference between `statuses.stack/cap` living
  *on* the kind or beside it. It's the first place the declarative format
  has to decide how much vocabulary it owns. Deferred on purpose: declare
  kinds with name/label/text only, and let the second system that
  doesn't fit say what the declaration needs.
- **TEL-87** — whether a Campaign has one portable form or two, plus
  `rights` and identity on the manifest. Independent of the above.
- **Horses and mechs** (`docs/SYSTEMS.md` §18/§19) — entity or item. The
  doc refuses to decide; decide when a table wants one.
- **Derived readings.** Bloodied/Down/Out of Grit were deleted as stored
  conditions (2026-08-16). Whether they return as something *computed*
  is open; the Frenzy case suggests derivation at the point of use,
  which `thresholdOf` in `worker/assistant.ts` already does for the
  assistant prompt, is probably the whole answer.
