// spec.forge.cards[]: the reward cards, and spec.forge.deal: how a reward is dealt and shown (owner: forge-feel for
// what a card does and for the deal, research/gf-forge/core/forge-feel/src/cards.rs; the reward screen is the kit's,
// gf/forge/cards.js). Timings are the measured feel targets (research/rust-engine/feel-targets.md moments 2, 3 and 17).
// A card's colour is its rarity's unless it sets its own.
//
// What a card does (since wave 2 the core runs it; a card applies to the one player who takes it, and cards stack):
//   kind "upgrade"  changes one table value for that player: `stat` is the value's path in spec.forge, then
//                   (value + add) × mul. A second value (`stat2`, `add2`, `mul2`) makes a trade ("hits harder, reloads
//                   slower"). Paths: "player.<value>" (walk, jump, health, armor, evade.cooldown, evade.distance,
//                   stamina.max, stamina.regen, stamina.evadeCost, revive.time, …: any number of the player table) and
//                   "weapons.<id>.<value>" (damage, critMultiplier, fireInterval, magazine, reload, pellets, spread,
//                   range, knockback, kick.pitch, melee.reach, …), or "weapons.*.<value>" for every weapon in the table.
//   kind "weapon"   gives the weapon `weapon` (a weapons id) and draws it; a player who holds it is not dealt the card.
//   kind "heal"     gives back `add` hit points and `share` of full health, at once.
// `stack` is how many copies one player may hold (a card at its stack is not dealt to them again).
import { num, int, color, text, words, choice, ref, sound, obj, id } from './fields.js';

export const RARITIES = ['common', 'rare', 'epic'];
export const RARITY_COLORS = { common: '#e4d2b7', rare: '#5b8cff', epic: '#ffcf4a' };

export const fields = {
  id: id(),
  name: words('', 'Name', 'The card\'s title', 40),
  text: words('', 'Text', 'What it does, in a line (the inspector adds the exact numbers)', 160),
  rarity: choice('common', RARITIES, 'Rarity', 'common, rare or epic: its colour and how often it is dealt'),
  color: color('#e4d2b7', 'Colour', 'Its edge and glow (moment 17: the rarity\'s colour; a slot)'),
  kind: choice('upgrade', ['weapon', 'upgrade', 'heal'], 'Kind', 'weapon (gives a weapon), upgrade (changes a value), heal'),
  weapon: ref('weapons', 'Weapon', 'For kind weapon: a weapon id from spec.forge.weapons'),
  stat: text('', 'Value', 'For kind upgrade: the table value it changes, as a path ("player.walk", "weapons.sidearm.damage", "weapons.*.reload")', 80),
  add: num(0, -10000, 10000, '', 'Add', 'Added to the value (for a heal: hit points given back)'),
  mul: num(1, 0, 100, '×', 'Multiply', 'The value is multiplied by this (after the add)'),
  stat2: text('', 'Second value', 'A second table value the same card changes (a trade), as a path', 80),
  add2: num(0, -10000, 10000, '', 'Add (second)', 'Added to the second value'),
  mul2: num(1, 0, 100, '×', 'Multiply (second)', 'The second value is multiplied by this (after the add)'),
  share: num(0, 0, 1, '', 'Heal share', 'For kind heal: the share of full health given back (with `add` hit points)'),
  stack: int(3, 1, 9, '', 'Stack', 'How many of it one player may hold'),
  weight: num(1, 0, 100, '', 'Deal weight', 'How often it is dealt, against the others (times its rarity\'s weight)'),
};

/** The deal (moments 2 and 17): the same 140 ms rhythm everywhere; the reward's time and each rarity's weight. */
export const deal = {
  tick: num(0.14, 0.02, 1, 's', 'Deal rhythm', 'Seconds between two cards dealt (moments 2, 17: about 140 ms)'),
  flip: num(0.2, 0.02, 1, 's', 'Flip time', 'Seconds a card takes to turn over (moment 17: 200-230 ms; moment 2\'s opening hand: 120-150 ms)'),
  flipEvery: num(0.215, 0.02, 1, 's', 'Flip stagger', 'Seconds between two flips starting (moment 17: about 215 ms; moment 2: about 175 ms)'),
  hoverLift: num(0.01, 0, 0.2, '', 'Hover lift', 'A card rises this share of the screen height under the pointer (moment 3: about 1%)'),
  pickLift: num(0.033, 0, 0.3, '', 'Pick lift', 'The chosen card rises this share (moment 3: about 3.3%)'),
  seconds: num(20, 3, 600, 's', 'Reward time', 'Seconds a reward stays open: when everyone has picked or passed, or at its end, the fight goes on (the undecided pass)'),
  linger: num(0.6, 0, 5, 's', 'After the last choice', 'Seconds the reward stays up after everyone chose (the chosen card\'s lift)'),
  common: num(60, 0, 1000, '', 'Common weight', 'How often a common card is dealt, against the other rarities'),
  rare: num(30, 0, 1000, '', 'Rare weight', 'How often a rare card is dealt'),
  epic: num(10, 0, 1000, '', 'Epic weight', 'How often an epic card is dealt'),
  text: obj({
    title: words('Choose one', 'title', 'The reward\'s heading', 60),
    wave: words('Wave {wave} is cleared', 'wave line', 'Under the heading; {wave} is the wave\'s number', 80),
    take: words('Take {name}', 'take button', 'The button that takes the chosen card; {name} is the card\'s name', 60),
    pick: words('Choose a card', 'take button, nothing chosen', 'The same button before a card is chosen', 60),
    pass: words('Pass', 'pass button', 'Always allowed', 30),
    waiting: words('Waiting for {names}', 'waiting line', 'After this player chose, while friends still do; {names} are theirs', 80),
    choosing: words('choosing', 'state: choosing', 'Beside a player\'s name', 30),
    picked: words('chose', 'state: picked', 'Beside a player\'s name', 30),
    passed: words('passed', 'state: passed', 'Beside a player\'s name', 30),
    seconds: words('{n} s', 'countdown', 'The seconds left; {n} is the number', 20),
    now: words('now', 'inspector: now', 'Over the value before the card', 20),
    then: words('with it', 'inspector: with the card', 'Over the value after the card', 20),
    weapon: words('A new weapon in your hands', 'inspector: a weapon card', 'The inspector\'s line for a weapon card', 80),
    heal: words('Health', 'inspector: a heal', 'The inspector\'s label for a heal', 30),
    held: words('You hold {n} of {max}', 'inspector: copies held', 'How many of the card this player holds; {n} and {max}', 60),
    common: words('Common', 'rarity: common', '', 20),
    rare: words('Rare', 'rarity: rare', '', 20),
    epic: words('Epic', 'rarity: epic', '', 20),
    keys: words('1 2 3 choose · Enter takes · Esc passes', 'key help', 'The line under the cards for a keyboard', 80),
  }, 'Reward screen words'),
  sounds: obj({
    tick: sound('card-deal', 'click', 'A card dealt (moments 2, 17: a 0.2 s tick each)'),
    flip: sound('card-flip', 'hover', 'A card turning over'),
    chime: sound('card-reveal', 'gem', 'The reveal chime as the first flip begins (moments 2, 17: one 1.44 s chime)'),
    pick: sound('card-pick', 'confirm', 'A card chosen (moment 3: a 0.36 s click)'),
    pass: sound('card-pass', 'cancel', 'The reward passed'),
  }),
};

export const owner = 'forge-feel (cards.rs: effects, the deal, the reward) and the kit\'s reward screen (gf/forge/cards.js)';
