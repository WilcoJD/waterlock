'use strict';
/**
 * KYC document storage: content sniffing by magic bytes, random file names under
 * <kyc dir>/<userId>/, optional AES-256-GCM encryption at rest, never served statically.
 *
 * References:
 *  - File signatures (JPEG FF D8 FF, PNG 89 50 4E 47 0D 0A 1A 0A, PDF 25 50 44 46 2D):
 *    https://en.wikipedia.org/wiki/List_of_file_signatures
 *  - PNG spec signature: https://www.w3.org/TR/png-3/#5PNG-file-signature
 *  - PDF header "%PDF-" (ISO 32000-1 §7.5.2): https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf
 *  - Node crypto AES-GCM: https://nodejs.org/api/crypto.html#class-cipher
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { HttpError } = require('../../provisioner');

const SIGNATURES = [
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', mime: 'image/png', test: (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a },
  { ext: 'pdf', mime: 'application/pdf', test: (b) => b.length > 5 && b.slice(0, 5).toString('latin1') === '%PDF-' },
];

/** Returns { ext, mime } for jpg/png/pdf, or null for anything else. The client's Content-Type is ignored. */
function detectType(buf) {
  if (!Buffer.isBuffer(buf)) return null;
  return SIGNATURES.find((s) => s.test(buf)) || null;
}

const SAFE_REL = /^\d+\/[a-f0-9]{32}\.(jpg|png|pdf)(\.enc)?$/;

class FileStore {
  /**
   * @param {{ dir: string, key?: string, log?: object }} opts dir = base directory (created 0700); key = passphrase for at-rest encryption ('' = plain)
   */
  constructor({ dir, key = '', log = console }) {
    this.dir = path.resolve(dir);
    this.log = log;
    this.key = key ? crypto.createHash('sha256').update(String(key)).digest() : null;
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }

  static tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'tinybox-kyc-')); }

  get encrypted() { return !!this.key; }

  _abs(rel) {
    if (!SAFE_REL.test(rel)) throw new HttpError(400, 'Bad document path');
    const abs = path.join(this.dir, rel);
    if (!abs.startsWith(this.dir + path.sep)) throw new HttpError(400, 'Bad document path');
    return abs;
  }

  /** Store a buffer for a user. Returns { path (relative), size, sha256, mime, ext }. */
  save(userId, buf) {
    const type = detectType(buf);
    if (!type) throw new HttpError(400, 'Only JPEG, PNG or PDF files are accepted', { code: 'UNSUPPORTED_FILE_TYPE' });
    const name = crypto.randomBytes(16).toString('hex');
    const rel = `${Number(userId)}/${name}.${type.ext}${this.key ? '.enc' : ''}`;
    const abs = this._abs(rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true, mode: 0o700 });
    let data = buf;
    if (this.key) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
      const ct = Buffer.concat([cipher.update(buf), cipher.final()]);
      data = Buffer.concat([iv, cipher.getAuthTag(), ct]);
    }
    fs.writeFileSync(abs, data, { mode: 0o600, flag: 'wx' });
    return { path: rel, size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), mime: type.mime, ext: type.ext };
  }

  /** Read (and decrypt) a stored document. */
  read(rel) {
    const data = fs.readFileSync(this._abs(rel));
    if (!rel.endsWith('.enc')) return data;
    if (!this.key) throw new HttpError(500, 'Document is encrypted but COMPLIANCE_FILE_KEY is not set');
    const iv = data.subarray(0, 12), tag = data.subarray(12, 28), ct = data.subarray(28);
    const d = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]);
  }

  remove(rel) {
    try { fs.unlinkSync(this._abs(rel)); } catch (e) { if (e.code !== 'ENOENT') this.log.warn?.('[compliance] could not delete document', e.message); }
  }
}

module.exports = { FileStore, detectType };
