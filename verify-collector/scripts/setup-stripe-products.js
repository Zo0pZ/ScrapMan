/* Run once (per Stripe account) to create the two products/prices this app charges
 * for, then paste the printed price IDs into your .env / cPanel env vars.
 *
 *   node scripts/setup-stripe-products.js
 *
 * Safe to re-run, but re-running creates a *second* set of products/prices rather
 * than updating the first — Stripe prices are immutable once created. If you need to
 * change an amount later, create a new price on the existing product in the dashboard
 * (Product catalogue) and update STRIPE_PRICE_UNLOCK / STRIPE_PRICE_PRO instead of
 * running this again.
 */

require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

async function main() {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error("Set STRIPE_SECRET_KEY (in .env or the environment) first — see .env.example.");
    process.exit(1);
  }

  const unlockProduct = await stripe.products.create({ name: "ScrapMan — Job unlock" });
  const unlockPrice = await stripe.prices.create({
    product: unlockProduct.id,
    unit_amount: 150, // £1.50
    currency: "gbp"
  });

  const proProduct = await stripe.products.create({ name: "ScrapMan Pro" });
  const proPrice = await stripe.prices.create({
    product: proProduct.id,
    unit_amount: 699, // £6.99
    currency: "gbp",
    recurring: { interval: "month" }
  });

  const boostProduct = await stripe.products.create({ name: "ScrapMan — Boost my listing" });
  const boostPrice = await stripe.prices.create({
    product: boostProduct.id,
    unit_amount: 199, // £1.99
    currency: "gbp"
  });

  console.log("\nAdd these to your .env / cPanel Node App environment variables:\n");
  console.log(`STRIPE_PRICE_UNLOCK=${unlockPrice.id}`);
  console.log(`STRIPE_PRICE_PRO=${proPrice.id}`);
  console.log(`STRIPE_PRICE_BOOST=${boostPrice.id}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
