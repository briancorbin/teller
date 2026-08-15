# teller — Homebrew formula.
#
# Copy this into a tap repo (teller-ink/homebrew-tap) as
# Formula/teller.rb, and update `url` and `sha256` from `pnpm pack` on
# each release. See homebrew/README.md.
#
# It's short because the host has no dependencies: every import is a node
# builtin, so there is nothing to npm-install, nothing to compile, and no
# native module to break when Node updates. Keep it that way.
class Teller < Formula
  desc "In-person TTRPG companion — the table plays, teller keeps the books"
  homepage "https://teller.ink"
  url "https://github.com/teller-ink/teller/releases/download/v0.1.0/teller-0.1.0.tar.gz"
  sha256 "ffa5b1fe0e1132cd4ec80a7f6d44050241838ca809cd0de7d637ebb9cf3e18a2"
  license "AGPL-3.0-only"

  # Node 22 is the floor: teller keeps its database in node's own SQLite
  # (`node:sqlite`), which doesn't exist before that.
  depends_on "node"

  def install
    libexec.install Dir["*"]
    # An explicit shim rather than a symlink, so the command always runs
    # under Homebrew's node — not whatever `node` happens to be first on
    # a user's PATH, which on a developer's machine is anyone's guess.
    (bin/"teller").write <<~SH
      #!/bin/bash
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/bin/teller" "$@"
    SH
    chmod 0755, bin/"teller"
  end

  def caveats
    <<~EOS
      Start your table with:
        teller host

      Campaigns live in ~/.teller — or point it somewhere you can carry:
        teller host /Volumes/YOUR-CARD

      The warden key is generated on first run and printed at startup.
      Show it again with: teller key
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/teller version")
    assert_match "teller keeps the books", shell_output("#{bin}/teller help")
    # `where` must answer without creating anything — it's the one command
    # safe to run before you've decided where your campaigns should live.
    assert_match ".teller", shell_output("#{bin}/teller where")
  end
end
