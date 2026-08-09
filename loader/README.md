# the loader

A small program that hands local books to a teller screen.

```sh
pnpm loader                    # serve ~/teller, plus any card you plug in
pnpm loader ~/rpg/rulebooks    # or point it wherever your books are
```

Then open teller. The Rulebooks panel notices it within a few seconds.

## Why this exists

A browser can't read a drive, and an HTTPS page can't reach a machine
across the LAN — a page served over TLS is only allowed to talk to plain
HTTP when the other end is **loopback**, which the browser trusts because
nothing outside the machine can answer there.

So this is the shape the web leaves us: a program on the same machine,
listening on `127.0.0.1`, serving files to the teller screen in front of
you. The constraint is also the promise — the loader binds loopback and
nothing else, so your books are readable by this machine and by nobody on
the network. Same promise books already make in teller: the index is the
server's, the PDF is yours.

## What a library is

Any directory with PDFs in it. That covers the evocative case — a card you
carry to someone else's table, plug into their panel, and your books are
there — and the ordinary one, which is a folder on your laptop. The loader
doesn't distinguish; removable media just gets found on its own.

Two postures, deliberately different:

- **A path you typed** is taken at its word. A folder of PDFs is a library.
  No layout to learn, no marker file to create.
- **A volume that merely appeared** needs a `teller/` directory before the
  loader will read it. Plugging in a USB stick must never mean teller went
  rummaging through it.

A card, then, is:

```
/Volumes/MY-CARD/
  teller/
    card.json          # optional: { "name": "Brian's WIW kit", "system": "wiw" }
    books/
      WIW-Guidebook.pdf
      .index/          # written by the loader; travels with the books
```

`books/` is optional too — PDFs directly under `teller/` work.

## What it does with them

**Reads them once.** On first sight of a PDF the loader extracts its page
text in the background (a 276-page rulebook takes about eight seconds) and
caches the index beside the books. If the card is read-only, the index
falls back to `~/.teller/index/`. A book you can't index is a book you
can't search, which is too high a price for a write-protected stick.

**Names them by their contents.** A book's id is the hash of its own
bytes, so the same card in a different panel names the same book, and two
people who own the same rulebook agree about it without coordinating.
Adding a book to search twice lands on one row instead of two.

**Serves them with range support**, which is what lets the browser's PDF
viewer page through a hundred-megabyte rulebook instead of swallowing it
whole. Opening a book from a library streams; opening an imported one has
to build a blob first.

Nothing is written to teller's server except page text, and only when you
ask for it — the `+ search` button. Reading a book needs no server at all.

## Endpoints

| | |
|---|---|
| `GET /manifest` | what's being served right now |
| `GET /books/:lib/:book.pdf` | the file, `Range`-capable |
| `GET /books/:lib/:book/index` | its page text |

CORS is granted to `https://teller.ink` and to localhost, so a dev server
and the real thing both work.

## On a panel

The Pi kiosks want this as a service. It's one file and node — no build,
no dependencies beyond the `pdfjs-dist` already in this repo, and that
only when a book needs reading.

```ini
# /etc/systemd/system/teller-loader.service
[Service]
ExecStart=/usr/bin/node /opt/teller/loader/teller-loader.mjs
Restart=always
User=teller

[Install]
WantedBy=multi-user.target
```

Cards mounted under `/media/<user>/` are found automatically, so a panel
with this running becomes a reader: plug your card in, your books are
there, take it with you when you leave.

## What does not go on a card

Live session state. Turn order, HP, what's on the table — those belong to
the campaign, are authoritative on the server, and a drive that thought
otherwise would invent a sync problem to solve. A card carries **identity
and content**: your books, and in time your character.
