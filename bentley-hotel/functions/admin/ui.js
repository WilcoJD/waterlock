// PLACEHOLDER — replaced by the full admin front-end (built separately). Keeps the admin module loadable meanwhile.
export function adminHtml({ loggedIn }) {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>Admin | Bentley Hotel</title></head><body><h1>Bentley Hotel admin</h1><p>${loggedIn ? "Logged in." : "Admin front-end not built yet."}</p></body></html>`;
}
