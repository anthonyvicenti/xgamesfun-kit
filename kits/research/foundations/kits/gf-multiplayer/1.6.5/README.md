# gf-multiplayer 1.6.5 (frozen): the streamer link, the same stream link next time

Friends in one game, who see each other. One player hosts in their own browser and the others join. There is no game server. This directory is immutable.

What the kit is: the 1.2.0 README (`../1.2.0/README.md`), the changes in `../1.2.1/` to `../1.6.4/README.md`, and `research/multiplayer/party/LIVE_HANDBOOK.md`.

## What changed from 1.6.4

**The creator, 2026-10-11:** "Its always a different link when you press go live. Like If I close my game but want to stream live from the same link as before, how can I do that?" (`research/watch/evidence/same-link-and-phone-card-report-2026-10-11.json`).

- *Why it happened:* a stream's channel (a public id, which is the link, and a secret key the relay binds to it) has lived in the tab's sessionStorage since 1.6.2. localStorage was dropped after play-test 1 because every game on the play origin can read it (another page read the secret and took the stream over), so a closed tab lost the key and the next Go live made a new link.
- *What 1.6.5 does:* the streamer's share sheet has **Copy my streamer link** (`#mp-live-keep`) under the public link, with a line saying it is private. The streamer link is this friends page with the channel in its fragment, `#gf-stream=<id>.<key>`, which browsers never send to a server. Opened later, in any tab or browser, the page puts that channel in the tab's sessionStorage, takes the fragment out of the address bar (`history.replaceState`), and shows a note (`#mp-live-saved`, "Saved stream link ready: Go live to reuse it."). The next Go live, from the waiting room or the game's menu, is on the same public link, so an old post on X shows the stream again. The secret is kept in the streamer's own bookmark or notes, never in storage the origin's games share. The relay keeps a channel's key for 30 days after it was last live.
- `net.live.saved` is true on a page opened from a streamer link; the QA observation's `live.saved` is the channel id (never the key). A viewer's page (`?watch=`) ignores the fragment.
- *Held by verify check 34* (`research/gf-three/tools/lib/friends-watch-check.mjs`, `worlds-watch-check.mjs`): two new steps, "the share sheet hands the streamer a private link for the same stream next time" (read back from the clipboard after a click) and "another day, the streamer link goes live on the same link, and the old link shows it" (a new browser opens it, hosts or enters, goes live: the same id and link, the address bar clean, the note shown, no gf-watch entry in localStorage, and a viewer on the old link sees it live). On 2026-10-11 both steps failed a Bladder Brawl built on 1.6.4 ("no #mp-live-keep, or it copied nothing") and passed the same game on 1.6.5 (21 of 21 steps), and Blockhaven on 1.6.5 passed 22 of 22.

Files: `party.js` and `party.css` (and `kit.json`); everything else is 1.6.4 byte for byte.

This is the default (`KIT_VERSION` 1.6.5 in `research/multiplayer/party/manifest.mjs`), which also makes 1.6.4's signaling fixes the default. A published game gets the streamer link once it is upgraded (`gf-three upgrade`) and republished.
