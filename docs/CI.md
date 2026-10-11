# CI: what runs on a GitHub runner, and what cannot

Status: written 2026-10-10, updated 2026-10-11 for `verify --profile`, the scenic job and stepped time. **Never run on GitHub** (Actions are off for this repository on purpose, gate G1). Every
number below was measured on one Linux machine, except where it says estimate.

## 1. The runners have no graphics card

`ubuntu-latest`, `windows-latest` and `macos-latest` have no GPU. Chrome (all three images carry Google Chrome;
`CHROME_PATH` is set per system in the workflow) draws WebGL with SwiftShader, on the CPU. The workflow sets
`GF_VERIFY_SOFTWARE=1`, which makes verify launch Chrome without graphics flags.

### Measured 2026-10-10 (before `--profile`): `create --from soak-squad`, `verify --quick`, software rendering

Machine: Linux, Chrome 148, Node 24.19.0, `taskset -c 0-3` (4 CPUs), GPU forced off in the browser, under
`flock ~/.cache/gf-gpu.lock`. Caveat: the 24-core host was busy with other agents (load average 15 to 20 throughout), so
the 4 CPUs were shared and these numbers are worse than a dedicated 4-vCPU runner. Two full runs, same result.

| Check | Result | Seconds |
|---|---|---|
| 1 manifests | pass | under 1 |
| 2 kit copies unedited | pass | under 1 |
| 11 set dressing | pass | under 1 |
| 14 looks honoured | pass | under 1 |
| 17 world complete | pass | under 1 |
| 5 two-player gate, lobby legs (manifest, kit identical, entry, solo untouched, shell boots, host opens room, joiner joins over WebRTC, both games ready) | pass (12 of 24 sub-checks passed in all; the lobby ones are among them, the rest of the gate failed below) | within the gate's 315 |
| 5 gate, in-round legs (everyone starts together, one host, results, replay, reload) and the loadout leg | fail: the round never starts | gate 315, loadouts 1185 (timed out) |
| 3 boots to play, no console errors | cannot run: the round never starts | 39 then timed out |
| 4 slot coverage, 6 round to results, 7 audio, 8 swap proof, 10 fair play, 12 something happens, 13 controls, 15 loop alive, 16 hits | cannot run (same cause) | - |
| 9 contact sheet and perf | skipped by `--quick` | - |

Whole `verify --quick` (no profile; the kits were 70bfafac7): **1500 s and FAIL 5 of 16 (skipped 1)**, then killed. The cause, probed directly: the game shell
page renders at **1.6 frames per second** under SwiftShader on those 4 CPUs, so a round (which the checks wait for with
timeouts of 60 s and less) never reaches play. The kit's own comment in `verify.mjs` records the same effect at about
4 fps on an earlier machine ("Studio v2 T1 run 4"). A dedicated runner may do better; that is unmeasured, and the first
run on a real runner (after G1) should decide it. Until then the profile assumes it cannot.

Not tried: the three-vCPU macOS image and the two-vCPU Windows image, a smaller viewport, or the kit's staged moments
(`?gf-demo=`) as a way to reach play sooner. The last is the likeliest way to get more checks onto a runner; it is
an edit to the kit's tools (M1-A, M2-D), not to this workflow.

## 2. Scenic games

Read from the kit's tools (`research/gf-three/tools/lib/paths.mjs`, `launchForGame`; `research/foundations/qa/browser.mjs`):

- A scenic game draws with three's `WebGPURenderer`. Verify normally launches Chrome's headless shell with Vulkan flags
  and requires a **hardware** WebGPU adapter; SwiftShader's fallback adapter counts as none (`NoWebGPUError`).
- On a runner there is no adapter, so `launchForGame` falls back to WebGL2 inside `WebGPURenderer` and notes it. With
  `GF_VERIFY_SOFTWARE=1` it skips the WebGPU probe and launches plain Chrome (no WebGPU, so the same WebGL2 backend),
  on SwiftShader.
- The headless shell the probe wants comes from `npx playwright install chromium-headless-shell`, which a runner does
  not have. If the shell is missing and software mode is off, `launchChrome` throws something other than
  `NoWebGPUError` and the fallback does not trigger. The profile sets software mode, so it avoids that path.
- A look judged from a software frame is meaningless: scenic CI checks behaviour, never looks.

The workflow's `scenic` job creates `isle-run` and runs the same profile as the party job. Measured below (section 3):
the scenic game's lobby legs pass under software rendering just as the party game's do.

## 3. The CI profile: `ci-software`

`.github/ci-profile.json` is the file `gamesfun verify --quick --profile .github/ci-profile.json` reads (the kit's
`verify.mjs`; the shape is held by `checkProfile` in `tools/lib/verdict.mjs`, and `tests/ci.test.mjs` checks the file
against it). It sets `GF_VERIFY_SOFTWARE=1` before any browser starts and lists the checks left out, each with its
reason. Everything else a build's verify runs, runs. A skipped check is recorded in `verdict.json` as skipped with its
reason, never as passed; the verdict carries `profile` and `profilePass`, `pass` stays false, and the command prints
`PROFILE ci-software OK (not a full pass)` and exits 0 when everything that ran passed. `"legs": "lobby"` on check 5
runs the gate's lobby legs only (room, WebRTC, both games in the room) and records the check as skipped.

Runs (2026-10-11, Linux, Chrome 148, Node 24.19.0, `GF_VERIFY_SOFTWARE=1`, `taskset -c 0-3`; the host was busy, load
average about 22), the workflow's own commands in order:

| Step | Party (`soak-squad`) | Scenic (`isle-run`) |
|---|---|---|
| `create games/ci --from <example>` | 1 s | 1 s |
| `verify --quick --profile .github/ci-profile.json` | PROFILE OK, 9 checks ran and passed, 15 skipped, 7 s | same, 7 s |
| checks that ran | 1, 2, 11, 14, 17, 18, 19, 23, 35, and check 5's lobby legs (gate pass 8 of 8) | the same |
| `doctor --skip-graphics` | ready, under 1 s | (same machine) |

Skipped, with the reason written in the profile: 3 boots to play, 4 slot coverage, 5 in-round and loadout legs, 6 a round
to results, 7 audio of the solo round, 10 fair play, 12 something happens, 13 controls, 15 the loop is alive, 16 hits,
20 the menu, 21 the HUD, 22 the wallet in the menu, 24 plays inside a post, 25 friends. They all play a running game, and
a software-rendered page draws about 1.6 frames a second. 8, 31 and 34 are release-only and not in `--quick`.

### Stepped time does not bring 13 or 16 inside five minutes

Since stepped time (`?gf-step=1`, `kit/core/step.js`) checks 10, 13, 16 and 35 count in the game's own time. Tried alone
under the same software rendering with a 300 s limit, each twice:

| Check | Party (`soak-squad`) | Scenic (`isle-run`) |
|---|---|---|
| 13 controls work | 2 of 2 not finished in 300 s: jump and interact pass, the run step is cut off (the page is closed by the limit) | 2 of 2 not finished in 300 s |
| 16 hits read | passes in 1 s, both times, because the game has no weapon (not applicable): proves nothing | 2 of 2 not finished in 300 s: 0 swings reached an enemy |

So neither goes in the profile. Stepped time moves the game's clock; the page still draws at a few frames a second, and
the checks wait for frames.

## 4. What the workflow runs

Per job (party, scenic), on Ubuntu and Windows for pull requests and on macOS as well for pushes to `main` and
`workflow_dispatch` (the matrix is chosen by an expression on `github.event_name`): `npm ci`; party only: `npm test`, the skills
mirror check, `doctor --skip-graphics`, `examples`, `catalog --all`; then `create` and
`verify --quick --profile .github/ci-profile.json`, and the evidence uploaded. The verify step is a hard failure on
Ubuntu; on Windows and macOS it is `continue-on-error` until a first run there says whether it holds.
`sync-kits --check` is not a runner step: it compares `kits/` with a games.fun checkout, which a runner does not have.
`tests/kits.test.mjs` (inside `npm test`) holds `kits/` to its recorded hashes on every system.
The workflow was parsed as YAML and checked with `npx @action-validator/cli .github/workflows/check.yml` (exit 0; the
same command exits 1 on a deliberately bad file).

## 5. Cost of a run (estimate, to decide G1)

Source: GitHub docs "Actions runner pricing" and "GitHub Actions billing" (docs.github.com/en/billing), read
2026-10-10. The pages list dollar rates per minute for private repositories, not multipliers; the ratios to Linux
($0.006) are Windows 2-core $0.010 (1.67x) and macOS 3 or 4-core $0.062 (10.3x). GitHub's long-standing included-minutes
multipliers are Linux 1, Windows 2, macOS 10 (from memory; the pages fetched did not repeat them). Each job rounds up
to a whole minute. Free plan: 2000 minutes a month, Pro and Team: 3000. Public repositories are free.

Job wall-time estimates (not measured on GitHub): checkout, Node and the npm cache about 0.5 to 1 min, `npm ci` about
0.5 min (two small dependencies), tests 6 s, the rest seconds. Windows is slower to start and to `npm ci`.

| System | Wall minutes per run (party job) | Multiplier (included minutes) | Billed plan minutes | Dollars at the rate |
|---|---|---|---|---|
| Linux | 2 to 3 | 1 | 3 | 0.018 |
| Windows | 4 to 5 | 2 | 10 | 0.050 |
| macOS | 3 to 4 | 10 | 40 | 0.248 |
| **One run, all three** | | | **about 53** | **about $0.32** |

On the Free plan that is about 37 runs a month inside the included minutes; macOS is three quarters of it. The scenic
job adds a little more (the profile run is 7 s). macOS therefore runs only on pushes to `main` and `workflow_dispatch`, not on pull requests. The verify step's 12
minute limit bounds a hang.

## 6. Risks on Windows and macOS runners, ranked

Nothing of ours has run on either. Expected, most likely first:

1. **Windows: the tools' start-up guard.** 8 files compare `import.meta.url` with `argv[1]` in a form that breaks on
   `C:\` paths and 29 in another (M1-A item). A tool run directly may do nothing and exit 0. Silent. (From the handoff; not
   tested here.)
2. **Windows: line endings in `kits/`.** `.gitattributes` marks `kits/** -text`, but the `* text=auto eol=lf`
   line comes first and `core.autocrlf` on the runner can still convert; check 2 and `kits.test.mjs` compare hashes.
3. **Windows: paths and processes.** Paths over 260 characters under `kits/` plus the checkout dir, a `spawn` of
   `npx` or `.cmd` without a shell (needs `npx.cmd`), and killing a process tree (`SIGTERM` on Windows does not kill
   children), which leaves Chrome and the dev server running and the job hanging until its timeout.
4. **Windows and macOS: Chrome discovery.** `CHROME_PATH` is set in the matrix, but the Chrome versions on the images
   move; a Chrome newer than Playwright 1.63 may refuse some flags. macOS's Chrome path has a space.
5. **macOS: Gatekeeper and permission prompts** are not a problem for a preinstalled Chrome in headless, but a
   Playwright-downloaded Chromium could be quarantined. Local network access prompts for the WebRTC gate (loopback)
   are not expected on a runner.
6. **macOS and Windows: the gate's WebRTC over loopback** with the runners' virtual network adapters: ICE can
   pick an address that does not route. Watch check 5's lobby legs first.
7. **Tests that assume POSIX:** the `npm test` suites (about 220 tests, 2 skipped on Linux) may include path assertions (not read); any
   `\` versus `/` difference shows as a failure in `paths.test.mjs`, `kits.test.mjs`, `seams.test.mjs`.
8. **Slow runners:** a 3-vCPU macOS image under SwiftShader will be no better than section 1's 1.6 fps; the profile
   already leaves those checks out.

Items 1 to 3 are the ones to read first in the first red run.
