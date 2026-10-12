# gf-multiplayer 1.7.0 (frozen): the streamer's voice

Friends in one game, who see each other. One player hosts in their own browser and the others join. There is no game server. This directory is immutable.

What the kit is: the 1.2.0 README (`../1.2.0/README.md`), the changes in `../1.2.1/` to `../1.6.6/README.md`, and `research/multiplayer/party/LIVE_HANDBOOK.md`.

## What changed from 1.6.6

**The creator, 2026-10-12:** "How hard would it be to add in an audio stream from a mic for the stream watchers", then "How many people can watch the stream today? How hard is it to scale this up to at least a few thousand? And the streamer being forced on the website is fine", then "Implement this" (`research/watch/evidence/voice-and-scale-request-2026-10-12.json`).

- *Where the microphone opens:* on Studio's play page (`creator-studio/lib/voice-capture.mjs`, used by `components/play/play-room.tsx`), never on this page. The play origin is every game's, and it sends `permissions-policy: microphone=()`: a grant there would let any game listen later. The play page offers **Turn on mic** while the stream in its frame is on, encodes Opus with WebCodecs (20 ms packets, mono, about 24 kbit/s) and posts them to the friends page every 100 ms (`{type:'gf:voice', v:1, f:20, ms, d}`, `d` = base64 of 2-byte-length-prefixed packets).
- *This page, streaming:* takes `gf:voice` (and `gf:voice-state`, `gf:live-ask`) only from the page directly above it and only from Studio's origin (`/watch/v1`'s `studio`; this machine, with none: its own origin), so a game below it or another page on the play origin can't speak into a stream. It sends each batch on the stream as an `a` frame stamped with this page's clock, as deltas are, and tells the page above when it is live (`{type:'gf:live-state', state, viewers, mic, id}`). The stream's meta says `mic: true` while voice flows, and the LIVE badge reads "· mic on".
- *A viewer:* the bar shows **Tap for sound** (`#mp-watch-sound`) while the streamer talks; a tap starts an AudioContext and a WebCodecs AudioDecoder, and each packet is played at `t + offset + 300 ms`, the moment the game messages around it are played, so the voice is in step with the game. **Sound on** mutes again. A browser without AudioDecoder says so on the button. The voice is the kit's own (an AudioContext of the friends page, not the game's gf-audio bus).
- *The relay* (`research/watch/relay`, same day): `a` frames up to 4 KB, a byte budget per stream (8,000 bytes a second, burst 16,000; past it a frame is dropped), never cached for a late viewer. And on Cloudflare, viewers spread over repeaters so a stream can have a few thousand (README there).
- *Held by* verify check 34 (`research/gf-three/tools/lib/friends-watch-check.mjs` `voiceSteps`, live games and worlds): Studio's own capture file runs on the streamer's page with Chrome's fake microphone (a 440 Hz tone), the viewer taps for sound and must play 15 packets at a level above 0.05; and a message from the game below the streamer's page must be refused.

Files: `party.js`, `party.css` (and `kit.json`); everything else is 1.6.6 byte for byte.

This is the default (`KIT_VERSION` 1.7.0). A published game gets it once it is upgraded and republished, and the streamer's mic needs Studio's play page with the capture (a Studio deploy).
