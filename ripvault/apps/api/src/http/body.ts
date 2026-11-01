import type { IncomingMessage } from 'node:http';
import { ApiError, badRequest } from '../errors.ts';

export const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

/** Read the whole request body, failing fast (413) once it exceeds `maxBytes`. */
export async function readRawBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declared = req.headers['content-length'];
  if (declared !== undefined && Number(declared) > maxBytes) {
    req.resume();
    throw tooLarge(maxBytes);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    size += buf.length;
    if (size > maxBytes) {
      req.resume();
      throw tooLarge(maxBytes);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function tooLarge(maxBytes: number): ApiError {
  return new ApiError(413, 'bad_request', `Request body must be at most ${Math.floor(maxBytes / 1024)} KB`);
}

/** Parse a JSON body. Empty bodies are `undefined`. */
export function parseJsonBody(raw: Buffer, contentType: string | undefined): unknown {
  if (raw.length === 0) return undefined;
  if (contentType && !/^application\/(.+\+)?json\b/i.test(contentType.trim())) {
    throw badRequest('Content-Type must be application/json');
  }
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw badRequest('Request body is not valid JSON');
  }
}
