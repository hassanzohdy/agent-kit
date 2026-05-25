import { consola } from "consola";

/**
 * Shared logger instance for the agent-kit CLI and programmatic surfaces.
 *
 * Use this instead of `console.log` so we get consistent formatting and so the
 * test suite can silence output via `logger.pauseLogs()` / `logger.resumeLogs()`.
 */
export const logger = consola.withTag("agent-kit");
