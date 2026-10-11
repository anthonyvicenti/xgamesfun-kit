# CI: what runs on a GitHub runner, and what cannot

Status: written 2026-10-10; **runs on GitHub since 2026-10-11** (Actions were turned on that day). The first run on
Linux, Windows and macOS was red on five of six jobs; section 7 has each fault, its cause and its fix, and section 8
what a person on a real Windows machine or a Mac still has to try by hand. Sections 1 to 3 keep the measurements made
on one Linux machine before the first run, with a note where a runner proved them wrong.

## 1. What the runners are

Read from the runs of 2026-10-11 (the workflow's "Runner facts" step and each gate record's `graphics`):

| Runner | Processors | Memory | Chrome | WebGL is drawn by |
|---|---|---|---|---|
| `ubuntu-latest` | 2 (AMD EPYC or Intel Xeon) | 7.8 GB | 154.0.8037.97 | SwiftShader, on the processor |
| `windows-latest` | 2 (AMD EPYC) | 8.0 GB | 154.0.8037.58 | SwiftShader, on the processor |
| `macos-latest` | 3 (Apple M1, virtual) | 7.0 GB | 152.0.7977.83 | "Apple Paravirtual device" through Metal: a virtual graphics card |

So Linux and Windows have no graphics card, and macOS has a virtual one. All three images carry Google Chrome; the
workflow names its path per system (`CHROME_PATH`). The workflow sets `GF_VERIFY_SOFTWARE=1`, which makes verify and,
since 2026-10-11, the multiplayer gate launch Chrome without graphics flags.

The estimate below was made with four processors; the runners have two, and a page that draws a game there answers a
click after 30 seconds (section 7, fault 4).

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

**The table below did not measure what it says.** It was taken before the first run on GitHub, on a machine with a
graphics card, and its 7 seconds were not software rendering: the gate ignored `GF_VERIFY_SOFTWARE` and launched Chrome
with the graphics-card flags, and on that machine those flags gave Chrome no WebGL at all, so the lobby's backdrop drew
nothing and the join was instant. The same steps failed on every Linux and Windows runner (section 7, faults 4 and 5).
Measured again on 2026-10-11 with the fixes, really on SwiftShader and on two processors (`taskset -c 0-1`): 7 s for
the party game and 9 s for the scenic one, PROFILE OK, the same nine checks.

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

Two jobs, `party` and `scenic`, each on Linux, Windows and macOS. Pull requests run Linux and Windows; pushes to `main`
run macOS as well. By hand, one system or one job runs alone:

```bash
gh workflow run check.yml --ref <branch>                               # every job on every system
gh workflow run check.yml --ref <branch> -f system=windows -f job=scenic
gh workflow run check.yml --ref <branch> -f system=linux-windows       # everything but macOS (a tenth of the cost)
```

`system` is `all`, `linux`, `windows`, `macos` or `linux-windows`; `job` is `all`, `party` or `scenic`. Runs started by
hand never cancel each other; a newer push cancels the run of an older one.

What each system runs, the same on all three (run 38155626989 and the three after it, 2026-10-11):

| Step | party job | scenic job |
|---|---|---|
| `npm ci`, runner facts (processors, memory, Chrome's version) | yes | yes |
| `npm test` (252 tests on 2026-10-11; 3 skip on every system: the smoke test, one per example) | yes | no |
| `sync-skills --check`, `doctor --skip-graphics`, `examples`, `catalog --all` | yes | no |
| `create` from the example | `soak-squad`, then `giant-four` (the turn-based board game, since 2026-10-11) | `isle-run` |
| `verify --quick --profile .github/ci-profile.json` | yes, once for each of the two games | yes |
| the evidence uploaded (`verdict.json`, the gate's `record.json` and its picture) | yes | yes |

Inside verify, on every system and for both games:

- **Run and passed:** 1 manifests, 2 kit copies unedited, 11 set dressing, 14 looks honoured, 17 the world is complete,
  18 sounds play, 19 bodies hold their shape, and check 5's lobby legs (the gate's `record.json`: manifest valid, kit
  identical, entry exists, solo untouched, shell boots, host opens a room, a joiner joins over WebRTC, no kit errors;
  8 of 8).
- **Run, with nothing to check in these two examples:** 23 looks like the references (the examples list no style
  references) and 35 the game's own tests (the examples carry none). Both report that, and count as passed.
- **Skipped by the profile, each recorded as skipped with its reason:** 3, 4, 5 (the in-round legs and the loadout leg),
  6, 7, 10, 12, 13, 15, 16, 20, 21, 22, 24, 25. They all play a running game.
- **Skipped by `--quick`:** 9 the contact sheet and perf. 8, 31 and 34 are release-only.

The verdict is never a full pass: it prints `PROFILE ci-software OK (not a full pass)` and exits 0 when everything
that ran passed. No step is `continue-on-error` (`tests/ci.test.mjs` holds that); a check that cannot run on a runner
leaves the profile by name, with its reason.

What the lobby legs do not cover on Linux and Windows: the lobby's backdrop (the game's world behind the waiting room).
The kit leaves it out on a machine that draws on its processor (section 7, fault 4), so there the legs run without
it. On macOS, with its virtual card, the backdrop is drawn and the legs pass with it.

`sync-kits --check` is not a runner step: it compares `kits/` with a games.fun checkout, which a runner does not have.
`tests/kits.test.mjs` (inside `npm test`) holds `kits/` to its recorded hashes on every system; it passed on Windows
from the first run, so the checkout converts no line ending in `kits/`.
The workflow is checked with `npx @action-validator/cli .github/workflows/check.yml`.

## 5. Cost of a run (measured 2026-10-11)

Rates, from GitHub's docs "Actions runner pricing" (read 2026-10-10): Linux $0.006 a minute, Windows 2-core $0.010,
macOS $0.062. The included-minutes multipliers are Linux 1, Windows 2, macOS 10. Each job rounds up to a whole minute.

Job wall time in the green runs:

| Job | Linux | Windows | macOS |
|---|---|---|---|
| party | 75 to 101 s | 160 to 189 s | 66 to 107 s |
| scenic | 46 s | 65 to 68 s | 62 to 65 s |
| verify alone, party / scenic | 15 to 18 s / 28 to 30 s | 19 to 21 s / 26 to 31 s | 17 s / 41 s |

| One run of everything | Job minutes (rounded up per job) | Plan minutes |
|---|---|---|
| Linux | 3 | 3 |
| Windows | 5 | 10 |
| macOS | 4 | 40 |
| **All three** | 12 | **about 53** (about $0.32 at the rates) |

On the Free plan (2000 minutes a month) that is about 37 full runs; macOS is three quarters of it, which is why pull
requests leave it out. `gh api repos/<owner>/<repo>/actions/runs/<id>/timing` reported 0 billable milliseconds for every
run of 2026-10-11, so the numbers above are computed from the jobs' start and end times, not read from a bill.

## 6. What a runner still cannot check

- **Anything that plays a round** on Linux and Windows: a page that draws a game on two processors gives 1 to 2 frames
  a second. Stepped time moves the game's clock, not the drawing (section 3).
- **Looks.** A frame from SwiftShader or from a virtual card says nothing about how a game looks.
- **WebGPU.** No runner has a hardware WebGPU adapter; the scenic game runs on WebGL2 inside `WebGPURenderer`. The
  WebGPU path of the scenic engine has run only on one Linux machine with an NVIDIA card.
- **macOS could run more than the profile lets it** (it has a virtual card and three processors). Which of the skipped
  checks hold there was not tried; each try costs ten times a Linux minute.
- **The network between two machines.** The gate's two players are two pages of one Chrome on one machine.

## 7. The first runs on three systems (2026-10-11): each fault, its cause, its fix

Run 38151812104 (the first ever on Windows and macOS) failed five of six jobs: both Windows jobs, both Linux jobs, and
the macOS scenic job, which showed green only because its verify step was `continue-on-error`.

| # | System | What was seen | Cause | Fix, and where |
|---|---|---|---|---|
| 1 | Windows | `npm test`: `one-line.test.mjs` read `'1\r\n'` where it wrote `'1\n'` | The test's own little repository had no `.gitattributes`, and Git for Windows checks text out with CRLF (`core.autocrlf=true`). The kit's repository has the line; a real clone is not affected | The fixture carries the kit's `* text=auto eol=lf` line. `tests/one-line.test.mjs` |
| 2 | Windows | `npm test`: `web3-routes.test.mjs`, `write ECANCELED` on an upload the server refuses | The server answers 413 and closes while the body is still being written. The helper already took `ECONNRESET` and `EPIPE` as that refusal; Windows reports `ECANCELED` (or `ECONNABORTED`) | The helper knows the two Windows codes. `tests/web3/helpers.mjs` |
| 3 | Windows | `create --from isle-run`: "world/world.js does not import (Cannot find module …\\gf-scenic\\three\\core\\util.js" | The tools map `gf-scenic/three/…` to the shared kit when a module is read in Node, and decided "is this file under that folder" with `startsWith(folder + '/')`, never true for a Windows path. Every scenic `create` failed on Windows | `below(base, file)` in `tools/lib/paths.mjs`, by the system's own path rules, tested for Windows from any system; used by `kit-import.mjs` and `likeness-check.mjs`. games.fun b095b4b1f |
| 4 | Linux, Windows (both engines) | Check 5's lobby legs: "timed out waiting for both players in the room", or the joiner "Could not connect to the host", after 2 to 5 minutes; on Windows a click on Host or Join timed out after 30 s | The lobby shows the game's own world behind the waiting room, drawn by the host's page and by the friend's. On two processors with no graphics card that took the whole machine: pages stopped answering and the join ran into the kit's 20 s limit. Reproduced on Linux with SwiftShader on two processors: with the backdrop the join never completed, without it it took 1.6 s. It would do the same to a player on such a machine | The kit leaves the backdrop out on a machine that draws on its processor (`kit/core/quality.js` `drawsOnCard`, asked before anything is loaded; the seat colours still reach the lobby). Two questions, because headless Chrome on Linux grants a `failIfMajorPerformanceCaveat` context that Chrome on Windows refuses: the context, then the renderer's name. games.fun dafbd63b3, e9f3fc539 |
| 5 | Linux (local) | The same steps had passed on the maintainer's machine "under software rendering" in 7 s | Three things. The gate did not read `GF_VERIFY_SOFTWARE` and launched Chrome with the graphics-card flags; on that machine those flags gave no WebGL at all, so the backdrop drew nothing; and the machine has 24 processors. Not a different Chrome, a timeout or the network | The gate launches plain Chrome under `GF_VERIFY_SOFTWARE` and records what drew (`record.json` → `renderer`, `graphics`). A join that fails now says where both pages stood, the WebRTC states in order, and a timeline of seconds per check. games.fun bb5766dd2, 43111c59b, e5bdd8520 |
| 6 | macOS (both engines; the party job passed once and failed twice) | The lobby legs: the joiner "Could not connect to the host" after 20 s, on pages that answered at once | Not the adapters' routing: the connection never got that far. Every signaling message was delivered (6 relayed), and both connections stayed in the state "new". The gate's probe showed the only WebRTC candidate is a host candidate behind an mDNS name (`<uuid>.local`), which that machine does not look up (two connections in one page: not connected in 8 s); with real addresses in the candidates the same two connected in 0.1 s. Run 38155295826, `record.json` → `webrtc` | QA Chrome that plays two players on one machine launches with `WebRtcHideLocalIpsWithMdns` off (`qa/browser.mjs` `LOCAL_WEBRTC_OFF`), in one `--disable-features` switch together with Playwright's own list, because Chrome keeps only the last such switch. The gate and `launchForGame` use it. After a failed join the gate runs the probe with and without it. games.fun b2255688c, 5cfa0ea95 |

Of the eight risks this document listed before the first run, five did not happen (the tools' start-up guard, line
endings in `kits/`, long paths and `.cmd` spawns, Chrome discovery, Gatekeeper). "WebRTC over loopback" happened on
macOS, for another reason than the one guessed (fault 6); "tests that assume POSIX" happened twice (faults 1 and 2);
"slow runners" was right and worse than estimated (fault 4). Also seen: verify prints the game's folder with the
system's separator on Windows (`verify games\ci`); the verdict file uses forward slashes.

After the fixes every job is green on every system: run 38155626989, then three consecutive runs on the commit that
took `continue-on-error` off the verify steps (`gh run list --workflow check.yml --branch ci/three-systems`).

### The runs of branch `ci/release-try` (2026-10-11, kits at games.fun de2ea9313, the board example added)

| Run | Asked for | Result |
|---|---|---|
| 38164013581 | `system=linux-windows`, `job=party` | green: party on Linux and Windows, the party game and the board game under the profile |
| 38164928678 | every job on every system | five of six green (party on Windows and macOS, scenic on all three). **party on Linux failed**: the party game's lobby legs, 6 of 7, `run-completed`, "timed out waiting for both players in the room" after 43 s; the board game's steps were then skipped |
| 38165389785 | `system=linux`, `job=party`, the same commit | green, the board game included |
| 38165565315 | `system=linux-windows`, every job, on the commit after (documents and the examples' records only) | green: all four jobs. macOS was not run again: it is ten times the minutes and nothing a runner executes had changed |

**Fault 7, open (not fixed here: it is in the kits).** In run 38164928678 the two pages were connected and nothing
moved after that. The gate's record: the host's page in its room with 1 player, the host's kit "Opening a room…" with
its peer "connected open"; the friend's page still on the home card with "Connected. Waiting for the host…", channel
open, connection connected; both connected 0.1 s after the join; WebRTC itself fine in the gate's own probe. So the
connection was made and the host never answered the friend's first message. It is not fault 4 (no backdrop is drawn on
that runner) and not fault 6 (the connection opened). Seen once in four Linux runs of the party game's lobby legs on
these kits, never in the eighteen jobs of the three green runs on the kits before, and once on the maintainer's
machine as check 25 of a full verify of the same example with twenty-eight processes waiting (it passed when run
again, and ten runs of the profile passed in a row there). Asked of games.fun; until it is found, a red `party` job
with exactly this line is run again before anything else is suspected.

### The run of branch `ci/integration` (2026-10-11, kits at games.fun f70f94e13)

The branch is `ci/release-try` with the licence files, the art makers, the kits synced again (the frozen
gf-multiplayer 1.6.4, the self-host signaling server, the loop's second reader and `delivered-with-issues`), online play
in the dev server and the second reader's tool round.

| Run | Asked for | Result |
|---|---|---|
| 38167016234 | every job on every system, on f9f150e | green: all six jobs (party and scenic on Linux, Windows and macOS; the party game and the board game under the profile) |

Fault 7 did not happen in this run (one Linux party job), so there is no new record of it. Two things about it and the
new kit, from the code and not from a run that showed it:

- **A game the runner makes is still on gf-multiplayer 1.6.3.** `create` vendors the version games.fun's tools name
  (`KIT_VERSION`, 1.6.3 at f70f94e13); 1.6.4 is in `kits/` as the newest frozen version only. So nothing 1.6.4 changes
  is exercised by this workflow yet.
- **1.6.4 is not a fix for fault 7.** Its change to the join is that a host stops sending ICE candidates over
  *signaling* once the friend's channel is open (the `400 no such peer` calls on the play host, which come from late
  reflexive and relay candidates over HTTP signaling). In fault 7 the gate runs over this machine's WebSocket
  signaling, a direct connection has no late candidates, the channel was open on both sides, and what was missing was
  the host's answer to the friend's first message *on the data channel*. Track M's cause is at the end of the
  handshake on signaling; fault 7 is after it, on the channel. It stays open and asked of games.fun.

By hand on Linux with a graphics card, the same day and the same commit: `tests/two-hosts.mjs --case soak-squad`
(SAME: both hosts pass every check and deliver), `GAMESFUN_SMOKE=1 node --test tests/smoke.test.mjs` (3 of 3: the party
example and the scenic example pass every check, the board example fails check 7 only, as its `example.json` says), and
`tests/online-e2e.mjs` (13 of 13: two pages on two origins through the self-host signaling server on a third; a host
that refuses, and one a page cannot read, both leave the game playing on this machine with the reason shown). None of
the three has run on Windows or macOS.

**Asked of games.fun:** make 1.6.4 the version `create` vendors (`KIT_VERSION` in
`research/multiplayer/party/manifest.mjs`), then sync. Until then a game made with this kit plays with friends on this
machine only, whatever the play host's switch says, and `doctor` and `dev` say so.

### Kits synced to games.fun ed6c86ffa (2026-10-11)

Checks 22 and 24 are release-only in the kits now (`RELEASE_ONLY` in `tools/lib/verdict.mjs`: a build's verify does not
run them), so `.github/ci-profile.json` no longer lists them and `tests/ci.test.mjs` would fail if it did. `create`
vendors gf-multiplayer 1.6.5 (`KIT_VERSION`), so the workflow's games now exercise 1.6.4's and 1.6.5's changes. The
sections above keep the 1.6.3 and 1.6.4 wording as the record of those runs.

## 8. What a person on a real Windows machine or a Mac still has to try by hand

A runner is a virtual machine without a real graphics card, and it ran the profile only. None of this has been done on
a person's machine:

1. **A full `gamesfun verify` (no profile) of a party game** on Windows and on a Mac with a real graphics card: every
   check that plays a round (3, 4, 5 in full, 6, 7, 10, 12, 13, 15, 16, 20 to 22, 24, 25).
2. **A scenic game on WebGPU**: Direct3D 12 on Windows, Metal on a Mac. `qa/browser.mjs` `gpuLaunchPlan` marks both
   rows `measured: false`.
3. **Two players on one Mac**, in `gamesfun dev` and in verify's check 25: the flag of fault 6 is passed by the QA
   browser, not by a person's own Chrome. Two tabs of a person's Chrome on one Mac depend on mDNS lookups (macOS asks
   for the Local Network permission); two friends on two machines do not.
4. **The lobby with its backdrop on a real card** on Windows and on a Mac, and the lobby without it on a machine that
   has none (a remote desktop, a virtual machine): the waiting room should stand on the page's own background.
5. **`npx gamesfun` from a fresh clone** in PowerShell and in Terminal: `create`, `dev`, the Studio page, `doctor` with
   its graphics probe (the runners ran `--skip-graphics`).
6. **A path with a space or a non-ASCII letter** (`C:\Users\José\My Games`), and a clone with `core.autocrlf=true` on
   Windows: `npm test` held on the runner's `D:\a\…` path only.
7. **Chrome installed per user, Edge only, or no Chrome** (Playwright's Chromium is then downloaded): the runners
   carry Chrome in the usual place.
