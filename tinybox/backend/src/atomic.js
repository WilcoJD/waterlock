'use strict';
let n = 0;
/** Run fn inside a (nestable) SQLite savepoint. fn must be synchronous. */
function atomic(db, fn) {
  const sp = `sp${++n}`;
  db.exec(`SAVEPOINT ${sp}`);
  try {
    const r = fn();
    db.exec(`RELEASE ${sp}`);
    return r;
  } catch (e) {
    db.exec(`ROLLBACK TO ${sp}`);
    db.exec(`RELEASE ${sp}`);
    throw e;
  }
}

/** Simple async mutex keyed by name (serialises work per market / per user). */
class KeyedMutex {
  constructor() { this.tails = new Map(); }
  run(key, fn) {
    const prev = this.tails.get(key) || Promise.resolve();
    const p = prev.then(fn, fn);
    const tail = p.catch(() => {});
    this.tails.set(key, tail);
    tail.then(() => { if (this.tails.get(key) === tail) this.tails.delete(key); });
    return p;
  }
}

module.exports = { atomic, KeyedMutex };
