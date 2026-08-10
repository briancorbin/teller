// The marker palette.
//
// It lives on the worker side because both ends need it now: the scene
// editor colours a token you place by hand, and deploying a prepared
// fight colours one per foe. Two copies would drift, and a foe whose
// colour changed between prep and deploy is a foe you can't find on the
// table mid-fight.

/** Marker token palette. */
export const TOKEN_COLORS = [
  '#dc2626',
  '#d97706',
  '#65a30d',
  '#0d9488',
  '#2563eb',
  '#9333ea',
  '#db2777',
  '#57534e',
];

/** Nth marker's colour, wrapping — stable for a given index. */
export function tokenColor(index: number): string {
  return TOKEN_COLORS[index % TOKEN_COLORS.length];
}
