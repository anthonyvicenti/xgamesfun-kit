// Saves & scores' pure logic (studio/tabs/backend/model.js): what a backend gives, which service gives what, and each
// service's connection light.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BENEFITS, SERVICES, ICONS, PLANS, benefitsOf, lightOf } from '../studio/tabs/backend/model.js';

test('four picture cards, each with an icon and at least one service that gives it', () => {
  assert.deepEqual(BENEFITS.map(b => b.id), ['scores', 'saves', 'accounts', 'server']);
  for (const b of BENEFITS) {
    assert.ok(ICONS[b.id], `${b.id} has an icon`);
    assert.ok(b.by.length && b.by.every(id => SERVICES[id]), `${b.id} names known services`);
    assert.ok(!/backend|supabase|railway|json/i.test(`${b.title} ${b.text}`), `${b.id}: plain words`);
  }
  assert.deepEqual(benefitsOf('supabase'), ['scores', 'saves', 'accounts']);
  assert.deepEqual(benefitsOf('railway'), ['scores', 'saves', 'server']);
  assert.deepEqual(benefitsOf('nope'), []);
});

test('the light: connected to this game, signed in only, not connected, could not check', () => {
  const supa = { id: 'supabase', status: { signedIn: null } };
  assert.deepEqual(lightOf(supa, {}), { tone: 'off', words: 'Not connected' });
  assert.equal(lightOf({ ...supa, status: { signedIn: { kind: 'pat' } } }, {}).tone, 'warn');
  assert.equal(lightOf(supa, { settings: { provider: 'supabase' }, client: 'gf/backend/' }).tone, 'ok');
  assert.equal(lightOf(supa, { settings: { provider: 'supabase' }, client: null }).tone, 'warn', 'the game\'s link is missing');
  assert.equal(lightOf(supa, { settings: { provider: 'railway' }, client: 'gf/backend/' }).tone, 'off', 'another service is this game\'s');
  assert.equal(lightOf({ id: 'railway', status: { error: 'x' } }, {}).tone, 'bad');
  assert.equal(lightOf(null).tone, 'off');
});

test('each service\'s plan ends by connecting the game, with step ids the flow uses', () => {
  for (const [id, plan] of Object.entries(PLANS)) {
    assert.ok(SERVICES[id], id);
    assert.equal(plan.at(-1)[0], 'keys');
    assert.ok(plan.some(([s]) => s === 'sign-in'));
  }
});
