# CI: what runs on a GitHub runner, and what cannot

Status: written 2026-10-10, **never run on GitHub** (Actions are off for this repository on purpose, gate G1). Every
number below was measured on one Linux machine, except where it says estimate.

## 1. The runners have no graphics card

`ubuntu-latest`, `windows-latest` and `macos-latest` have no GPU. Chrome (all three images carry Google Chrome;
`CHROME_PATH` is set per system in the workflow) draws WebGL with SwiftShader, on the CPU. The workflow sets
`GF_VERIFY_SOFTWARE=1`, which makes verify launch Chrome without graphics flags.

### Measured: `create --from soak-squad`, `verify --quick`, software rendering

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
| 5 two-player gate, lobby legs (manifest, kit identical, entry, solo untouched, shell boots, host opens room, joiner joins over WebRTC, both games ready) | pass (8 of 24 sub-checks) | about 60 |
| 5 gate, in-round legs (everyone starts together, one host, results, replay, reload) and the loadout leg | fail: the round never starts | gate 315, loadouts 1185 (timed out) |
| 3 boots to play, no console errors | cannot run: the round never starts | 39 then timed out |
| 4 slot coverage, 6 round to results, 7 audio, 8 swap proof, 10 fair play, 12 something happens, 13 controls, 15 loop alive, 16 hits | cannot run (same cause) | - |
| 9 contact sheet and perf | skipped by `--quick` | - |

Whole `verify --quick`: **1500 s and FAIL 5 of 16 (skipped 1)**, then killed. The cause, probed directly: the game shell
page renders at **1.6 frames per second** under SwiftShader on those 4 CPUs, so a round (which the checks wait for with
timeouts of 60 s and less) never reaches play. The kit's own comment in `verify.mjs` records the same effect at about
4 fps on an earlier machine ("Studio v2 T1 run 4"). A dedicated runner may do better; that is unmeasured, and the first
run on a real runner (after G1) should decide it. Until then the profile assumes it cannot.

Not tried: the three-vCPU macOS image and the two-vCPU Windows image, a smaller viewport, or the kit's staged moments
(`?gf-demo=`) as a way to reach play sooner. The last is the likeliest way to get more checks onto a runner; it is
an edit to the kit's tools (M1-A, M2-D), not to this workflow.

## 2. Scenic games

The kit's snapshot has no scenic engine yet (M1-B). Read from games.fun main (`research/gf-three/tools/lib/paths.mjs`,
`launchForGame`; `research/foundations/qa/browser.mjs`):

- A scenic game draws with three's `WebGPURenderer`. Verify normally launches Chrome's headless shell with Vulkan flags
  and requires a **hardware** WebGPU adapter; SwiftShader's fallback adapter counts as none (`NoWebGPUError`).
- On a runner there is no adapter, so `launchForGame` falls back to WebGL2 inside `WebGPURenderer` and notes it. With
  `GF_VERIFY_SOFTWARE=1` it skips the WebGPU probe and launches plain Chrome (no WebGPU, so the same WebGL2 backend),
  on SwiftShader. A scenic game's frame is heavier than the party game's (TSL materials, bloom, depth of field,
  quality tiers), so it will be slower than 1.6 fps: expect the same static-only result.
- The headless shell the probe wants comes from `npx playwright install chromium-headless-shell`, which a runner does
  not have. If the shell is missing and software mode is off, `launchChrome` throws something other than
  `NoWebGPUError` and the fallback does not trigger. The workflow sets software mode, so it avoids that path; M1-B must
  keep it so.
- WebGPU on a runner is not available: none of the standard images exposes a GPU. A look judged from a software frame
  is meaningless (COMMON.md): scenic CI checks behaviour, never looks.

The workflow's `scenic` job is off until the repository variable `GF_SCENIC_EXAMPLE` names a scenic example.

## 3. The CI profile: `ci-software`

Data: `.github/ci-profile.json`. It lists the checks to run and each check left out with its reason. The workflow runs
them today as `verify --check 11,17` and `verify --check 14` (both exist in the kit), plus `npm test`, the skills
mirror check, `catalog` and `create`; check 1 and 2 run inside any full verify. The profile leaves out checks 3, 4, 5
(in-round and loadout legs), 6, 7, 8, 10, 12, 13, 15 and 16, all for one reason: they need a round running at a
playable frame rate. A skipped check is reported as skipped, with its reason, never as passed.

## 4. Request for M1-A's owner (verify is not edited here)

Add `--profile <path>` to `research/gf-three/tools/verify.mjs`, kit copy and games.fun main:

1. Read the JSON; set `process.env` from `environment` for the run (before any browser launch).
2. For each check in `skip`, record `ok: null` with detail `skipped by profile ci-software: <reason>`, and do not
   launch the solo session or the gate when nothing that needs them is left (check 5 partly: with the lobby legs only,
   add a gate option `legs: 'lobby'`; otherwise skip 5 whole).
3. Exit 0 when every check not skipped and REQUIRED in `verdict.mjs` passes; the verdict file stores `profile`
   (name) and the skipped list, so a profile pass can never be read as a full pass (`passes()` in `verdict.mjs` must
   return false for a profiled verdict where a REQUIRED check is skipped, and Studio must never accept one).
4. Also make `--check` accept `1,2` (today only `11,17` and single checks).

When that lands, set the repository variable `GF_VERIFY_PROFILE=1` to turn on the profile steps in the workflow. Without
it, verify ignores the unknown flag and runs the whole `--quick`, which never ends on a runner.

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
job, once on, adds about the same again. Cheaper: run macOS only on pushes to `main` and `workflow_dispatch`, not on
every pull request (a one-line `if:` on the matrix). If the profile steps ever hang, the 12 minute step limit costs 120
macOS minutes in one job: that is why they are off until `GF_VERIFY_PROFILE=1`.

## 6. Risks on Windows and macOS runners, ranked

Nothing of ours has run on either. Expected, most likely first:

1. **Windows: the tools' start-up guard.** 8 files compare `import.meta.url` with `argv[1]` in a form that breaks on
   `C:\` paths and 29 in another (M1-A item). The kit's `bin/` shims hide most, but a tool run directly does nothing
   and exits 0. Silent.
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
7. **Tests that assume POSIX:** the `npm test` suites (127 pass, 1 skipped on Linux) include path assertions; any
   `\` versus `/` difference shows as a failure in `paths.test.mjs`, `kits.test.mjs`, `seams.test.mjs`.
8. **Slow runners:** a 3-vCPU macOS image under SwiftShader will be no better than section 1's 1.6 fps; the profile
   already leaves those checks out.

Items 1 to 3 are the ones to read first in the first red run.
