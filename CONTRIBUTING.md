# Contributing

Thanks for helping. This repository is MIT licensed (see [LICENSE](LICENSE) and [docs/LICENSING.md](docs/LICENSING.md)); it is private for now, and contributions are by invitation. What you contribute is under the same licence. The people and projects the kit builds on are in [CREDITS.md](CREDITS.md).

- **Read first:** `docs/ARCHITECTURE.md` (layout, seams, ownership) and `docs/DEVELOPING.md` (tests, kit sync, examples).
- **Never edit `kits/`.** It is a snapshot of games.fun's kits. Fix a kit in games.fun, then
  `node scripts/sync-kits.mjs`. If a kit tool can't run here as shipped, shim it in `lib/` and list it in
  `docs/DEVELOPING.md` under "Upstream fixes".
- **Seams are contracts.** Commands, MCP tools, dev-server routes and studio tabs plug in by dropping a file in
  `commands/`, `mcp/tools/`, `server/routes/` or `studio/tabs/`. Additive changes are fine; changing a contract needs
  agreement first.
- **Cross-platform.** Windows, macOS and Linux with Node 24: no shell scripts or `shell: true`, no symlinks, paths with
  `node:path`. Add a test with `path.win32` for anything path-shaped.
- **Skills:** edit `skills/<name>/SKILL.md`, then `node scripts/sync-skills.mjs`. Never edit the mirrors.
- **Dependencies:** permissive licences only, pinned exactly, listed in `THIRD_PARTY.md`.
- **Secrets:** never commit `.env`, keys or keypairs (`.gitignore` covers the usual names). Meshy keys and wallets
  belong to the person using the kit.
- **Before a pull request:** `npm test`; for anything touching create, verify, the server or the kits,
  `GAMESFUN_SMOKE=1 npm test` too.
- Commit messages say what changed and why, in plain words.
