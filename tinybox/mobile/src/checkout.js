import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { api } from './api';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Create a Stripe Checkout session on the backend, open it in an in-app
 * browser, then wait for the webhook to fulfil the order.
 * Returns { order, server, root_password } or null if the user cancelled.
 *
 * NOTE on store policies: Apple/Google may require in-app purchase for
 * digital goods. See README "App store payments" before shipping.
 */
export async function checkout(body) {
  const returnUrl = Linking.createURL('order');
  const r = await api('POST', '/shop/checkout', { ...body, return_url: returnUrl });
  if (!r.mock) {
    const res = await WebBrowser.openAuthSessionAsync(r.url, returnUrl);
    if (res.type !== 'success' || /cancelled=1/.test(res.url || '')) {
      // User may have paid then closed the sheet; check once before giving up.
      const o = await api('GET', `/shop/orders/${r.order_id}`);
      return o.order.status === 'pending' ? null : o;
    }
  }
  for (let i = 0; i < 30; i++) {
    const o = await api('GET', `/shop/orders/${r.order_id}`);
    if (o.order.status !== 'pending') return o;
    await sleep(2000);
  }
  throw new Error('Payment is still processing. Your server will appear shortly.');
}
