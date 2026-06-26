import { beforeEach, describe, expect, test } from "bun:test";
import {
  NoteChannel,
  RECONNECT_JITTER_DEFAULT_MS,
  RECONNECT_JITTER_MAX_MS,
  clampReconnectJitter,
  fullJitterDelay,
} from "../src/channel";

let lastWsInstance: any = null;

class MockWebSocket {
  static OPEN = 1;
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((evt: { data: string }) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  sent: string[] = [];
  constructor(_url: string) {
    lastWsInstance = this;
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.onclose = null;
  }
}
(globalThis as any).WebSocket = MockWebSocket;

beforeEach(() => {
  lastWsInstance = null;
});

describe("clampReconnectJitter", () => {
  test("accepts a valid number", () => expect(clampReconnectJitter(8000)).toBe(8000));
  test("clamps above the ceiling", () =>
    expect(clampReconnectJitter(999_999)).toBe(RECONNECT_JITTER_MAX_MS));
  test("rejects negatives / NaN / non-numbers", () => {
    expect(clampReconnectJitter(-1)).toBeNull();
    expect(clampReconnectJitter(NaN)).toBeNull();
    expect(clampReconnectJitter("5000")).toBeNull();
  });
  test("rejects zero (coalesces to default, not no-jitter)", () =>
    expect(clampReconnectJitter(0)).toBeNull());
});

describe("fullJitterDelay", () => {
  test("uniform over [0, window]", () => expect(fullJitterDelay(8000, () => 0.5)).toBe(4000));
  test("zero at rng=0", () => expect(fullJitterDelay(8000, () => 0)).toBe(0));
});

describe("NoteChannel jitter capture", () => {
  test("caches the clamped window from the sync join reply", async () => {
    const channel = new NoteChannel("http://localhost:4000", "key", "42", "7");
    await channel.connect();
    lastWsInstance.onopen?.();
    lastWsInstance.onmessage?.({
      data: JSON.stringify(["1", "1", "sync:42:7", "phx_reply", {
        status: "ok",
        response: { reconnect_jitter_max_ms: 999_999 },
      }]),
    });
    expect(channel.getReconnectJitterMaxMs()).toBe(RECONNECT_JITTER_MAX_MS);
    channel.disconnect();
  });

  test("ignores a malformed window", async () => {
    const channel = new NoteChannel("http://localhost:4000", "key", "42", "7");
    await channel.connect();
    lastWsInstance.onopen?.();
    lastWsInstance.onmessage?.({
      data: JSON.stringify(["1", "1", "sync:42:7", "phx_reply", {
        status: "ok",
        response: { reconnect_jitter_max_ms: "nope" },
      }]),
    });
    expect(channel.getReconnectJitterMaxMs()).toBeNull();
    channel.disconnect();
  });
});
