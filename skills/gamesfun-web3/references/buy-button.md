# Buy and open-box buttons

The kit gives you data and actions. gf-three's `ctx.ui` has meters, banners and toasts, but no buttons, so draw
the shop as a small DOM overlay from `rules.js` `setup(ctx)` (style it like the game's HUD), and give feedback
with `ctx.ui.toast`. A **Connect** button calls `gfWeb3.connect()`.

```js
import gfWeb3 from './gf/web3/index.js';
await gfWeb3.ready();   // in setup(ctx): gfWeb3.ready().then(drawShop)

for (const item of await gfWeb3.shop.list()) {           // listed items, priced in the shop's currency
  if (!item.forSale) continue;                           // "Loot boxes only" items
  addButton(`${item.name} · ${item.priceText}`, async (button) => {
    button.disabled = true;
    try {
      const { item: bought } = await gfWeb3.shop.buy(item.id);   // one wallet approval: pay, mint, deliver
      celebrate(bought.name);
      await gfWeb3.wearOwned();
    } catch (error) {
      showMessage(error.message);                        // not enough SOL, the player declined…
    } finally {
      button.disabled = false;
    }
  });
}

for (const box of await gfWeb3.boxes()) {
  addButton(`${box.name} · ${box.priceText}`, async () => {
    const { item } = await gfWeb3.openBox(box.id, { onStatus: showMessage });
    celebrate(item.name);
  });
  showOdds(box.odds.map((o) => `${o.item}: ${(o.chance * 100).toFixed(1)}%`));   // always show the odds
}
gfWeb3.on('status', showMessage);   // "Approve the purchase in your wallet…", "Rolling…"
```

- **A buy is one approval.** In a single transaction, `buy_item` and `settle` pay, mint the Core
  NFT and split the payment: the platform takes 5% and the creator's treasury gets the rest. For a
  SOL shop, exactly the price is wrapped and then unwrapped around it.
- **A box is two approvals.** The first pays and asks MagicBlock's VRF to roll. A few seconds later
  the kit sees the roll and asks the wallet to claim the item (a permissionless `settle`). If
  everything in the box sold out, the roll fails and the kit asks the wallet to approve a refund.
- **Errors carry plain words for the player.** Show `error.message`. Don't retry a declined
  request on your own.
- **Disable a button while its promise runs.** A second click makes a second purchase.
- **Show the published odds.** They are exactly what the program rolls: sold-out items drop out.
