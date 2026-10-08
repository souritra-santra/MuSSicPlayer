import { configureArtworkCache } from '@/services/cache/artwork';
import { registerAllProviders } from '@/services/providers';

/**
 * Startup work that must happen before the first render, but that would be
 * awkward as module side effects.
 *
 * The database is deliberately *not* opened here: it is initialised through
 * `useDatabase()` so a failure surfaces as a recoverable error state on the
 * first screen rather than a blank splash screen that never goes away.
 */

let started = false;

/**
 * Steps that completed during startup, in order.
 *
 * Startup is a chain of fallible steps run from a single effect. Without a label
 * any failure collapses into an anonymous stack frame inside a minified bundle,
 * which tells nobody anything — so the trail is recorded and the failing step's
 * name is baked into the error the UI shows.
 */
const trail: string[] = [];

/** Runs one startup step, labelling both success and failure. */
export function startupStep<T>(label: string, run: () => T): T {
  try {
    const result = run();
    trail.push(label);
    return result;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    const error = new Error(
      `Startup failed at "${label}", after: ${trail.join(', ') || 'nothing'}. ${detail}`,
    );
    error.cause = cause;
    throw error;
  }
}

/** Startup steps that have completed so far. Exposed for debugging. */
export function startupTrace(): readonly string[] {
  return trail;
}

/** Idempotent; safe to call from more than one place. */
export function bootstrap(): void {
  if (started) return;
  started = true;

  startupStep('register providers', registerAllProviders);
  // Must precede the first artwork render, otherwise the first pass through a
  // result list fills an unbounded cache before the ceilings are applied.
  startupStep('configure artwork cache', configureArtworkCache);
}