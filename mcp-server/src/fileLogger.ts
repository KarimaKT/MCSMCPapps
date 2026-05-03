/**
 * Persistent file logger.
 *
 * On Azure App Service Linux, Node `console.log` lines are streamed by
 * `az webapp log tail` but **not persisted to any file** under
 * /home/LogFiles. That makes after-the-fact debugging impossible — by
 * the time you fetch the logs, the lines are gone.
 *
 * This module mirrors every console.log / console.warn / console.error
 * call into a plain text file at
 * `/home/LogFiles/Application/mcsmcpapps.log` so we can pull it via the
 * Kudu vfs API any time. Fully append-only; rotated weekly by date.
 *
 * # Why not a real logger
 *
 * Pino, winston, etc. all work, but pull in 200kb of dependencies for
 * a problem fs.appendFileSync solves in 10 lines. The tool only writes
 * a few hundred lines per day; sync writes are fine.
 *
 * # Where the file lives
 *
 *   - On App Service Linux: `/home/LogFiles/Application/mcsmcpapps.log`
 *   - Locally: `./mcsmcpapps.log` (next to the dist directory)
 *
 * `/home/LogFiles/` is mounted on a persistent share, accessible via
 * `https://<scm>.scm.azurewebsites.net/api/vfs/LogFiles/Application/mcsmcpapps.log`.
 */

import { appendFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

function pickLogPath(): string {
  // App Service Linux mounts a persistent share at /home/LogFiles.
  try {
    statSync('/home/LogFiles');
    return '/home/LogFiles/Application/mcsmcpapps.log';
  } catch {
    // Local / dev: write next to cwd.
    return './mcsmcpapps.log';
  }
}

const LOG_PATH = pickLogPath();

try {
  mkdirSync(dirname(LOG_PATH), { recursive: true });
} catch {
  // ignore — directory may already exist or be unwritable in dev.
}

function ts(): string {
  return new Date().toISOString();
}

function safeStringify(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function write(level: string, args: unknown[]): void {
  try {
    const msg = args.map(safeStringify).join(' ');
    appendFileSync(LOG_PATH, `${ts()} [${level}] ${msg}\n`, 'utf8');
  } catch {
    // ignore — never let logging crash the request handler.
  }
}

/**
 * Patch global console methods so every existing `console.log` /
 * `console.warn` / `console.error` in the codebase is mirrored to the
 * persistent log file. Original behavior preserved (stdout/stderr).
 */
export function installFileLogger(): void {
  // eslint-disable-next-line no-console
  const origLog = console.log.bind(console);
  // eslint-disable-next-line no-console
  const origWarn = console.warn.bind(console);
  // eslint-disable-next-line no-console
  const origError = console.error.bind(console);

  // eslint-disable-next-line no-console
  console.log = (...args: unknown[]) => {
    write('log', args);
    origLog(...args);
  };
  // eslint-disable-next-line no-console
  console.warn = (...args: unknown[]) => {
    write('warn', args);
    origWarn(...args);
  };
  // eslint-disable-next-line no-console
  console.error = (...args: unknown[]) => {
    write('error', args);
    origError(...args);
  };

  // eslint-disable-next-line no-console
  console.log(`[file-logger] writing to ${LOG_PATH}`);
}
