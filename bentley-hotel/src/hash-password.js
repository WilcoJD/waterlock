#!/usr/bin/env node
// Makes an ADMIN_PASSWORD_HASH value for Cloudflare Pages (so the real password is never stored).
//   node src/hash-password.js            (prompts)
//   node src/hash-password.js 'secret'   (argument)
import { hashPassword } from "../functions/_lib/auth.js";
import { createInterface } from "node:readline/promises";

const arg = process.argv[2];
const password = arg || (await createInterface({ input: process.stdin, output: process.stdout }).question("Password: "));
if (!password || password.length < 12) {
  console.error("Use at least 12 characters.");
  process.exit(1);
}
console.log(await hashPassword(password));
