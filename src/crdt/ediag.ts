// Diagnostic-only console logger for the `diag/crdt-bind-console` build. This is
// INTENTIONAL console output at Default level (plain console.log survives the
// prod esbuild, unlike devLog which tree-shakes to a no-op and uses the hidden
// console.debug) so Todd can copy the exact keystroke path from the browser
// console. This branch is a diagnostic probe and NEVER merges.
// biome-ignore lint/suspicious/noConsole: diagnostic-only build, not for merge
export const ediag = (...args: unknown[]): void => console.log(...args);
