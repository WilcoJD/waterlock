# Kestrel Hosting: storefront demo

A static, no-build hosting storefront: domains, web hosting, VPS, dedicated servers, email and SSL, with a slide-out basket and a one-page checkout.

## Run

```bash
cd storefront
python3 -m http.server 8080   # or any static server
# open http://localhost:8080
```

## Files

| File | What it holds |
| --- | --- |
| `index.html` | Header, footer, basket drawer shell |
| `data.js` | Product catalogue and prices (GBP, ex. VAT). Edit this to change plans or TLDs |
| `app.js` | Hash router, views, basket, checkout, validation |
| `styles.css` | All styling. Brand colours are CSS variables at the top |

## Features

- Domain search with simulated availability across 12 TLDs, plus a price table
- Plan pages for hosting, VPS, dedicated, email and SSL. The VPS configurator picks OS, location and backups
- Basket drawer with a billing-period picker per line (monthly, 12 or 24 months; 1–5 years for domains) and upsells
- Checkout: express pay buttons, contact, billing (personal or business), payment method, discount codes (`WELCOME10`, `KESTREL20`), VAT breakdown, inline validation, and form state that survives a reload
- Ex/inc VAT toggle, and layouts for phone through desktop

## Going live: what's still mocked

1. **Payments.** No card data is collected. To take payments, replace the demo panel in `#payPanel` with a hosted payment form (e.g. Stripe Payment Element or Checkout, PayPal JS SDK, GoCardless for Direct Debit), create the PaymentIntent on your server, and only show the confirmation page after the provider confirms payment.
2. **Domain availability.** `isAvailable()` in `app.js` is a deterministic fake. Call your registrar or reseller API (e.g. Nominet EPP, OpenSRS, Enom) from a backend.
3. **Orders and provisioning.** `placeOrder()` only stores the order in localStorage. Send it to your backend to create the account, invoice and provisioning jobs.
4. **Prices and discounts.** These are computed in the browser for display only. Recalculate them on the server.
