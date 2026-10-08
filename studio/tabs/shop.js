// Studio tab: the game's shop. Ported from games.fun Creator Studio v2's Shop tab (components/studio/v2/earn.tsx):
// one currency pick (SOL, the game's token or any classic SPL token; fixed once live), items made from the game's
// pictures with what owning them changes in the game (its player looks, gf-three CONTRACT §6e), loot boxes with odds
// from rarity, and one "Put it on sale" that is one wallet approval for every transaction (plus a signature for
// each new upload).
import { fromUnits, pictureUrl } from './web3/client.js';
import { approvalPanel, choosePicture, fill, h, keepFresh, modal, note, requestBanner, styles, tabContext, walletChip } from './web3/ui.js';

const STATE_LABEL = { draft: 'Not on sale yet', published: 'On sale', changed: 'Changes not live' };
const SWATCHES = ['#ff4d6d', '#ff9f1c', '#ffd23f', '#7bd389', '#2ec4b6', '#3a86ff', '#8338ec', '#f15bb5', '#ffffff', '#1b1b1f'];
const percent = (x) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;

export default {
  id: 'shop',
  label: 'Shop',
  order: 41,
  mount(el, ctx) {
    styles();
    const t = tabContext(ctx);
    const root = h('div', { class: 'gfw3', 'data-testid': 'tab-shop' });
    el.replaceChildren(root);
    let state = null;
    let flow = null;
    let message = null;

    async function refresh() {
      try {
        state = await t.api('/state');
      } catch (error) {
        fill(root, note('error', `Could not load the game’s web3 setup: ${error.message}`), h('button', { onclick: refresh }, 'Try again'));
        return;
      }
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

    const shop = () => state.config.shop;
    const live = () => Boolean(shop()?.game && state.chain?.shop?.exists);
    const unit = () => shop()?.currency?.symbol ?? (state.config.token?.program === 'spl-token' ? `$${state.config.token.symbol}` : 'SOL');
    const decimals = () => shop()?.currency?.decimals ?? (state.config.token?.program === 'spl-token' ? state.config.token.decimals : 9);
    const itemState = (i) => state.chain?.shop?.items?.[i.id] ?? { state: 'draft', issued: 0 };
    const boxState = (b) => state.chain?.shop?.boxes?.[b.id] ?? { state: 'draft', opened: 0 };
    const lookName = (id) => state.looks.find((l) => l.id === id)?.label ?? id;
    const doesText = (i) => {
      const ids = [...Object.keys(i.look?.values ?? {}), ...Object.keys(i.look?.files ?? {})];
      return ids.length ? `Changes ${ids.map((id) => lookName(id).toLowerCase()).join(', ')}` : 'Collectible only';
    };

    async function publish() {
      try {
        if (!t.wallet.address()) await t.wallet.connect();
        flow = await t.api('/flow/start', { kind: 'publish', wallet: t.wallet.address() });
        message = null;
      } catch (error) {
        message = { kind: 'error', text: error.message };
      }
      render();
    }

    function header() {
      return h('div', { class: 'w3-bar' },
        h('div', {}, h('h2', {}, 'Shop'), h('span', { class: 'w3-badge dev' }, 'Devnet · test tokens only')),
        walletChip(t, (error) => (error ? (message = { kind: 'error', text: error }) : null, render())));
    }

    function payPicker() {
      const s = shop();
      if (live()) return h('p', { class: 'note', 'data-testid': 'shop-pay' }, `Priced in ${s.currency.symbol}. A live shop keeps its currency.`);
      const options = [...state.network.currencies.map((c) => ({ label: c.symbol, value: c.kind, mint: c.mint }))];
      if (state.config.token?.program === 'spl-token') options.unshift({ label: `$${state.config.token.symbol}`, value: 'token', mint: state.config.token.mint });
      const chosen = s?.currency?.mint ?? options[0].mint;
      const other = s?.currency && !options.some((o) => o.mint === s.currency.mint);
      return h('div', { class: 'w3-row', 'data-testid': 'shop-pay' },
        h('span', { class: 'dim' }, 'Players pay with'),
        h('div', { class: 'seg', role: 'radiogroup' },
          options.map((o) => h('button', { role: 'radio', class: !other && chosen === o.mint ? 'on' : '', 'aria-checked': String(!other && chosen === o.mint), onclick: () => run(`Your shop is priced in ${o.label}.`, () => t.api('/shop/currency', { currency: o.value })) }, o.label)),
          other ? h('button', { class: 'on' }, s.currency.symbol) : null,
          h('button', { 'data-testid': 'shop-pay-other', onclick: otherToken }, 'Another token…')));
    }

    /** Price the shop in any classic SPL token: paste its mint, see what it is, then use it. */
    function otherToken() {
      let info = null;
      let error = '';
      const input = h('input', { spellcheck: false, placeholder: 'Paste a token’s mint address', 'data-testid': 'shop-pay-mint' });
      const m = modal();
      const draw = () =>
        fill(m.el,
          h('h3', {}, 'Price the shop in another token'),
          h('p', { class: 'dim' }, 'Any classic SPL token works. Players pay in it; your sales arrive in it.'),
          input,
          h('button', { onclick: async () => {
            info = null;
            error = '';
            try {
              info = await t.api('/mint', { mint: input.value.trim() });
              if (!info.lootReady) error = 'That is a Token-2022 token; shops can’t be priced in it.';
            } catch (e) {
              error = e.message;
            }
            draw();
          } }, 'Look it up'),
          info ? h('p', { class: 'note', 'data-testid': 'mint-card' }, h('strong', {}, info.name ?? 'Unnamed token'), ` ${info.symbol ? `$${info.symbol}` : ''} · ${info.decimals} decimals`) : null,
          error ? h('p', { class: 'note error' }, error) : null,
          h('div', { class: 'w3-row' },
            h('button', { class: 'primary', disabled: !info || !info.lootReady, onclick: () => (m.close(), run(`Your shop is priced in ${info.symbol ?? 'that token'}.`, () => t.api('/shop/currency', { currency: info.mint }))) }, `Price in ${info?.symbol ? `$${info.symbol}` : 'this token'}`),
            h('button', { onclick: m.close }, 'Cancel')));
      draw();
    }

    function itemCard(i) {
      const s = itemState(i);
      const picture = i.picture ? pictureUrl(i.picture) : i.image;
      return h('button', { class: 'tile', 'data-testid': 'shop-item', onclick: () => itemDialog(i) },
        picture ? h('img', { class: 'pic', src: picture, alt: '', referrerpolicy: 'no-referrer' }) : h('span', { class: 'pic' }, 'No picture'),
        h('strong', {}, i.name),
        h('span', { class: `rarity-${state.rules.rarities.indexOf(i.rarity)}` }, i.rarity, ' · ', h('span', { class: 'dim' }, i.price === '0' ? 'Loot boxes only' : `${fromUnits(i.price, decimals())} ${unit()}`)),
        h('span', { class: 'dim' }, doesText(i)),
        h('span', { class: `state ${s.state}` }, STATE_LABEL[s.state], s.issued ? ` · ${s.issued} owned` : '', !i.picture && !i.image ? ' · needs a picture' : ''));
    }

    function boxCard(b) {
      const s = boxState(b);
      const total = b.entries.reduce((n, e) => n + e.weight, 0);
      return h('button', { class: 'tile', 'data-testid': 'shop-box', onclick: () => boxDialog(b) },
        h('strong', {}, b.name), h('span', { class: 'dim' }, `${fromUnits(b.price, decimals())} ${unit()}`),
        h('ul', { style: 'margin:0;padding-left:18px' }, b.entries.map((e) => h('li', {}, `${shop().items.find((i) => i.id === e.item)?.name ?? `Item ${e.item}`}: ${percent(e.weight / total)}`))),
        h('span', { class: `state ${s.state}` }, STATE_LABEL[s.state], s.opened ? ` · opened ${s.opened}×` : ''));
    }

    /** "In the game": what owning the item changes, from the game's player looks. */
    function lookEditor(draft, locked) {
      const wrap = h('div', { style: 'display:grid;gap:8px', 'data-testid': 'item-ingame' });
      const draw = () => {
        const values = draft.look.values;
        const files = draft.look.files;
        fill(wrap, 
          h('strong', {}, 'In the game'), h('span', { class: 'dim' }, 'What changes for a player who owns it? Everyone in a match sees it.'),
          state.looks.length ? null : h('p', { class: 'dim' }, 'This game declares no player looks yet, so items are collectibles only.'),
          ...state.looks.map((slot) => {
            const on = slot.id in values || slot.id in files;
            const toggle = h('label', { class: 'w3-row' }, h('input', { type: 'checkbox', checked: on, disabled: locked, style: 'width:auto', 'data-testid': `look-${slot.id}`, onchange: (e) => {
              if (e.target.checked) {
                if (slot.type === 'color') values[slot.id] = SWATCHES[0];
                else if (slot.type === 'enum') values[slot.id] = slot.options?.[0]?.value;
                else if (slot.type === 'boolean') values[slot.id] = true;
                else if (slot.type === 'number' || slot.type === 'integer') values[slot.id] = slot.min ?? 1;
                else files[slot.id] = '';
              } else {
                delete values[slot.id];
                delete files[slot.id];
              }
              draw();
            } }), slot.label);
            if (!on) return toggle;
            let editor = null;
            if (slot.type === 'color') editor = h('div', { class: 'swatches' }, SWATCHES.map((c) => h('button', { 'aria-label': c, class: values[slot.id] === c ? 'on' : '', style: `background:${c}`, disabled: locked, onclick: () => ((values[slot.id] = c), draw()) })),
              h('input', { type: 'color', value: values[slot.id] ?? '#ffffff', disabled: locked, style: 'width:44px;padding:0', oninput: (e) => (values[slot.id] = e.target.value) }));
            else if (slot.type === 'enum') editor = h('select', { disabled: locked, onchange: (e) => (values[slot.id] = e.target.value) }, (slot.options ?? []).map((o) => h('option', { value: o.value, selected: values[slot.id] === o.value }, o.label)));
            else if (slot.type === 'boolean') editor = h('span', { class: 'dim' }, 'On for owners');
            else if (slot.type === 'number' || slot.type === 'integer') editor = h('input', { type: 'number', value: values[slot.id], min: slot.min, max: slot.max, disabled: locked, oninput: (e) => (values[slot.id] = Number(e.target.value)) });
            else editor = h('input', { placeholder: slot.type === 'model' ? 'A .glb in the game (assets/models/hat-gold.glb) or an https URL' : 'A file in the game or an https URL', value: files[slot.id] ?? '', disabled: locked, oninput: (e) => (files[slot.id] = e.target.value) });
            return h('div', { style: 'display:grid;gap:4px' }, toggle, editor);
          }),
        );
      };
      draw();
      return wrap;
    }

    function itemDialog(item) {
      const s = item ? itemState(item) : { issued: 0 };
      const locked = s.issued > 0;
      const draft = {
        id: item?.id,
        name: item?.name ?? '',
        picture: item?.picture ?? null,
        rarity: item?.rarity ?? 'Common',
        price: item && item.price !== '0' ? fromUnits(item.price, decimals()) : '',
        description: item?.description ?? '',
        maxSupply: item?.maxSupply ? String(item.maxSupply) : '',
        soulbound: item?.soulbound ?? false,
        look: { values: { ...(item?.look?.values ?? {}) }, files: { ...(item?.look?.files ?? {}) } },
      };
      let error = '';
      const slot = h('button', { class: 'pic slot', 'data-testid': 'item-picture', disabled: locked, onclick: async () => {
        const p = await choosePicture(state, 'Item picture');
        if (p) {
          draft.picture = p;
          if (!draft.name) draft.name = p.split('/').pop().replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
          draw();
        }
      } });
      const m = modal();
      const draw = () => {
        fill(slot, draft.picture ? h('img', { class: 'pic', src: pictureUrl(draft.picture), alt: '' }) : 'Pick a picture');
        fill(m.el, 
          h('h3', {}, item ? 'Edit item' : 'Add an item'),
          locked ? h('p', { class: 'note' }, 'Players already own this item, so its picture, name and look can’t change. The price and supply still can.') : null,
          h('div', { class: 'w3-row' }, slot,
            h('div', { class: 'grow', style: 'display:grid;gap:8px' },
              h('label', { class: 'field' }, 'Name', h('input', { value: draft.name, maxLength: 32, disabled: locked, 'data-testid': 'item-name', oninput: (e) => (draft.name = e.target.value) })),
              h('label', { class: 'field' }, `Price in ${unit()} (empty: loot boxes only)`, h('input', { value: draft.price, inputMode: 'decimal', placeholder: 'Loot boxes only', 'data-testid': 'item-price', oninput: (e) => (draft.price = e.target.value.replace(/[^0-9.]/g, '')) })))),
          h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Rarity' }, state.rules.rarities.map((r, i) => h('button', { class: `${draft.rarity === r ? 'on ' : ''}rarity-${i}`, disabled: locked, onclick: () => ((draft.rarity = r), draw()) }, r))),
          h('label', { class: 'field' }, 'Describe it (players see this)', h('textarea', { rows: 2, maxLength: 1000, disabled: locked, value: draft.description, oninput: (e) => (draft.description = e.target.value) })),
          lookEditor(draft, locked),
          h('details', {}, h('summary', {}, 'Supply and trading (optional)'),
            h('label', { class: 'field' }, 'How many can exist (empty: no limit)', h('input', { value: draft.maxSupply, inputMode: 'numeric', oninput: (e) => (draft.maxSupply = e.target.value.replace(/\D/g, '')) })),
            h('label', { class: 'w3-row' }, h('input', { type: 'checkbox', style: 'width:auto', checked: draft.soulbound, disabled: locked, onchange: (e) => (draft.soulbound = e.target.checked) }), 'Can’t be traded (stays with the player who got it)')),
          error ? h('p', { class: 'note error' }, error) : null,
          h('div', { class: 'w3-row' },
            h('button', { class: 'primary', 'data-testid': 'item-save', onclick: save }, item ? 'Save' : 'Add item'),
            h('button', { onclick: m.close }, 'Cancel'),
            item && !item.listed ? h('button', { onclick: () => (m.close(), run('Item deleted.', () => t.api('/item/remove', { id: item.id }))) }, 'Delete') : null),
        );
      };
      async function save() {
        const body = { ...(draft.id ? { id: draft.id } : {}), price: draft.price, maxSupply: draft.maxSupply };
        if (!locked) Object.assign(body, { name: draft.name, picture: draft.picture ?? undefined, rarity: draft.rarity, description: draft.description, soulbound: draft.soulbound, look: draft.look });
        try {
          await t.api('/item/save', body);
          m.close();
          message = { kind: 'ok', text: item ? 'Item saved. Put it on sale to make the change live.' : 'Item added. Put it on sale when you’re ready.' };
          refresh();
        } catch (e) {
          error = e.message;
          draw();
        }
      }
      draw();
    }

    function boxDialog(box) {
      const items = shop()?.items ?? [];
      const weights = state.rules.weights;
      const draft = {
        id: box?.id,
        name: box?.name ?? 'Mystery Box',
        price: box ? fromUnits(box.price, decimals()) : '',
        picked: box ? box.entries.map((e) => e.item) : items.slice(0, 8).map((i) => i.id),
        custom: Boolean(box),
        weights: Object.fromEntries((box?.entries ?? []).map((e) => [e.item, String(e.weight)])),
      };
      let error = '';
      const weightOf = (id) => (draft.custom && draft.weights[id] ? Number(draft.weights[id]) || 0 : weights[items.find((i) => i.id === id)?.rarity] ?? 1);
      const m = modal();
      const draw = () => {
        const total = draft.picked.reduce((n, id) => n + weightOf(id), 0);
        fill(m.el, 
          h('h3', {}, box ? 'Edit loot box' : 'Make a loot box'),
          h('p', { class: 'dim' }, 'Players pay once and get one of these at random (MagicBlock VRF). Rarer items come up less often.'),
          h('div', { class: 'w3-row' },
            h('label', { class: 'field grow' }, 'Name', h('input', { value: draft.name, maxLength: 40, 'data-testid': 'box-name', oninput: (e) => (draft.name = e.target.value) })),
            h('label', { class: 'field grow' }, `Price in ${unit()}`, h('input', { value: draft.price, inputMode: 'decimal', placeholder: '1', 'data-testid': 'box-price', oninput: (e) => (draft.price = e.target.value.replace(/[^0-9.]/g, '')) }))),
          h('label', { class: 'w3-row' }, h('input', { type: 'checkbox', style: 'width:auto', checked: draft.custom, onchange: (e) => ((draft.custom = e.target.checked), draw()) }), 'Set the odds myself'),
          h('ul', { style: 'list-style:none;padding:0;margin:0;display:grid;gap:6px' }, items.map((i) => {
            const on = draft.picked.includes(i.id);
            return h('li', { class: 'w3-row' },
              h('label', { class: 'w3-row grow' }, h('input', { type: 'checkbox', style: 'width:auto', checked: on, disabled: !on && draft.picked.length >= 8, onchange: () => {
                draft.picked = on ? draft.picked.filter((x) => x !== i.id) : [...draft.picked, i.id];
                draw();
              } }), `${i.name} (${i.rarity})`),
              on && draft.custom ? h('input', { style: 'width:90px', value: draft.weights[i.id] ?? String(weightOf(i.id)), inputMode: 'numeric', oninput: (e) => (draft.weights[i.id] = e.target.value.replace(/\D/g, '')), onchange: draw }) : null,
              on ? h('b', {}, total ? percent(weightOf(i.id) / total) : '–') : null);
          })),
          error ? h('p', { class: 'note error' }, error) : null,
          h('div', { class: 'w3-row' },
            h('button', { class: 'primary', 'data-testid': 'box-save', onclick: save }, box ? 'Save' : 'Add loot box'),
            h('button', { onclick: m.close }, 'Cancel'),
            box && !box.listed ? h('button', { onclick: () => (m.close(), run('Loot box deleted.', () => t.api('/box/remove', { id: box.id }))) }, 'Delete') : null),
        );
      };
      async function save() {
        try {
          await t.api('/box/save', { ...(draft.id ? { id: draft.id } : {}), name: draft.name, price: draft.price, entries: draft.picked.map((id) => ({ item: id, weight: weightOf(id) })) });
          m.close();
          message = { kind: 'ok', text: box ? 'Loot box saved. Put it on sale to make the change live.' : 'Loot box added. Put it on sale when you’re ready.' };
          refresh();
        } catch (e) {
          error = e.message;
          draw();
        }
      }
      draw();
    }

    function publishBar() {
      const s = shop();
      const items = s?.items ?? [];
      const waiting = items.filter((i) => itemState(i).state !== 'published' && (i.picture || i.image)).length + (s?.boxes ?? []).filter((b) => boxState(b).state !== 'published').length;
      const noPicture = items.filter((i) => !i.picture && !i.image).length;
      return h('div', { class: 'card w3-bar', 'data-testid': 'shop-publish' },
        h('div', {},
          h('strong', {}, waiting ? `${waiting} change${waiting === 1 ? '' : 's'} ready to go live` : live() ? 'Everything is on sale' : 'Add an item to open your shop'),
          h('p', { class: 'dim' }, live() ? `Priced in ${unit()}. One wallet approval puts changes live.` : 'One wallet approval opens the shop. Your wallet controls the collection, not games.fun.',
            noPicture ? ` ${noPicture} item${noPicture === 1 ? ' needs' : 's need'} a picture first.` : '')),
        h('button', { class: 'primary', 'data-testid': 'shop-publish-go', disabled: !waiting, onclick: publish }, 'Put it on sale'));
    }

    function render() {
      if (!state) return;
      const s = shop();
      const body = [];
      if (flow) {
        body.push(approvalPanel(t, flow, {
          onDone: () => {
            message = { kind: 'ok', text: 'On sale. Players can buy in your game now.' };
            flow = null;
            refresh();
          },
          onClose: () => ((flow = null), refresh()),
        }));
      } else {
        body.push(...requestBanner(t, state, 'publish', { onReview: async (r) => {
          try {
            if (!t.wallet.address()) await t.wallet.connect();
            flow = await t.api('/flow/start', { requestId: r.id, wallet: t.wallet.address() });
          } catch (error) {
            message = { kind: 'error', text: error.message };
          }
          render();
        }, onDone: refresh }));
        body.push(
          h('p', { class: 'dim' }, `Sell items and loot boxes for ${state.game.title}. Players keep what they get as collectibles (Metaplex Core NFTs) in their wallet. games.fun’s loot program keeps ${state.network.platformFeeBps / 100}% of each sale.`),
          payPicker(),
          h('div', {}, h('h3', {}, 'Items'), h('div', { class: 'grid', 'data-testid': 'shop-items' }, (s?.items ?? []).map(itemCard), h('button', { class: 'tile', 'data-testid': 'shop-add-item', onclick: () => itemDialog(null) }, h('strong', {}, '+ Add an item'), h('span', { class: 'dim' }, 'A skin, a hat, a trophy…')))),
          h('div', {}, h('h3', {}, 'Loot boxes'), h('div', { class: 'grid', 'data-testid': 'shop-boxes' }, (s?.boxes ?? []).map(boxCard), h('button', { class: 'tile', 'data-testid': 'shop-add-box', disabled: !s?.items?.length, onclick: () => boxDialog(null) }, h('strong', {}, '+ Make a loot box'), h('span', { class: 'dim' }, s?.items?.length ? 'Players pay once and get one item at random.' : 'Add an item first.')))),
          publishBar(),
        );
        if (s?.collection) body.push(h('p', { class: 'dim mono' }, 'Collection ', h('a', { href: state.network.explorer.replace('{kind}', 'address').replace('{id}', s.collection), target: '_blank', rel: 'noreferrer' }, s.collection)));
      }
      fill(root, header(), message ? note(message.kind, message.text) : null, state.chainError ? note('error', state.chainError) : null, ...body);
    }

    refresh();
    const stop = keepFresh(ctx, el, t, { busy: () => Boolean(flow), refresh, render });
    return () => {
      stop();
      el.replaceChildren();
    };
  },
};
