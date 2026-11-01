'use strict';
/**
 * Plugin loader. Every directory under src/plugins/ with an index.js is a
 * plugin. A plugin exports a plain object:
 *
 *   module.exports = {
 *     name: 'kyc',                         // required; also the key used for config[name] and ctx[name]
 *     schema: 'CREATE TABLE IF NOT EXISTS ...',   // optional SQL run at startup (idempotent!)
 *     migrate(db) {},                      // optional: ALTER TABLE etc. (use helpers from db.js)
 *     config(env, h) { return {...} },     // optional: returns config[name]; h = {num,bool,list}
 *     init(ctx) { return services },       // optional: runs after core services exist; return value -> ctx[name]
 *     routes(app, ctx) {},                 // optional: mount Express routes (after core routes, before 404)
 *     jobs(ctx) { return () => stop },     // optional: start background timers; return a stop function
 *     site(ctx) { return {...} },          // optional: extra fields merged into GET /api/site
 *     web: ['js/kyc.js'],                  // optional: browser modules the website loads after the core ones
 *   };
 *
 * A plugin that throws while loading is skipped with an error log, unless
 * config.plugins.strict is true (the default in production), so one broken
 * plugin cannot take the whole platform down in development.
 */
const fs = require('node:fs');
const path = require('node:path');

function loadPlugins({ log = console, strict = false, dir = __dirname } = {}) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const file = path.join(dir, entry.name, 'index.js');
    if (!fs.existsSync(file)) continue;
    try {
      const p = require(file);
      if (!p || typeof p.name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(p.name)) throw new Error('plugin must export { name: "kebab-case" }');
      if (out.some((q) => q.name === p.name)) throw new Error(`duplicate plugin name ${p.name}`);
      p.dir = path.join(dir, entry.name);
      out.push(p);
    } catch (e) {
      if (strict) throw new Error(`Plugin ${entry.name} failed to load: ${e.message}`);
      log.error?.(`[plugins] skipping ${entry.name}: ${e.message}`);
    }
  }
  return out;
}

module.exports = { loadPlugins };
