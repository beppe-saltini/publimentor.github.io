/**
 * Vitest Global Setup
 * Runs before all test files
 */

// Suppress console output during tests unless DEBUG is set
if (!process.env.DEBUG) {
  const noop = () => {};
  global.console = {
    ...console,
    log: noop,
    warn: noop,
    // Keep error and info for debugging test failures
    error: console.error,
    info: console.info,
  };
}
