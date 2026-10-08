# Third-party code and data

Only permissive licences. Each dependency is pinned to an exact version. A vendored copy keeps its licence file
next to it.

## web3 (`web3/`, `server/routes/web3.mjs`, `commands/web3.mjs`, `mcp/tools/web3.mjs`, `studio/tabs/{token,shop}.js`)

The Solana layer has **no runtime npm dependencies**. Its Solana code is written in the kit's own plain ES modules,
in `web3/gf-web3/chain/`. That covers base58, SHA-256, the ed25519 curve check, PDAs, Borsh, legacy and v0
transactions, the loot program, Metaplex Core, the Meteora DBC launch instructions and mint parsing. Node's own
`node:crypto` provides ed25519 and SHA-384. The kit adopts nothing from `@solana/web3.js`, which pulls in
`rpc-websockets` (LGPL-3.0-only).

| What | Where it is used | Licence | How |
| --- | --- | --- | --- |
| games.fun loot program IDL (program `FWVap91D…f53D`) | `web3/gf-web3/chain/loot-idl.js` | games.fun's own | Copied from games.fun `launchpad/loot/client/idl.json` at commit `111d4f926be7ab62dce6e5f7344e23ac6afe2adc`, with doc comments removed |
| Meteora Dynamic Bonding Curve IDL facts (instruction discriminators, account orders, `PoolConfig`/`VirtualPool` field offsets, program version 0.2.1) | `web3/gf-web3/chain/dbc.js` | MIT, per the `license` field of `@meteora-ag/dynamic-bonding-curve-sdk` 1.5.12. The npm package ships no LICENSE file. | Read from the IDL inside that SDK. The kit does not copy the SDK's code. The kit's builders are checked against the SDK's output through golden fixtures. |
| ANS-104 data items | `web3/node/irys.mjs` | Specification (ArweaveTeam/arweave-standards) | Implemented from the specification. The output is checked against `@irys/bundles` 0.0.5 (Apache-2.0) through golden fixtures. That package is not a dependency. |

### Test-only (not installed with the kit)

`tests/web3/fixtures/generate.mjs` regenerates `tests/web3/fixtures/chain.json` from a separate reference install,
which is never part of the kit. That install holds `@solana/web3.js` 1.99.0 (MIT), `@solana/spl-token` 0.4.15
(Apache-2.0), `@meteora-ag/dynamic-bonding-curve-sdk` 1.5.12 (MIT), `@irys/bundles` 0.0.5 (Apache-2.0),
`bn.js` 5.2.5 (MIT) and games.fun's own loot client. The fixture file holds the outputs and public devnet account
bytes. It holds no code.
