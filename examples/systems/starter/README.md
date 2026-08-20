# Starter — the fully generic manual table, as a file

teller ships empty (§M-2). The kernel seeds only the five HOST tools —
boards, log, plugins, screens, shelf — because those are the screens
about this *machine*, and they're meaningful before anyone has decided
what game is being played. Everything about PLAY — roster, runner,
encounters, bestiary, rules, and the entity arrangements (`sheet`,
`bare`) — is a **system-layer declaration** (§M-6). So a host with no
system is a host mid-setup: five tabs, a shelf that says so, and
nowhere to put a fight.

**This is the escape hatch.** Starter is a zero-IP system that declares
the generic play screens and nothing else, so the fully generic manual
table still exists — as a file on the shelf, not as a hardcode in the
kernel. Sit down with it and you get every screen teller knows how to
draw, with none of anybody's game in them: you type in the lists, teller
keeps the books, and no declaration presumes what a number means.

Like `examples/plugins/`, this is **source you copy**, not something
teller installs. It is not seeded, not special, and not loaded from the
repo — it is an ordinary system folder that happens to ship in the
source tree so there's a working one to start from.

## Install

```
cp -R examples/systems/starter ~/.teller-next/systems/starter
```

Then either restart the host or `POST /api/shelf/sweep` (the DM's door,
which answers with the load report). Make a campaign on it from the
console's campaign screen, or:

```
curl -X POST http://localhost:4526/api/campaigns \
  -H "x-dm-key: $(cat ~/.teller-next/dm.key)" \
  -H 'content-type: application/json' \
  -d '{"name":"My Table","system":"sys_starter"}'
```

**No trust row is needed.** Trust gates outside CODE, never data
(`core/panels-shelf.ts`, `core/boot.ts`): Starter carries no
`presentations/` and none of its panels carry blocks, so the sweep never
produces anything to enable — an absent trust row means the declarations
are IN and there is no pending code to switch on. You would only need
the plugins-tab toggle if you added a `presentations/*.tsx` or a
code-carrying panel of your own. (A row with `enabled: 0` is the
opposite act — a tombstone that takes a declaration back out.)

## What's in it

```
system.json          sys_starter, and one kind declaration
panels/roster/       ─┐
panels/runner/        │ the play screens, each one small file
panels/encounters/    │ naming a teller tool
panels/bestiary/      │
panels/rules/        ─┘
panels/sheet/        the entity arrangement: header + everything stored
panels/bare/         the floor's own grammar, one control per value
```

`system.json` declares exactly one thing: that a list called
`conditions` counts, and that easing an entry to zero CLEARS it rather
than storing a zero. That's what makes a condition either on or gone,
and it is the one piece of meaning a generic table still needs — every
other list is text or numbers and reads fine without a declaration
(§M-8: absent is zero, everywhere).

Nothing here names a condition, a stat, a skill or a resource. There is
no `statuses` list, no `dials`, no `pins`, no `dice`: those are all
statements about how one game works, and Starter is deliberately silent
on all of them. The consequence is the point — every face teller can
summon resolves to nothing, and every screen falls to the FLOOR (§L
phase 3): bars, steppers, chips and ledger rows, with every stored value
present and editable.

The `sheet` panel is `header` + `rest`: who this is, then every list the
entity actually has, one section each. That IS the degradation contract
written as an arrangement — a system that knows nothing about your lists
still surfaces all of them. It is also why the arrangement is flat: the
moment you know your game has a Health and a Grit, the honest thing is
to say so in your own panel, not to make this one guess.

## Where to go from here

This folder is meant to be copied and renamed — it's the smallest legal
system, so it's the shortest path to your own:

1. `cp -R examples/systems/starter ~/.teller-next/systems/mygame`, and
   change `id` and `name` in `system.json`. (Two systems may not share
   a `sys_` id; the folder name is not the identity.)
2. Add records to `system.json` — `sheets` (what a new entity starts
   with), `statuses`, `dice`, `pins`, `dials`, `vocabulary`. They're
   read and edited together, which is why they live inline in one file.
   The only reserved keys are `id`, `name` and `version`.
3. Restate a panel by keeping its `name` and changing the blocks. A
   system's `sheet` beats teller's floor; a pack's beats the system's;
   the table's `panels/` beats them all — precedence comes from the
   merge, never from how much you wrote.
4. Only if you want a face teller doesn't ship: add
   `presentations/<Name>.tsx`, where the filename is the name a `dials`
   or `pins` record summons. That's the rung where trust starts
   mattering, and it's the last rung, not the first.

## Rights

Zero IP, by construction — no prose, no art, no book's words, nothing
anyone but teller wrote. Mechanics aren't protectable expression and
there are barely any here anyway, so this system is freely
distributable by anybody, which is exactly the property §M-2 wanted a
system to have.
