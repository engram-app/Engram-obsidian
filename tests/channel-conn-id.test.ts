import { NoteChannel } from "../src/channel";

// Capture the URL passed to WebSocket without opening a real socket.
class FakeWS {
	static lastUrl = "";
	static OPEN = 1;
	onopen: (() => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;
	onmessage: (() => void) | null = null;
	readyState = 0;
	constructor(url: string) {
		FakeWS.lastUrl = url;
	}
	close() {}
	send() {}
}

beforeAll(() => {
	// @ts-expect-error test shim
	global.WebSocket = FakeWS;
});

test("mints a fresh conn_id per openSocket and puts it in the URL", async () => {
	const ch = new NoteChannel("http://x", "key-123", "user-1", "vault-9", "dev-1");
	await ch.connect();
	const first = ch.getConnId();
	expect(first).toBeTruthy();
	expect(FakeWS.lastUrl).toContain(`conn_id=${first}`);
	expect(FakeWS.lastUrl).toContain("device_id=dev-1");
	expect(FakeWS.lastUrl).toContain("vault_id=vault-9");

	// A second openSocket (simulate reconnect) mints a NEW id.
	ch.disconnect();
	await ch.connect();
	expect(ch.getConnId()).not.toBe(first);
});
