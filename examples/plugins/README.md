# Example plugins

teller ships with **zero** plugins, on purpose — none required, none
given by default. These folders are examples you install yourself:

```
cp -r examples/plugins/assistant ~/.teller-next/plugins/assistant
node server/index.ts --data ~/.teller-next --plugins            # see it discovered
node server/index.ts --data ~/.teller-next --enable <plg_id>    # trust it — a human act
node server/index.ts --data ~/.teller-next --configure <plg_id> --config '{"key":"…"}'
```

The assistant can also ride a Claude subscription instead of a metered
key: `--config '{"use":"cli","model":"sonnet"}'` shells out to a
logged-in Claude Code CLI (`npm i -g @anthropic-ai/claude-code`, run
`claude` once to /login). No key ever touches the shelf in that mode.
```


The sweep only ever DISCOVERS what's in `<data>/plugins/` — it cannot
enable anything (docs/CORE-NEXT.md §15). Enablement and config live on
the shelf, written only by you.
