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
      const { item: bought } = await gfWeb3.shop.buy(item.id, { onStatus: showMessage });   // two approvals: pay, then claim
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

- **A buy is two approvals.** The first pays (`buy_item` opens an order that holds the payment). The
  second claims it (`settle` mints the Core NFT to the player and sends the whole price to the
  creator's treasury). The collectible's address depends on the slot the purchase lands in, so the
  two cannot share a transaction. games.fun's loot program charges the player a flat 0.002 SOL per
  purchase; the order also holds 0.006 SOL until it is claimed, then gives back what is left. For a
  SOL shop, exactly the price is wrapped and then unwrapped around the purchase.
- **A box is two approvals.** The first pays and asks MagicBlock's VRF to roll. A few seconds later
  the kit sees the roll and asks the wallet to claim the item (a permissionless `settle`). If
  everything in the box sold out, the roll fails and the kit asks the wallet to approve a refund.
- **An order the player did not finish** (they declined the claim, closed the page, or the roll was
  slow) stays theirs: `gfWeb3.orders()` lists it and `gfWeb3.finish(order)` claims it, or refunds it
  once the program allows (a failed roll at once, a roll that never came after about 10 minutes, an
  unclaimed order after 7 days).
- **Errors carry plain words for the player.** Show `error.message`. Don't retry a declined
  request on your own.
- **Disable a button while its promise runs.** A second click makes a second purchase.
- **Show the published odds.** They are exactly what the program rolls: sold-out items drop out.
