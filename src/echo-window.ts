/** How long (ms) a write this device just made can come back as an echo:
 *  after a push, for the WebSocket fan-out; after a remote merge, for an
 *  editor's late save of the buffer the doc already absorbed. */
export const ECHO_COOLDOWN_MS = 5000;
