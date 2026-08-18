# Example plugins

teller ships with **zero** plugins, on purpose — none required, none
given by default. These folders are examples you install yourself:

```
cp -r examples/plugins/assistant ~/.teller-next/plugins/assistant
node server/index.ts --data ~/.teller-next --plugins            # see it discovered
node server/index.ts --data ~/.teller-next --enable <plg_id>    # trust it — a human act
node server/index.ts --data ~/.teller-next --configure <plg_id> --config '{"key":"…"}'
```

The sweep only ever DISCOVERS what's in `<data>/plugins/` — it cannot
enable anything (docs/CORE-NEXT.md §15). Enablement and config live on
the shelf, written only by you.
