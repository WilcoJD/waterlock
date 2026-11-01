'use strict';
/**
 * Minimal multipart/form-data parser for document uploads (no dependencies).
 *
 * References:
 *  - RFC 7578 "Returning Values from Forms: multipart/form-data": https://www.rfc-editor.org/rfc/rfc7578
 *    (Content-Disposition: form-data; name="..."; filename="..."; part Content-Type defaults to text/plain)
 *  - RFC 2046 §5.1.1 multipart syntax (CRLF "--" boundary delimiters, "--boundary--" close delimiter,
 *    headers terminated by an empty line): https://www.rfc-editor.org/rfc/rfc2046#section-5.1.1
 *  - RFC 2183 Content-Disposition parameter syntax: https://www.rfc-editor.org/rfc/rfc2183
 *
 * The whole body is already buffered by express.raw() (size-limited), so parsing is a
 * simple scan with Buffer.indexOf. Only what the KYC upload needs is implemented:
 * text fields and file parts; nested multipart/mixed is not supported (RFC 7578 §4.3
 * deprecated it in favour of repeated parts).
 */
const { HttpError } = require('../../provisioner');

const CRLF = Buffer.from('\r\n');
const HEADER_END = Buffer.from('\r\n\r\n');
const MAX_PARTS = 32;
const MAX_FIELD_BYTES = 64 * 1024;

function boundaryOf(contentType) {
  const m = /^multipart\/form-data\s*;.*?boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(String(contentType || ''));
  const b = m && (m[1] || m[2]);
  if (!b || b.length > 200) throw new HttpError(400, 'Expected a multipart/form-data body with a boundary', { code: 'BAD_MULTIPART' });
  return b;
}

/** Parse `name="x"; filename="y"` style parameters (quoted or token values). */
function params(header) {
  const out = {};
  const re = /;\s*([A-Za-z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;\s]*))/g;
  let m;
  while ((m = re.exec(header))) out[m[1].toLowerCase()] = (m[2] !== undefined ? m[2].replace(/\\(.)/g, '$1') : m[3]) || '';
  return out;
}

/**
 * @param {Buffer} body
 * @param {string} contentType request Content-Type header
 * @returns {{ fields: Record<string,string>, files: Array<{ field: string, filename: string, contentType: string, data: Buffer }> }}
 */
function parseMultipart(body, contentType) {
  if (!Buffer.isBuffer(body)) throw new HttpError(400, 'Expected a multipart/form-data body', { code: 'BAD_MULTIPART' });
  const delim = Buffer.from(`--${boundaryOf(contentType)}`);
  const fields = {};
  const files = [];
  let pos = body.indexOf(delim);
  if (pos < 0) throw new HttpError(400, 'Malformed multipart body (no boundary)', { code: 'BAD_MULTIPART' });
  let parts = 0;
  for (;;) {
    pos += delim.length;
    // "--" right after the delimiter means this was the closing delimiter.
    if (body[pos] === 0x2d && body[pos + 1] === 0x2d) break;
    // Skip optional transport padding then CRLF.
    const lineEnd = body.indexOf(CRLF, pos);
    if (lineEnd < 0) throw new HttpError(400, 'Malformed multipart body', { code: 'BAD_MULTIPART' });
    const start = lineEnd + 2;
    const next = body.indexOf(delim, start);
    if (next < 0) throw new HttpError(400, 'Malformed multipart body (unterminated part)', { code: 'BAD_MULTIPART' });
    if (++parts > MAX_PARTS) throw new HttpError(400, 'Too many form parts', { code: 'BAD_MULTIPART' });
    const headEnd = body.indexOf(HEADER_END, start);
    if (headEnd < 0 || headEnd > next) throw new HttpError(400, 'Malformed multipart part headers', { code: 'BAD_MULTIPART' });
    const headers = body.slice(start, headEnd).toString('latin1').split('\r\n');
    let disposition = null, type = 'text/plain';
    for (const h of headers) {
      const i = h.indexOf(':'); if (i < 0) continue;
      const name = h.slice(0, i).trim().toLowerCase(), value = h.slice(i + 1).trim();
      if (name === 'content-disposition') disposition = value;
      else if (name === 'content-type') type = value.split(';')[0].trim().toLowerCase() || 'application/octet-stream';
    }
    if (!disposition || !/^form-data\b/i.test(disposition)) throw new HttpError(400, 'Each part needs Content-Disposition: form-data', { code: 'BAD_MULTIPART' });
    const p = params(disposition);
    if (!p.name) throw new HttpError(400, 'Form part without a name', { code: 'BAD_MULTIPART' });
    // Part body ends with CRLF before the next delimiter.
    const bodyEnd = next - 2;
    const data = body.slice(headEnd + 4, Math.max(headEnd + 4, bodyEnd));
    if (p.filename !== undefined) {
      // RFC 7578 §4.2: never trust the path; keep a sanitised base name only.
      const filename = String(p.filename).split(/[\\/]/).pop().replace(/[^\w .()-]/g, '_').slice(0, 120);
      files.push({ field: p.name, filename, contentType: type, data });
    } else {
      if (data.length > MAX_FIELD_BYTES) throw new HttpError(400, `Field ${p.name} is too long`, { code: 'BAD_MULTIPART' });
      fields[p.name] = data.toString('utf8');
    }
    pos = next;
  }
  return { fields, files };
}

module.exports = { parseMultipart, boundaryOf };
