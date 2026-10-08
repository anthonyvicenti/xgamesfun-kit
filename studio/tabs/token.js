// Studio tab: the game's token. Ported from games.fun Creator Studio v2's Token tab (components/studio/v2/earn.tsx):
// two choices and nothing else to learn: launch a new token (a picture, a name and a ticker; the rest is optional),
// or use a token the creator already has (paste its address). A shop needs neither. Launching runs in the creator's
// own wallet: two upload signatures and one transaction, each shown here before the wallet asks.
import { explorer, fromUnits, pictureUrl, short } from './web3/client.js';
import { approvalPanel, choosePicture, fill, h, note, requestBanner, styles, tabContext, walletChip } from './web3/ui.js';

/** "Bean Brawl" → BEAN; one short word → its letters; else initials. */
function tickerOf(title) {
  const words = String(title).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const first = (words[0] ?? '').slice(0, 8);
  return first.length >= 2 ? first : words.map((w) => w[0]).join('').slice(0, 8) || 'GAME';
}
const clip = (s, max) => {
  let t = String(s ?? '').trim();
  while (new TextEncoder().encode(t).length > max) t = t.slice(0, -1);
  return t;
};

export default {
  id: 'token',
  label: 'Token',
  order: 40,
  mount(el, ctx) {
    styles();
    const t = tabContext(ctx);
    const root = h('div', { class: 'gfw3', 'data-testid': 'tab-token' });
    el.replaceChildren(root);
    let state = null;
    let mode = 'choose';
    let flow = null;
    let message = null;
    const form = { name: '', symbol: '', picture: null, description: '', initialBuy: '' };
    let lookup = { mint: '', info: null, error: '', looking: false };

    async function refresh() {
      try {
        state = await t.api('/state');
      } catch (error) {
        fill(root, note('error', `Could not load the game’s web3 setup: ${error.message}`), h('button', { onclick: refresh }, 'Try again'));
        return;
      }
      if (!form.name) form.name = clip(state.game.title, 32);
      if (!form.symbol) form.symbol = tickerOf(state.game.title);
      render();
    }

    const run = async (done, work) => {
      message = null;
      try {
        await work();
        if (done) message = { kind: 'ok', text: done };
      } catch (error) {
        message = { kind: 'error', text: error.message };
      }
      await refresh();
    };

    async function start(body) {
      try {
        if (!t.wallet.address()) await t.wallet.connect();
        flow = await t.api('/flow/start', { ...body, wallet: t.wallet.address() });
        message = null;
      } catch (error) {
        message = { kind: 'error', text: error.message };
      }
      render();
    }

    function header() {
      return h('div', { class: 'bar' },
        h('div', {}, h('h2', {}, 'Token'), h('span', { class: 'badge dev' }, 'Devnet · test tokens only')),
        walletChip(t, (error) => (error ? (message = { kind: 'error', text: error }) : null, render())));
    }

    function tokenCard(token) {
      const live = state.chain?.token;
      return h('div', { class: 'card', 'data-testid': 'token-card' },
        h('div', { class: 'row' },
          token.image ? h('img', { class: 'pic slot', src: token.image, alt: '', referrerpolicy: 'no-referrer' }) : null,
          h('div', { class: 'grow' },
            h('h3', {}, `${token.name} · $${token.symbol}`),
            h('p', { class: 'dim' }, token.source === 'launched' ? `Launched here on games.fun’s ${state.network.quoteSymbol} curve.` : 'A token you already had, linked to this game.'),
            h('p', { class: 'mono' }, 'Mint ', h('a', { href: explorer(state, 'address', token.mint), target: '_blank', rel: 'noreferrer' }, token.mint)),
            token.pool ? h('p', { class: 'mono dim' }, `Pool ${token.pool}`) : null,
            live ? h('p', { class: 'dim' }, live.exists ? 'Found on chain.' : 'Not found on chain yet (it can take a few seconds).') : null,
            live?.pool ? h('p', { class: 'dim' }, `Curve: ${fromUnits(live.pool.quoteReserve, state.network.quoteDecimals)} ${state.network.quoteSymbol} raised${live.pool.isMigrated ? ', graduated' : ''}.`) : null)),
        token.source === 'linked'
          ? h('button', { onclick: () => run('This game no longer uses that token.', () => t.api('/token/unlink', {})) }, 'Stop using it')
          : h('p', { class: 'dim' }, 'Its name, ticker and picture are permanent. Players can use it in your shop if you price the shop in it.'));
    }

    function chooser() {
      return h('div', { class: 'card' },
        h('h3', {}, `Give ${state.game.title} a token`),
        h('p', { class: 'dim' }, 'Optional. You can sell items without one.'),
        h('div', { class: 'choices' },
          h('button', { class: 'choice', 'data-testid': 'token-launch', onclick: () => ((mode = 'launch'), render()) }, h('strong', {}, 'Launch a new token'), h('span', { class: 'dim' }, `Players buy it on a bonding curve in ${state.network.quoteSymbol}, and you earn a share of every trade.`)),
          h('button', { class: 'choice', 'data-testid': 'token-link', onclick: () => ((mode = 'link'), render()) }, h('strong', {}, 'Use a token you already have'), h('span', { class: 'dim' }, 'Paste its address. Any Solana token works.'))));
    }

    function launchForm() {
      const q = state.network.quoteSymbol;
      const pictureSlot = h('button', { class: 'pic slot', title: 'Pick a picture', 'data-testid': 'token-picture', onclick: async () => {
        const p = await choosePicture(state, 'Token picture');
        if (p) (form.picture = p), render();
      } }, form.picture ? h('img', { class: 'pic', src: pictureUrl(form.picture), alt: '' }) : 'Pick a picture');
      const input = (key, props) => h('input', { value: form[key], oninput: (e) => (form[key] = props.clean ? props.clean(e.target.value) : e.target.value), ...props.attrs });
      return h('div', { class: 'card', 'data-testid': 'launch-form' },
        h('button', { class: 'link', onclick: () => ((mode = 'choose'), render()) }, '← Back'),
        h('h3', {}, 'Launch a token'),
        h('p', { class: 'dim' }, 'Pick a picture, a name and a ticker. That’s all a launch needs.'),
        h('div', { class: 'row' }, pictureSlot,
          h('div', { class: 'grow', style: 'display:grid;gap:8px' },
            h('label', { class: 'field' }, 'Name', input('name', { attrs: { maxLength: 32, 'data-testid': 'token-name' } })),
            h('label', { class: 'field' }, 'Ticker', input('symbol', { attrs: { maxLength: 10, 'data-testid': 'token-symbol' }, clean: (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, '') })))),
        h('details', {}, h('summary', {}, 'Initial buy and description (optional)'),
          h('label', { class: 'field' }, `Buy at launch, in ${q} (in the same transaction, so nobody buys first)`, input('initialBuy', { attrs: { inputMode: 'decimal', placeholder: 'None' }, clean: (v) => v.replace(/[^0-9.]/g, '') })),
          h('label', { class: 'field' }, 'Description', h('textarea', { rows: 3, maxLength: 1000, value: form.description, oninput: (e) => (form.description = e.target.value) }))),
        h('p', { class: 'dim' }, 'The name, ticker and picture are permanent once launched. Your wallet becomes the token’s creator and signs; no keys leave it.'),
        h('button', { class: 'primary', 'data-testid': 'token-launch-go', disabled: !form.picture || !form.name.trim() || form.symbol.length < 2,
          onclick: () => start({ kind: 'launch', input: { name: form.name, symbol: form.symbol, picture: form.picture, description: form.description, initialBuy: form.initialBuy } }) },
          `Launch $${form.symbol || 'TOKEN'}${Number(form.initialBuy) > 0 ? ` and buy ${form.initialBuy} ${q}` : ''}`),
        !form.picture ? h('span', { class: 'dim' }, ' Add a picture first.') : null);
    }

    function linkForm() {
      const look = async (text) => {
        const mint = text.trim();
        lookup = { mint, info: null, error: '', looking: Boolean(mint) };
        render();
        if (!mint) return;
        try {
          const info = await t.api('/mint', { mint });
          if (lookup.mint === mint) lookup = { mint, info, error: '', looking: false };
        } catch (error) {
          if (lookup.mint === mint) lookup = { mint, info: null, error: error.message, looking: false };
        }
        render();
      };
      const info = lookup.info;
      return h('div', { class: 'card', 'data-testid': 'link-form' },
        h('button', { class: 'link', onclick: () => ((mode = 'choose'), render()) }, '← Back'),
        h('h3', {}, 'Use a token you already have'),
        h('p', { class: 'dim' }, 'Paste the token’s mint address. No wallet needed.'),
        h('label', { class: 'field' }, 'Token address', h('input', { value: lookup.mint, spellcheck: false, placeholder: 'e.g. 4ikj24Byduo7WZGhnxNYkqstpm9xUVeZH7eLQbjGDL7N', 'data-testid': 'link-mint', onchange: (e) => look(e.target.value) })),
        lookup.looking ? h('p', { class: 'dim' }, 'Looking it up…') : null,
        lookup.error ? h('p', { class: 'note error' }, lookup.error) : null,
        info ? h('div', { class: 'note', 'data-testid': 'mint-card' }, h('strong', {}, info.name ?? 'Unnamed token'), ` ${info.symbol ? `$${info.symbol}` : ''} · ${info.decimals} decimals${info.program === 'token-2022' ? ' · Token-2022' : ''}`) : null,
        info && !info.lootReady ? h('p', { class: 'dim' }, 'This is a Token-2022 token. It can be your game’s token, but the shop can’t be priced in it.') : null,
        h('button', { class: 'primary', 'data-testid': 'link-go', disabled: !info, onclick: () => run(`${state.game.title} now uses $${info.symbol ?? short(info.mint)}.`, () => t.api('/token/link', { mint: info.mint })) }, `Use ${info?.symbol ? `$${info.symbol}` : 'this token'}`));
    }

    function render() {
      if (!state) return;
      const token = state.config.token;
      const body = [];
      if (flow) {
        body.push(approvalPanel(t, flow, {
          onDone: () => {
            message = { kind: 'ok', text: 'Your token is live.' };
            flow = null;
            mode = 'choose';
            refresh();
          },
          onClose: () => ((flow = null), refresh()),
        }));
      } else {
        if (!token) body.push(...requestBanner(t, state, 'launch', { onReview: (r) => start({ requestId: r.id }), onDone: refresh }));
        if (token) body.push(tokenCard(token));
        else if (mode === 'launch') body.push(launchForm());
        else if (mode === 'link') body.push(linkForm());
        else body.push(chooser());
      }
      fill(root, 
        header(),
        message ? note(message.kind, message.text) : null,
        state.chainError ? note('error', state.chainError) : null,
        ...body,
        h('p', { class: 'dim' }, `RPC: ${state.rpc.shown}${state.rpc.custom ? ' (yours)' : ' (public; set your own with gamesfun web3 settings --rpc)'}`),
      );
    }

    refresh();
    return () => el.replaceChildren();
  },
};
