// The assistant — teller's first plugin, and deliberately NOT a
// builtin: teller ships with zero plugins, and this folder is an
// EXAMPLE you install by copying it to `<data>/plugins/assistant/` and
// enabling it yourself (`node server/index.ts --enable <id>`). No
// config, no button — never a nag.
//
// Config (set with `--configure <id> --config '<json>'`), two modes:
//
//   API — { "key": "sk-…", "model": "claude-sonnet-5", "url": "…", "style": "…" }
//     `key` required; `url` defaults to the Anthropic Messages API.
//     Pay-per-token.
//
//   CLI — { "use": "cli", "model": "sonnet", "command": "claude", "style": "…" }
//     Shells out to the Claude Code CLI in headless mode (`claude -p`),
//     which rides the machine owner's existing Claude subscription —
//     no metered key at all. Requires the CLI installed and logged in
//     (`npm i -g @anthropic-ai/claude-code`, then run `claude` once
//     and /login). Tools are disabled for the call; it's a pure
//     text-in, JSON-out question.
//
// Neither configured — every call quietly proposes nothing.
//
// Both provides are PROPOSERS (registry contract): a snapshot in,
// words out, and playing any of it is the DM's act. `premises` is the
// honesty mechanism — every assumption the suggestion leans on gets
// surfaced for the DM to check at a glance, because the snapshot is
// only as fresh as the last thing somebody typed.

import { execFile } from 'node:child_process';

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

/** Bare JSON out of whatever the model wrapped it in. */
function parseProposal(text) {
  const raw = String(text)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  return JSON.parse(raw);
}

/** The subscription road: `claude -p`, no key, no meter. */
function askCli(config, system, user) {
  return new Promise((resolvePromise, reject) => {
    const args = [
      '-p',
      '--output-format', 'json',
      '--append-system-prompt', system,
      '--disallowedTools', '*',
    ];
    if (config.model) args.push('--model', String(config.model));
    const child = execFile(
      String(config.command || 'claude'),
      args,
      { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        // The CLI writes its JSON envelope even when it exits non-zero
        // ("Not logged in") — its own words beat the exec error's noise.
        let envelope;
        try {
          envelope = JSON.parse(stdout);
        } catch {
          envelope = undefined;
        }
        if (envelope?.is_error || (err && envelope)) {
          return reject(new Error(`claude cli: ${String(envelope.result ?? 'error').slice(0, 200)}`));
        }
        if (err) return reject(new Error(`claude cli: ${String(err.message).slice(0, 200)}`));
        try {
          resolvePromise(parseProposal(envelope?.result ?? ''));
        } catch (parseErr) {
          reject(new Error(`claude cli returned non-JSON: ${String(parseErr)}`));
        }
      },
    );
    child.stdin.end(user);
  });
}

async function ask(config, system, user) {
  if (config?.use === 'cli') return askCli(config, system, user);
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
  return parseProposal(text);
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
