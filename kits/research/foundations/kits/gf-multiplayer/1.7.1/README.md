# gf-multiplayer 1.7.1 (frozen): the mic in the stream panel

Friends in one game, who see each other. One player hosts in their own browser and the others join. There is no game server. This directory is immutable.

What the kit is: the 1.2.0 README (`../1.2.0/README.md`), the changes in `../1.2.1/` to `../1.7.0/README.md`, and `research/multiplayer/party/LIVE_HANDBOOK.md`.

## What changed from 1.7.0

**The creator, 2026-10-12:** "I dont see the mic option when trying to go live on potatoes zombie town", "I was at https://games-fun-play.vercel.app/p/potatoes-zombie-town/gf/mp/index.html, clicked go live, and saw no mic", then "The mic options should come up after yuou click go live before you start the game" (`research/watch/evidence/mic-after-go-live-2026-10-12/request.json`). In 1.7.0 only Studio's play page offered the mic, in its own header; the friends page, where you go live, said nothing about it.

- *The stream panel* (`#mp-live-share`, which opens on Go live: in the waiting room before the round, in a round, in a world) has **Turn on mic** (`#mp-live-mic`) as soon as the stream is on, with a line saying what it does. While voice flows it reads **Mic on · Turn off**.
- *Under Studio's play page* (the page above answers the friends page's first `gf:live-state` with `{type:'gf:mic-here'}`), the button asks that page to open or close the mic (`{type:'gf:mic', v:1, on}`); the page's own button stays too.
- *Anywhere else* (the game's own link on the play origin, a post on X, a page above that isn't Studio) the button opens Studio's mic window, `<studio>/play/<slug>/voice` (`creator-studio/app/play/[slug]/voice`, `components/play/voice-window.tsx`), a small window on Studio's origin. The play origin still never opens a microphone: every game shares it. The window opens the mic only when it is clicked there, posts its voice to the page that opened it (`window.opener`, the play origin only), stops when the stream stops or the game's page goes, and tells the page when it closes. This page takes voice from that window only: the window it opened itself, from Studio's origin; a game below this page, or any other page, is still refused. Closing the window turns the mic off (this page also notices within a second). A browser that blocks the window gets a line saying to allow pop-ups.
- *Held by* verify check 34 (`research/gf-three/tools/lib/friends-watch-check.mjs` `voiceSteps`, live games and worlds): going live in the waiting room must offer Turn on mic before the round starts; the panel's button must open a window at `/play/<slug>/voice`; a stand-in for that window running Studio's `lib/voice-capture.mjs` with Chrome's fake microphone must be heard by a viewer; the panel must show the mic on; closing the window must turn it off. A 1.7.0 copy of Bladder Brawl fails those steps ("no #mp-live-mic in the stream panel"); 1.7.1 copies of Bladder Brawl, Potatoe's Zombie Town and Blockhaven pass.

Files: `party.js`, `party.css` (and `kit.json`); everything else is 1.7.0 byte for byte.

This is the default (`KIT_VERSION` 1.7.1). A published game gets it once it is upgraded and republished. The mic window needs a Studio deploy that has `/play/<slug>/voice` (production since 2026-10-12, dpl_G6JLiPG4JQuHrDKAy1wQWizLHuTD).
