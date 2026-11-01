import * as SecureStore from 'expo-secure-store';
import { API_URL } from './config';

let token = null;
let onUnauthorized = () => {};

export async function loadToken() {
  token = await SecureStore.getItemAsync('token');
  return token;
}
export async function setToken(t) {
  token = t;
  if (t) await SecureStore.setItemAsync('token', t);
  else await SecureStore.deleteItemAsync('token');
}
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(API_URL + '/api' + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Can't reach the server. Check your connection.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) onUnauthorized();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const fmt = {
  money: (c) => (c === 0 ? 'Free' : `$${(c / 100).toFixed(2)}`),
  mb: (m) => (m >= 1024 ? `${m / 1024} GB` : `${m} MB`),
  bytes: (b) => { if (!b) return '0 B'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.floor(Math.log(b) / Math.log(1024)); return `${(b / 1024 ** i).toFixed(1)} ${u[i]}`; },
  left: (iso) => {
    const ms = new Date(iso) - Date.now(); if (ms <= 0) return 'expired';
    const h = Math.floor(ms / 3600e3), d = Math.floor(h / 24), m = Math.floor((ms % 3600e3) / 60e3);
    return d >= 2 ? `${d} days` : h ? `${h}h ${m}m` : `${m}m`;
  },
};
