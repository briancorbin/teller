// Short-lived permission slips, for the things that can't send a header.
//
// Two places need this. A PDF viewer is an `<iframe>`, and an SSE stream
// is an `EventSource` — neither can carry a key, and neither can be
// fetched into memory first without throwing away the reason it exists
// (ranged reads for one, streaming for the other).
//
// So: an HMAC over what's being opened and when it stops working, signed
// with the one secret (rule 7). Nothing is stored, so nothing has to be
// cleaned up or replicated; a ticket is useless for anything but its own
// subject; and it dies on its own. A URL that leaks into someone's
// history buys them one book, or one campaign's initiative list, until
// it expires.
//
// This is NOT a second secret. It's the same key, proving it signed
// something — authority still comes from the key or from an assignment,
// exactly as rule 7 says.

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function sign(secret: string, subject: string, expires: number): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    new TextEncoder().encode(`${subject}.${expires}`),
  );
  return [...new Uint8Array(signature)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

/** `subject` is what the ticket opens — a book id, a campaign id. */
export async function mintTicket(
  secret: string,
  subject: string,
  minutes: number,
): Promise<string> {
  const expires = Date.now() + minutes * 60_000;
  return `${expires}.${await sign(secret, subject, expires)}`;
}

export async function checkTicket(
  secret: string | undefined,
  subject: string,
  ticket: string | null,
): Promise<boolean> {
  if (!secret) return false;
  const [expires, presented] = (ticket ?? '').split('.');
  if (!expires || !presented) return false;
  if (!Number(expires) || Number(expires) < Date.now()) return false;
  // Signed over the expiry that was PRESENTED — signing a fresh one
  // would compare two different messages and never match.
  return (await sign(secret, subject, Number(expires))) === presented;
}

/** An hour is plenty to read a rulebook and short enough to not matter. */
export const BOOK_MINUTES = 60;

/**
 * A session's worth. Long, because an EventSource reconnects on its own
 * and a ticket that dies mid-game would take the table's screens with
 * it — the client re-tickets on failure, but this shouldn't be the
 * common path.
 */
export const STREAM_MINUTES = 12 * 60;
