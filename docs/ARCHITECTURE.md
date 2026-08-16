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

**Is:** the software. Primitives and surfaces.

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

Almost everything here is a two-way door and can wait. Three are not.

### Door 1 — is Core's primitive list CLOSED? *(open, and the only urgent one)*

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

Deciding "closed" is cheap, is a decision rather than a build, and is
what unblocks door 3.

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

- **Door 1**, above. Everything else in this list is smaller.
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
