// The assistant — teller's first plugin, and deliberately NOT a
// builtin: teller ships with zero plugins, and this folder is an
// EXAMPLE you install by copying it to `<data>/plugins/assistant/` and
// enabling it yourself (`node server/index.ts --enable <id>`). No
// config, no button — never a nag.
//
// Config (set with `--configure <id> --config '<json>'`):
//   { "key": "sk-…", "model": "claude-sonnet-5", "url": "…", "style": "laconic western" }
// `key` is required — without it every call quietly proposes nothing.
// `url` defaults to the Anthropic Messages API.
//
// Both provides are PROPOSERS (registry contract): a snapshot in,
// words out, and playing any of it is the DM's act. `premises` is the
// honesty mechanism — every assumption the suggestion leans on gets
// surfaced for the DM to check at a glance, because the snapshot is
// only as fresh as the last thing somebody typed.

const DEFAULT_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-5';

/** One entity's sheet, formatted — formatting is salience. */
function sheet(entity) {
  if (!entity) return '(nobody is acting)';
  const lines = [`# ${entity.name}${entity.type ? ` (${entity.type})` : ''}`];
  for (const [list, entries] of Object.entries(entity.lists ?? {})) {
    lines.push(`## ${list}`);
    for (const e of entries) {
      const value =
        e.value === undefined ? '' : e.max === undefined ? `: ${e.value}` : `: ${e.value}/${e.max}`;
      lines.push(`- ${e.name}${value}`);
    }
  }
  if (entity.notes) lines.push(`## notes\n${entity.notes}`);
  return lines.join('\n');
}

async function ask(config, system, user) {
  if (!config || typeof config.key !== 'string' || !config.key) return undefined;
  const res = await fetch(config.url || DEFAULT_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model || DEFAULT_MODEL,
      max_tokens: 1000,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`model endpoint said ${res.status}`);
  const data = await res.json();
  const text = Array.isArray(data.content)
    ? data.content.map((c) => c.text ?? '').join('')
    : '';
  // The model is asked for bare JSON; be forgiving about fences anyway.
  const raw = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  return JSON.parse(raw);
}

export const provides = {
  /** Snapshot: { round, order: [{name, score, acting}], acting: entity|null, style? } */
  'propose.turn': async (snapshot, config) => {
    const style = config?.style || snapshot?.style || '';
    const system = [
      'You propose ONE turn for the creature currently acting in a tabletop fight.',
      'You decide nothing: the human at the table plays or ignores your words.',
      'State every assumption you rely on as a premise — the snapshot may be stale.',
      'Reply with bare JSON, no fences: {"premises": string[], "action": string, "rationale": string, "roll"?: {"dice": string, "for": string}}',
      'Use ONLY facts present in the snapshot; if a fact is missing, say so in premises rather than inventing it.',
      style ? `Voice: ${style}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const user = [
      `Round ${snapshot?.round ?? 1}. Turn order (top acts first):`,
      ...(snapshot?.order ?? []).map(
        (e) => `${e.acting ? '>> ' : '   '}${e.name}${typeof e.score === 'number' ? ` (rolled ${e.score})` : ''}`,
      ),
      '',
      'The acting creature, as its sheet reads right now:',
      sheet(snapshot?.acting),
    ].join('\n');
    return ask(config, system, user);
  },

  /** Snapshot: whatever the DM says happened — { outcome: string, style? } */
  'propose.narrate': async (snapshot, config) => {
    const style = config?.style || snapshot?.style || '';
    const system = [
      'You offer two or three sentences of table narration for an outcome the DM reports.',
      'The DM may read, edit, or ignore them. Never add mechanical effects.',
      'Reply with bare JSON, no fences: {"narration": string}',
      style ? `Voice: ${style}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    return ask(config, system, `What happened: ${String(snapshot?.outcome ?? '')}`);
  },
};
