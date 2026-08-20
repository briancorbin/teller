// Coin arithmetic, client-side — the counter's proposals, recomputed
// while the DM is still typing.
//
// The AUTHORITATIVE copy of all of this is `server/store-flow.ts`, and
// it stays the authority: the shelf, the totals and the proposal the
// console opens with are all the server's answers. This is the same
// arithmetic mirrored the way `api.ts`'s payload types are mirrored,
// and for the same reason — the server module is not part of the
// client's graph, and a round-trip per keystroke to re-propose change
// for a haggled price would be a worse answer than twenty duplicated
// lines.
//
// Integer minor units throughout. Floats drift and money is the one
// place nobody forgives it.

/** "$4.50" → 450. Anything that isn't a price → null. */
export function parsePrice(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = value.replace(/,/g, '').match(/(\d+)(?:\.(\d{1,2}))?/);
  return m ? Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0')) : null;
}

/** 450 → "$4.50". */
export function formatPrice(cents: number, symbol = '$'): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${symbol}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export type Denomination = { name: string; value: number; held: number };

/**
 * Pay a price out of the purse the way a hand does it at a counter:
 * exact coins first, largest down; otherwise the smallest overpayment
 * the pouch can make, with the change back in the biggest coins that
 * fit. Null when the purse can't cover it — a ruling for the DM, never
 * a refusal from the arithmetic.
 */
export function makePayment(
  purse: Denomination[],
  price: number,
): { counts: Record<string, number>; paid: number; change: number } | null {
  const sorted = [...purse].sort((a, b) => b.value - a.value);
  if (sorted.reduce((s, d) => s + d.held * d.value, 0) < price) return null;

  const counts: Record<string, number> = {};
  let remaining = price;
  for (const d of sorted) {
    const take = Math.min(Math.floor(remaining / d.value), d.held);
    counts[d.name] = d.held - take;
    remaining -= take * d.value;
  }
  let paid = price - remaining;
  if (remaining <= 0) return { counts, paid, change: 0 };

  for (const d of [...sorted].reverse()) {
    while (remaining > 0 && counts[d.name] > 0) {
      counts[d.name] -= 1;
      remaining -= d.value;
      paid += d.value;
    }
    if (remaining <= 0) break;
  }
  let change = -remaining;
  for (const d of sorted) {
    const back = Math.floor(change / d.value);
    counts[d.name] = (counts[d.name] ?? 0) + back;
    change -= back * d.value;
  }
  return { counts, paid, change: -remaining };
}
