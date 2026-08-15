# Shipping `teller` through Homebrew

The install anyone else gets:

```sh
brew install teller-ink/tap/teller
teller host
```

That needs a **tap** — a second GitHub repo named `homebrew-tap` — and
a release tarball for the formula to point at. Neither exists yet; this
is the recipe.

## One-time: create the tap

A tap is just a repo with a `Formula/` directory. The name matters:
Homebrew maps `teller-ink/tap` to `github.com/teller-ink/homebrew-tap`.

```sh
gh repo create teller-ink/homebrew-tap --public \
  --description "Homebrew formula for teller"
git clone git@github.com:teller-ink/homebrew-tap.git
mkdir -p homebrew-tap/Formula
cp homebrew/teller.rb homebrew-tap/Formula/teller.rb
```

It can live in this repo instead, but a separate tap keeps release churn
out of the project's history — the formula changes on every version, and
nothing else does.

## Every release

```sh
pnpm pack
```

Builds the app and writes `build/teller-<version>.tar.gz`, then prints the
`url` and `sha256` lines to paste into the formula. What's inside is only
the built app, the migrations, the host and a stripped `package.json` —
**no `node_modules`**, because the host imports nothing but node builtins.
That's why the formula is fifteen lines and why a Node upgrade can't break
an installed copy.

Then:

```sh
gh release create v0.1.0 build/teller-0.1.0.tar.gz --title "teller 0.1.0"
# paste the printed url + sha256 into Formula/teller.rb, commit, push
```

## Check it before anyone else does

```sh
brew install --build-from-source ./homebrew/teller.rb
brew test teller
brew audit --strict --new teller
teller host
```

`brew audit --new` is the one that catches what a first-time formula gets
wrong. Run it before publishing, not after.

## Notes

- **Node 22 is the floor.** teller keeps its database in node's own
  SQLite (`node:sqlite`), which doesn't exist before that. The CLI checks
  at startup and says so in a sentence rather than a stack trace.
- **The shim runs Homebrew's node explicitly**, not whatever `node` is
  first on `PATH`. On a developer's machine that's frequently an nvm
  shim pointing at something ancient.
- **Homebrew core is not the goal yet.** Core requires notability, and a
  tap is the normal home for a project this age. `brew install
  teller-ink/tap/teller` is one line either way.
- Linux works the same; nothing here is macOS-specific.
