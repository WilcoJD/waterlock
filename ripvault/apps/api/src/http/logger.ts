/** Structured one-line JSON logs. Never pass secrets, tokens or request bodies in `fields`. */
export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export function createLogger(): Logger {
  const write = (level: string, msg: string, fields?: Record<string, unknown>) => {
    const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields });
    if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
  };
  return {
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
  };
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

/** Collects log lines in memory (tests). */
export function memoryLogger(): Logger & { lines: { level: string; msg: string; fields?: Record<string, unknown> }[] } {
  const lines: { level: string; msg: string; fields?: Record<string, unknown> }[] = [];
  return {
    lines,
    info: (msg, fields) => void lines.push({ level: 'info', msg, fields }),
    warn: (msg, fields) => void lines.push({ level: 'warn', msg, fields }),
    error: (msg, fields) => void lines.push({ level: 'error', msg, fields }),
  };
}
