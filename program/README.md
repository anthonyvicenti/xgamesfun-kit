# program/: the loot program's source (loot 0.3, "Economy for Anything")

Every economy the kit puts live runs on one Solana program: games.fun's **loot program 0.3**, deployed on devnet at
`88Labq6tdVnBQsjHSfic6qqgvo5b9NGmy99AYj7KVXqM`. This folder is its whole Rust source, published with the kit under the
kit's MIT licence (creator decision 4, 2026-10-11/12). Read `loot/PROGRAM-0.3.md` for what it does, `loot/programs/loot/src/lib.rs`
first in the code (every instruction, grouped, and the security model in its header), and `loot/COSTS.md` for what each
call costs.

Nothing here is needed to make a game: the kit talks to the deployed program through its own plain JavaScript client
(`web3/gf-web3/chain/loot.js`). The source is here so anyone can read what their game's money runs on, build it, check
that the build is byte for byte what is on devnet, and run its tests. The full simulation (`gamesfun economy simulate
--full`, `web3/economy/sim/`) can run a local build of it instead of the deployed bytes.

## Where it comes from

| | |
| --- | --- |
| Source | games.fun repository, `launchpad/loot/`, commit `66e896f97` (branch `agent/web3-official`). The program's files there are unchanged since commit `4c8ab0ff0`, the one that deployed it |
| Deployed | devnet, program `88Labq6tdVnBQsjHSfic6qqgvo5b9NGmy99AYj7KVXqM`, program data `EsY5ZQHgorqiWXjwgDyXs5CkF7YQsZWqiSEedc55V5jo`, 2026-10-11 (the creator: "You can deploy this current version") |
| Deployed file | 909,064 bytes, `sha256 7b91abf9698136f3f25a0103226f81106a26c66279b760e8337e973258b15450` (games.fun `launchpad/loot/devnet-deploy-0.3-result.json`, `soSha256`) |

What was copied: the Cargo workspace (`Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`, `Anchor.toml`), the program
(`programs/loot/`: `src/**` and its LiteSVM tests `tests/**`), the Token-2022 transfer hook the tests build
(`test-hook/`), the devnet account snapshots the tests read (`tests/fixtures/venue/`, `tests/fixtures/v1/`: public chain
data), `scripts/fetch-fixtures.sh`, and the documents `PROGRAM-0.3.md`, `COSTS.md` and `BUILD.md` (the last is the
reproducible-build record of 0.2; the 0.3 one is below).

What was left out: every key file (the program's keypair and the deployer's live outside any repository; an untracked
test keypair in the source worktree was not copied), `target/`, and the upstream binaries the tests load
(`tests/fixtures/*.so`, `queue.json`), which `scripts/fetch-fixtures.sh` dumps from devnet. One line changed:
`Anchor.toml`'s `wallet` pointed at games.fun's deployer key path and now names Solana's default
(`~/.config/solana/id.json`); it does not touch the build. Nothing in this folder deploys anything.

## Build it and check it against devnet

The toolchain: Rust 1.89.0 (`rust-toolchain.toml`), the Solana CLI 3.1.10 (its `cargo-build-sbf`, platform-tools v1.52),
optionally anchor-cli 1.1.2 (`anchor build` runs the same `cargo-build-sbf`) and `solana-verify` 0.5.2.

```bash
cd program/loot
cargo build-sbf --manifest-path programs/loot/Cargo.toml --sbf-out-dir target/deploy
sha256sum target/deploy/loot.so
# 7b91abf9698136f3f25a0103226f81106a26c66279b760e8337e973258b15450  (the deployed file)

# The same comparison with the chain itself (it ignores the zero padding behind the program in its account):
solana-verify get-executable-hash target/deploy/loot.so
solana-verify get-program-hash -u devnet 88Labq6tdVnBQsjHSfic6qqgvo5b9NGmy99AYj7KVXqM
# both: 037cac23a64cd1d2ab32edda79d3f41c5c9287c96863f887e9304a772a737e0f
```

**Result (2026-10-12, this folder in the kit, Linux x86-64):** `cargo build-sbf` (cargo-build-sbf 3.1.10, platform-tools
v1.52, rustc 1.89.0) built `loot.so` in 44 s; its sha256 is `7b91abf9…b15450`, the deployed file's, and
`solana-verify get-executable-hash` of it equals `get-program-hash` of the devnet program (`037cac23…737e0f`). The build
does not depend on the folder it runs in: games.fun's copy and this one give the same bytes. The Docker build
(`solana-verify build --library-name loot --base-image solanafoundation/solana-verifiable-build:3.1.10`, see `BUILD.md`)
was not run for 0.3; for 0.2 it gave the same file as the plain build.

To let the full simulation use your build instead of the deployed bytes: `gamesfun economy simulate --full
--program program/loot/target/deploy/loot.so` (it says so in its report, and says whether the build matches devnet).

## Run its tests

```bash
cd program/loot
scripts/fetch-fixtures.sh          # once: Metaplex Core, MagicBlock's VRF and its queue from devnet (read-only)
cargo test
```

The tests run the program in LiteSVM with the real Metaplex Core and MagicBlock VRF programs. The VRF oracle cannot run
there, so the tests send its callback themselves with the program's VRF identity as signer (signature checks off), the
same way the full simulation does.

## Licences

- This source: MIT, under the kit's `LICENSE` (games.fun's own code, same owner as the kit).
- Its dependencies keep their own licences (`THIRD_PARTY.md`, "The loot program's source"): anchor-lang and anchor-spl
  1.1.2 (Apache-2.0), MagicBlock's ephemeral-rollups-sdk and ephemeral-vrf-sdk 0.17.2 (MIT), solana-sha256-hasher 3.1.0
  (Apache-2.0); for the tests only: litesvm 0.10.0 (Apache-2.0), mpl-core 0.12.1 (the Metaplex NFT Open Source License),
  the solana-* crates and spl-token-2022-interface (Apache-2.0), borsh (MIT or Apache-2.0).
- Not in this folder: the Metaplex Core and MagicBlock VRF **programs** the tests and the full simulation load are
  dumped from devnet onto your own machine, never committed. MagicBlock's VRF program is under the Business Source
  License 1.1 (non-production use allowed; MIT from 2029-12-01); Metaplex Core under the Metaplex NFT Open Source License.
