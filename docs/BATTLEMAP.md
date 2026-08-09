# Battlemap design

Decided 2026-08-08 (Brian + design conversation; TEL-20). These
decisions are settled — reference, don't relitigate. The thesis still
governs: the table TV is the GROUND; physical minis and terrain are
the actors; everything here is presentation + bookkeeping.

## Coordinate spaces

Three spaces, three jobs — never mix them:

- **Map space** — positions of things ON the map (tokens, fog
  strokes): normalized image coordinates `u, v ∈ 0..1` of the source
  image. Resolution-independent (re-upload a higher-res map, nothing
  moves) and re-declaration-safe (fix `widthInches` later, tokens stay
  glued to the painted features they stand on).
- **Physical space** — SIZES in inches (token bases, grid squares).
  An inch is an inch on every display, via that display's calibrated
  ppi.
- **Glass space** — the viewport maps one onto the other.

## Scale: one fact per scene, one fact per display

- Scene: optional `widthInches` (the map's intended physical width —
  publishers state it; Boylei's are 36"). No value → fit-to-screen.
- Display: calibrated `ppi` (already shipped — the grid calibration).
- True scale factor = `ppi × widthInches / imageWidthPx`.

## Viewport

Per scene, remembered across switches:
`view: { mode: 'fit' | 'true', zoom: number, cu: number, cv: number }`
(`cu, cv` = map-space point at the viewport center; `zoom` multiplies
true scale — 1.0 is exact, 0.5 is half-scale overview).

**Physical minis pin the map.** Panning mid-combat slides the ground
out from under real minis, so framing is a between-moments tool.
Soft lock: while initiative is running, framing controls warn and ask
for confirmation — never hard-disabled (the human is the rules
engine; we don't build automation a human can't override).

Digital tokens live in map space and move with the map. Physical
minis live on glass and don't. The grid is glass-space and never
moves with the map.

## Fog: vector strokes, never bitmaps

Per scene: ordered list of
`{ mode: 'reveal' | 'hide', radiusInches: number, points: [u,v][] }`.
Table composites the mask; console shows fog ghosted (the Warden sees
everything). Strokes are JSON → they ride the blob schema, the event
log, and undo like every other mutation. PATCH on stroke end, not per
point. "Reset fog" clears the list.

## Tokens: deliberately dumb

Per scene:
`{ id, label, u, v, sizeInches, color, characterId? }`.
v1 renders colored discs + labels (images are v2). No vision, no
auras-as-data, no pathing — ever. `characterId` unlocks **reactive
tile effects**, which are pure render on the table client reading
state that already streams over SSE:

- amber pulse under whoever's turn it is
- wound tint when the linked character's first max-bearing counter
  crosses thresholds (convention: a sheet's first counter with a max
  is its vitality)
- tag-driven auras later

Effects work identically under a PHYSICAL mini: the token becomes the
ground marker the mini stands on (state is virtual, action is
physical).

## Where state lives

All additive on the scene entries in `campaign.data.maps` — no
migration: `{ id, key, name, widthInches?, view?, fog?, tokens? }`.
Console edits → campaign PATCH (whole `maps` array, like `counters`)
→ event log → SSE poke → table refetch. The active scene (and only
it) flows to `/public` with its view/fog/tokens — the scene LIBRARY
stays DM-only.

## Console surface

Tapping a scene opens a **fullscreen scene editor** (decided over
inline card editing): map preview with drag-to-pan framing, width
input, fit/true/zoom controls, and (later phases) token placement and
fog painting on the same surface.

## Build order (each independently shippable)

1. **Scale + viewport** — widthInches, fit/true/zoom, editor shell
   with framing (SHIPPED 2026-08-08)
2. **Tokens + reactive effects**
3. **Fog painting**
4. Effect polish (thresholds, auras, transitions)
5. Someday: the overhead camera proposes token positions (proposal
   only, as always)
