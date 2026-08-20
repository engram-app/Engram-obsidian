/**
 * Tests for api.ts — utility functions and EngramApi method behavior.
 */
import { afterAll, beforeEach, describe, expect, type Mock, mock, test } from "bun:test";
import { requestUrl } from "obsidian";
import {
	arrayBufferToBase64,
	base64ToArrayBuffer,
	EngramApi,
	RequestTimeoutError,
} from "../src/api";
import type { AuthProvider } from "../src/auth";
import { LimitExceededError } from "../src/limit-error";

// requestUrl is mocked via tests/preload.ts — it is already a mock() instance
const mockRequestUrl = requestUrl as unknown as Mock<() => Promise<any>>;

beforeEach(() => {
	mockRequestUrl.mockReset();
});

// ---------------------------------------------------------------------------
// arrayBufferToBase64 / base64ToArrayBuffer
// ---------------------------------------------------------------------------

describe("arrayBufferToBase64", () => {
	test("encodes empty buffer", () => {
		const buf = new ArrayBuffer(0);
		expect(arrayBufferToBase64(buf)).toBe("");
	});

	test("encodes simple ASCII", () => {
		const encoder = new TextEncoder();
		const buf = encoder.encode("hello").buffer;
		expect(arrayBufferToBase64(buf)).toBe(btoa("hello"));
	});

	test("encodes binary data", () => {
		const bytes = new Uint8Array([0, 128, 255]);
		const result = arrayBufferToBase64(bytes.buffer);
		// Decode and verify round-trip
		const decoded = base64ToArrayBuffer(result);
		expect(new Uint8Array(decoded)).toEqual(bytes);
	});
});

describe("base64ToArrayBuffer", () => {
	test("decodes empty string", () => {
		const buf = base64ToArrayBuffer("");
		expect(buf.byteLength).toBe(0);
	});

	test("decodes simple ASCII", () => {
		const buf = base64ToArrayBuffer(btoa("hello"));
		const text = new TextDecoder().decode(buf);
		expect(text).toBe("hello");
	});

	test("round-trips with arrayBufferToBase64", () => {
		const original = new Uint8Array([1, 2, 3, 100, 200, 255]);
		const encoded = arrayBufferToBase64(original.buffer);
		const decoded = new Uint8Array(base64ToArrayBuffer(encoded));
		expect(decoded).toEqual(original);
	});
});

// ---------------------------------------------------------------------------
// EngramApi
// ---------------------------------------------------------------------------

const TEST_SERVER = "http://localhost:8000";
const TEST_API_BASE = `${TEST_SERVER}/api`;
const TEST_KEY = "engram_testkey";

describe("EngramApi", () => {
	let api: EngramApi;

	beforeEach(() => {
		api = new EngramApi(TEST_SERVER, TEST_KEY);
	});

	describe("updateConfig", () => {
		test("strips trailing slashes and appends /api", () => {
			api.updateConfig("http://example.com///", "key2");
			mockRequestUrl.mockResolvedValueOnce({ status: 200, json: { status: "ok" } } as any);
			api.health();
			expect(mockRequestUrl).toHaveBeenCalledWith(
				expect.objectContaining({ url: "http://example.com/api/health" }),
			);
		});

		test("does not double-append /api if already present", () => {
			api.updateConfig("http://example.com/api", "key2");
			mockRequestUrl.mockResolvedValueOnce({ status: 200, json: { status: "ok" } } as any);
			api.health();
			expect(mockRequestUrl).toHaveBeenCalledWith(
				expect.objectContaining({ url: "http://example.com/api/health" }),
			);
		});
	});

	describe("health", () => {
		test("returns true on 200", async () => {
			mockRequestUrl.mockResolvedValueOnce({ status: 200, json: {} } as any);
			expect(await api.health()).toBe(true);
		});

		test("returns false on error", async () => {
			mockRequestUrl.mockRejectedValueOnce(new Error("network"));
			expect(await api.health()).toBe(false);
		});

		test("does not send auth header", async () => {
			mockRequestUrl.mockResolvedValueOnce({ status: 200, json: {} } as any);
			await api.health();
			const opts = mockRequestUrl.mock.calls[0][0] as any;
			expect(opts.headers?.Authorization).toBeUndefined();
		});
	});

	describe("ping", () => {
		test("returns ok on success", async () => {
			mockRequestUrl.mockResolvedValueOnce({ status: 200, json: [] } as any);
			const result = await api.ping();
			expect(result).toEqual({ ok: true });
		});

		test("returns invalid API key on 401", async () => {
			mockRequestUrl.mockRejectedValueOnce({ status: 401 });
			const result = await api.ping();
			expect(result).toEqual({ ok: false, error: "Invalid API key" });
		});

		test("returns connection failed on errors with no HTTP status", async () => {
			mockRequestUrl.mockRejectedValueOnce(new Error("timeout"));
			const result = await api.ping();
			expect(result).toEqual({ ok: false, error: "Connection failed" });
		});

		test("surfaces the HTTP status on other failures (e.g. 404 wrong vault)", async () => {
			// A stale token hitting a vault it doesn't own returns 404, not 401.
			// Collapsing it to "Connection failed" hid the real cause for hours —
			// the status must reach the caller's error.
			mockRequestUrl.mockRejectedValueOnce({ status: 404 });
			const result = await api.ping();
			expect(result.ok).toBe(false);
			expect(result.error).toContain("404");
		});
	});

	describe("pushNote", () => {
		test("sends POST with path, content, mtime", async () => {
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				json: { path: "Notes/Test.md", status: "created" },
			} as any);
			const result = await api.pushNote("Notes/Test.md", "# Hello", 1234567890);
			expect(mockRequestUrl).toHaveBeenCalledWith(
				expect.objectContaining({
					method: "POST",
					url: `${TEST_API_BASE}/notes`,
					body: JSON.stringify({
						path: "Notes/Test.md",
						content: "# Hello",
						mtime: 1234567890,
					}),
				}),
			);
			expect(result).toEqual({ path: "Notes/Test.md", status: "created" });
		});

		test("returns conflict response on 409 with json body", async () => {
			const conflictBody = {
				conflict: true,
				server_note: { path: "test.md", content: "server", version: 5, mtime: 100 },
			};
			mockRequestUrl.mockRejectedValueOnce({ status: 409, json: conflictBody });
			const result = await api.pushNote("test.md", "local", 100, 3);
			expect("conflict" in result).toBe(true);
		});

		test("returns conflict response on 409 without json (text body only)", async () => {
			// Obsidian requestUrl may throw without .json on non-2xx
			mockRequestUrl.mockRejectedValueOnce({
				status: 409,
				text: '{"conflict":true,"server_note":{"path":"test.md","content":"server","version":5,"mtime":100}}',
			});
			const result = await api.pushNote("test.md", "local", 100, 3);
			expect("conflict" in result).toBe(true);
		});

		test("throws on non-409 errors", async () => {
			mockRequestUrl.mockRejectedValueOnce({ status: 500 });
			await expect(api.pushNote("test.md", "content", 100)).rejects.toEqual({ status: 500 });
		});

		test("sends a client-minted note id under the body key `id`, not `client_id`", async () => {
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				json: { path: "new.md", status: "created" },
			} as any);
			await api.pushNote("new.md", "body", 100, undefined, "0199f0-uuid7");
			const opts = mockRequestUrl.mock.calls[0][0] as any;
			const body = JSON.parse(opts.body);
			expect(body.id).toBe("0199f0-uuid7");
			expect(body.client_id).toBeUndefined();
		});
	});

	// -------------------------------------------------------------------------
	// Distributed tracing: performance contract (see plan Global Constraints).
	// Disabled must be a single boolean check: no id generation, no header, no
	// timing capture, no network. Enabled must inject the header and enqueue
	// exactly one obsidian.push span on the beacon buffer, off the critical path.
	// -------------------------------------------------------------------------
	describe("tracing", () => {
		test("disabled (default): sendRequest adds no traceparent header and enqueues nothing", async () => {
			const enqueueSpy = mock(() => {});
			(api as unknown as { beacon: { enqueue: typeof enqueueSpy } }).beacon.enqueue =
				enqueueSpy;
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				json: { path: "Notes/Test.md", status: "created" },
			} as any);

			await api.pushNote("Notes/Test.md", "# Hello", 1234567890);

			const opts = mockRequestUrl.mock.calls[0]?.[0] as any;
			expect(opts.headers?.traceparent).toBeUndefined();
			expect(enqueueSpy).not.toHaveBeenCalled();
		});

		test("enabled: sendRequest adds a traceparent header and enqueues exactly one obsidian.push span", async () => {
			api.setTracingEnabled(true);
			const enqueueSpy = mock(() => {});
			(api as unknown as { beacon: { enqueue: typeof enqueueSpy } }).beacon.enqueue =
				enqueueSpy;
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				json: { path: "Notes/Test.md", status: "created" },
			} as any);

			await api.pushNote("Notes/Test.md", "# Hello", 1234567890);

			const opts = mockRequestUrl.mock.calls[0]?.[0] as any;
			expect(opts.headers?.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
			expect(enqueueSpy).toHaveBeenCalledTimes(1);
			const span = enqueueSpy.mock.calls[0]?.[0] as {
				name: string;
				trace_id: string;
				parent_span_id: string;
			};
			expect(span.name).toBe("obsidian.push");
			expect(span.trace_id).toHaveLength(32);
			expect(span.parent_span_id).toHaveLength(16);
		});

		test("enabled but request fails: beacon still fires (never blocks/fails the push)", async () => {
			api.setTracingEnabled(true);
			const enqueueSpy = mock(() => {});
			(api as unknown as { beacon: { enqueue: typeof enqueueSpy } }).beacon.enqueue =
				enqueueSpy;
			mockRequestUrl.mockRejectedValueOnce({ status: 500 });

			await expect(api.pushNote("test.md", "content", 100)).rejects.toEqual({ status: 500 });

			expect(enqueueSpy).toHaveBeenCalledTimes(1);
		});

		test("enabled with GET: sendRequest adds NO traceparent header and enqueues NOTHING", async () => {
			api.setTracingEnabled(true);
			const enqueueSpy = mock(() => {});
			(api as unknown as { beacon: { enqueue: typeof enqueueSpy } }).beacon.enqueue =
				enqueueSpy;
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				json: { notes: [], attachments: [] },
			} as any);

			await api.getManifest();

			const opts = mockRequestUrl.mock.calls[0]?.[0] as any;
			expect(opts.headers?.traceparent).toBeUndefined();
			expect(enqueueSpy).not.toHaveBeenCalled();
		});

		test("enabled with mutation (POST): beacon includes engram.event_type attribute set to lowercased method", async () => {
			api.setTracingEnabled(true);
			const enqueueSpy = mock(() => {});
			(api as unknown as { beacon: { enqueue: typeof enqueueSpy } }).beacon.enqueue =
				enqueueSpy;
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				json: { path: "Notes/Test.md", status: "created" },
			} as any);

			await api.pushNote("Notes/Test.md", "# Hello", 1234567890);

			const opts = mockRequestUrl.mock.calls[0]?.[0] as any;
			expect(opts.headers?.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
			expect(enqueueSpy).toHaveBeenCalledTimes(1);
			const span = enqueueSpy.mock.calls[0]?.[0] as {
				name: string;
				trace_id: string;
				parent_span_id: string;
				attributes: Record<string, string>;
			};
			expect(span.attributes["engram.event_type"]).toBe("post");
		});

		test("enabled with DELETE mutation: beacon includes engram.event_type attribute set to 'delete'", async () => {
			api.setTracingEnabled(true);
			const enqueueSpy = mock(() => {});
			(api as unknown as { beacon: { enqueue: typeof enqueueSpy } }).beacon.enqueue =
				enqueueSpy;
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				json: { status: "deleted" },
			} as any);

			await api.deleteNote("Notes/Test.md");

			const opts = mockRequestUrl.mock.calls[0]?.[0] as any;
			expect(opts.headers?.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
			expect(enqueueSpy).toHaveBeenCalledTimes(1);
			const span = enqueueSpy.mock.calls[0]?.[0] as {
				attributes: Record<string, string>;
			};
			expect(span.attributes["engram.event_type"]).toBe("delete");
		});

		test("enabled with GET case-insensitive: still no tracing", async () => {
			// Verify that method case-sensitivity is handled (e.g. "get", "Get", "GET")
			api.setTracingEnabled(true);
			const enqueueSpy = mock(() => {});
			(api as unknown as { beacon: { enqueue: typeof enqueueSpy } }).beacon.enqueue =
				enqueueSpy;
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				json: { user: { id: "user-1", email: "test@example.com" } },
			} as any);

			await api.getMe();

			const opts = mockRequestUrl.mock.calls[0]?.[0] as any;
			expect(opts.headers?.traceparent).toBeUndefined();
			expect(enqueueSpy).not.toHaveBeenCalled();
		});
	});

	describe("deleteNote", () => {
		test("sends DELETE with encoded path", async () => {
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				json: { status: "deleted" },
			} as any);
			await api.deleteNote("Notes/My File.md");
			const opts = mockRequestUrl.mock.calls[0][0] as any;
			expect(opts.method).toBe("DELETE");
			expect(opts.url).toContain("Notes/My%20File.md");
			expect(opts.url).not.toContain("%2F");
		});
	});

	describe("getManifest", () => {
		test("returns manifest on success", async () => {
			const manifest = { notes: {}, attachments: {} };
			mockRequestUrl.mockResolvedValueOnce({ status: 200, json: manifest } as any);
			expect(await api.getManifest()).toEqual(manifest);
		});

		test("returns null on 404", async () => {
			mockRequestUrl.mockRejectedValueOnce({ status: 404 });
			expect(await api.getManifest()).toBeNull();
		});

		test("rethrows non-404 errors", async () => {
			mockRequestUrl.mockRejectedValueOnce({ status: 500 });
			await expect(api.getManifest()).rejects.toEqual({ status: 500 });
		});

		test("passes since_seq and surfaces the unchanged short-circuit (Phase E1)", async () => {
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				json: { unchanged: true, change_seq: 42 },
			} as any);
			const res = await api.getManifest(42);
			const req = mockRequestUrl.mock.calls.at(-1)?.[0] as { url: string };
			expect(req.url).toContain("/sync/manifest?since_seq=42");
			expect(res?.unchanged).toBe(true);
			expect(res?.change_seq).toBe(42);
		});

		test("omits since_seq when not a non-negative finite number", async () => {
			mockRequestUrl.mockResolvedValueOnce({ status: 200, json: { notes: [] } } as any);
			await api.getManifest(Number.NaN);
			const req = mockRequestUrl.mock.calls.at(-1)?.[0] as { url: string };
			expect(req.url).not.toContain("since_seq");
		});
	});

	describe("search", () => {
		test("sends query only when no optional params", async () => {
			mockRequestUrl.mockResolvedValueOnce({ status: 200, json: { results: [] } } as any);
			await api.search("test query");
			const opts = mockRequestUrl.mock.calls[0][0] as any;
			expect(JSON.parse(opts.body)).toEqual({ query: "test query" });
		});

		test("includes limit and tags when provided", async () => {
			mockRequestUrl.mockResolvedValueOnce({ status: 200, json: { results: [] } } as any);
			await api.search("q", 5, ["health", "fitness"]);
			const opts = mockRequestUrl.mock.calls[0][0] as any;
			const body = JSON.parse(opts.body);
			expect(body.limit).toBe(5);
			expect(body.tags).toEqual(["health", "fitness"]);
		});

		test("omits tags when empty array", async () => {
			mockRequestUrl.mockResolvedValueOnce({ status: 200, json: { results: [] } } as any);
			await api.search("q", undefined, []);
			const opts = mockRequestUrl.mock.calls[0][0] as any;
			const body = JSON.parse(opts.body);
			expect(body.tags).toBeUndefined();
		});
	});

	describe("authorization header", () => {
		test("all authenticated requests include Bearer token", async () => {
			mockRequestUrl.mockResolvedValue({ status: 200, json: {} } as any);
			await api.pushNote("test.md", "content", 123);
			const opts = mockRequestUrl.mock.calls[0][0] as any;
			expect(opts.headers.Authorization).toBe("Bearer engram_testkey");
		});
	});

	describe("X-Vault-ID header", () => {
		test("includes X-Vault-ID when vaultId is set", async () => {
			api.setVaultId("42");
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				json: { notes: [], attachments: [] },
			} as any);
			await api.getManifest();
			expect(mockRequestUrl).toHaveBeenCalledWith(
				expect.objectContaining({
					headers: expect.objectContaining({
						"X-Vault-ID": "42",
					}),
				}),
			);
		});

		test("omits X-Vault-ID when vaultId is null", async () => {
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				json: { notes: [], attachments: [] },
			} as any);
			await api.getManifest();
			const headers = mockRequestUrl.mock.calls[0][0].headers;
			expect(headers["X-Vault-ID"]).toBeUndefined();
		});

		test("uses the auth provider's vault (OAuth) even when the vaultId field is null", async () => {
			// Regression: OAuth installs left this.vaultId empty while the provider
			// held the bound vault, so vault-scoped REST (e.g. /search) fell back to
			// the user's default vault server-side. The header must use the active vault.
			const provider: AuthProvider = {
				getToken: async () => "oauth-token",
				getVaultId: () => "engram-vault-id",
				isAuthenticated: () => true,
				signOut: () => {},
			};
			api.setAuthProvider(provider);
			api.setVaultId(null);
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				json: { notes: [], attachments: [] },
			} as any);
			await api.getManifest();
			expect(mockRequestUrl.mock.calls[0][0].headers["X-Vault-ID"]).toBe("engram-vault-id");
		});

		test("setVaultId updates the header for subsequent requests", async () => {
			api.setVaultId("10");
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				json: { notes: [], attachments: [] },
			} as any);
			await api.getManifest();
			expect(mockRequestUrl.mock.calls[0][0].headers["X-Vault-ID"]).toBe("10");

			api.setVaultId("20");
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				json: { notes: [], attachments: [] },
			} as any);
			await api.getManifest();
			expect(mockRequestUrl.mock.calls[1][0].headers["X-Vault-ID"]).toBe("20");
		});
	});

	describe("registerVault", () => {
		test("sends POST to /vaults/register with name and client_id", async () => {
			mockRequestUrl.mockResolvedValueOnce({
				status: 201,
				json: { id: "vault-7", name: "My Vault", slug: "my-vault", is_default: true },
			} as any);
			const result = await api.registerVault("My Vault", "abc123hash");
			expect(mockRequestUrl).toHaveBeenCalledWith(
				expect.objectContaining({
					url: `${TEST_API_BASE}/vaults/register`,
					method: "POST",
					body: JSON.stringify({ name: "My Vault", client_id: "abc123hash" }),
				}),
			);
			expect(result).toEqual({
				id: "vault-7",
				name: "My Vault",
				slug: "my-vault",
				is_default: true,
			});
		});

		test("returns existing vault on 200", async () => {
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				json: { id: "vault-5", name: "Existing", slug: "existing", is_default: false },
			} as any);
			const result = await api.registerVault("Existing", "def456hash");
			expect(result).toEqual({
				id: "vault-5",
				name: "Existing",
				slug: "existing",
				is_default: false,
			});
		});

		test("throws LimitExceededError on 402", async () => {
			const error = {
				status: 402,
				json: {
					error: "limit_exceeded",
					reason: "vaults_cap_exceeded",
					limit_key: "vaults_cap",
					limit: 1,
					current: 1,
					upgrade_url: "https://app.engram.page/settings/billing",
				},
			};
			mockRequestUrl.mockRejectedValueOnce(error);
			await expect(api.registerVault("Third Vault", "ghi789hash")).rejects.toBeInstanceOf(
				LimitExceededError,
			);
		});
	});

	// -------------------------------------------------------------------------
	// 402 standardization — see spec §4.6
	// All write paths returning 402 must surface a LimitExceededError carrying
	// the structured body (reason / limit_key / limit / current / upgrade_url)
	// so callers (toast handler, Sync Center) can route on `reason` without
	// re-parsing JSON.
	// -------------------------------------------------------------------------
	describe("402 LimitExceededError parsing", () => {
		const STANDARD_BODY = {
			error: "limit_exceeded",
			reason: "notes_cap_exceeded",
			limit_key: "notes_cap",
			limit: 10000,
			current: 10000,
			upgrade_url: "https://app.engram.page/settings/billing",
		};

		test("pushNote throws LimitExceededError carrying all fields", async () => {
			mockRequestUrl.mockRejectedValueOnce({ status: 402, json: STANDARD_BODY });
			try {
				await api.pushNote("Notes/Test.md", "# Hello", 1234567890);
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(LimitExceededError);
				const limitErr = err as LimitExceededError;
				expect(limitErr.reason).toBe("notes_cap_exceeded");
				expect(limitErr.upgradeUrl).toBe("https://app.engram.page/settings/billing");
				expect(limitErr.limitKey).toBe("notes_cap");
				expect(limitErr.limit).toBe(10000);
				expect(limitErr.current).toBe(10000);
			}
		});

		test("pushAttachment throws LimitExceededError (file_too_large now 402)", async () => {
			// Backend standardization moved file_too_large from 413 → 402; the
			// plugin's 402 path is the new home for that case too.
			mockRequestUrl.mockRejectedValueOnce({
				status: 402,
				json: {
					error: "limit_exceeded",
					reason: "file_too_large",
					limit_key: "attachment_max_size_bytes",
					limit: 26214400,
					current: 52428800,
					upgrade_url: "https://app.engram.page/settings/billing",
				},
			});
			try {
				await api.pushAttachment("images/big.png", "aGVsbG8=", "image/png", 100);
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(LimitExceededError);
				expect((err as LimitExceededError).reason).toBe("file_too_large");
			}
		});

		test("falls back to 'unknown' reason when body has no reason field", async () => {
			mockRequestUrl.mockRejectedValueOnce({ status: 402, json: {} });
			try {
				await api.pushNote("test.md", "x", 100);
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(LimitExceededError);
				expect((err as LimitExceededError).reason).toBe("unknown");
				expect((err as LimitExceededError).upgradeUrl).toBeNull();
				expect((err as LimitExceededError).limitKey).toBeNull();
				expect((err as LimitExceededError).limit).toBeNull();
				expect((err as LimitExceededError).current).toBeNull();
			}
		});

		test("parses 402 body from text when json is unavailable", async () => {
			// Obsidian requestUrl may throw with `text` only on some platforms.
			mockRequestUrl.mockRejectedValueOnce({
				status: 402,
				text: JSON.stringify(STANDARD_BODY),
			});
			try {
				await api.pushNote("test.md", "x", 100);
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(LimitExceededError);
				expect((err as LimitExceededError).reason).toBe("notes_cap_exceeded");
			}
		});

		test("non-402 errors flow through unchanged", async () => {
			mockRequestUrl.mockRejectedValueOnce({ status: 500 });
			await expect(api.pushNote("test.md", "x", 100)).rejects.not.toBeInstanceOf(
				LimitExceededError,
			);
		});
	});

	describe("getMe", () => {
		test("sends GET /me and returns user object", async () => {
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				json: { user: { id: "user-1", email: "test@example.com" } },
			} as any);
			const result = await api.getMe();
			const opts = mockRequestUrl.mock.calls[0][0] as any;
			expect(opts.method).toBe("GET");
			expect(opts.url).toBe(`${TEST_API_BASE}/me`);
			expect(result).toEqual({ id: "user-1", email: "test@example.com" });
		});
	});

	describe("pushAttachment", () => {
		test("sends POST /attachments with path, content_base64, mime_type, mtime", async () => {
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				json: { path: "images/photo.png", status: "created" },
			} as any);
			const result = await api.pushAttachment(
				"images/photo.png",
				"aGVsbG8=",
				"image/png",
				1234567890,
			);
			const opts = mockRequestUrl.mock.calls[0][0] as any;
			expect(opts.method).toBe("POST");
			expect(opts.url).toBe(`${TEST_API_BASE}/attachments`);
			const body = JSON.parse(opts.body);
			expect(body.path).toBe("images/photo.png");
			expect(body.content_base64).toBe("aGVsbG8=");
			expect(body.mime_type).toBe("image/png");
			expect(body.mtime).toBe(1234567890);
			expect(result).toEqual({ path: "images/photo.png", status: "created" });
		});
	});

	describe("getAttachment", () => {
		test("sends GET /attachments/{encoded_path}", async () => {
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				json: { path: "images/my photo.png", content_base64: "aGVsbG8=" },
			} as any);
			const result = await api.getAttachment("images/my photo.png");
			const opts = mockRequestUrl.mock.calls[0][0] as any;
			expect(opts.method).toBe("GET");
			expect(opts.url).toContain("images/my%20photo.png");
			expect(opts.url).not.toContain("%2F");
			expect(result).toEqual({ path: "images/my photo.png", content_base64: "aGVsbG8=" });
		});
	});

	describe("deleteAttachment", () => {
		test("sends DELETE /attachments/{encoded_path}", async () => {
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				json: { status: "deleted" },
			} as any);
			await api.deleteAttachment("images/photo.png");
			const opts = mockRequestUrl.mock.calls[0][0] as any;
			expect(opts.method).toBe("DELETE");
			expect(opts.url).toContain("images/photo.png");
		});
	});

	describe("pushLogs", () => {
		test("sends POST /logs with entries array", async () => {
			mockRequestUrl.mockResolvedValueOnce({ status: 200, json: {} } as any);
			const entries = [
				{
					ts: "2026-04-12T10:00:00Z",
					level: "info",
					category: "push",
					message: "pushed test.md",
					plugin_version: "0.3.6",
					platform: "desktop",
				},
			];
			await api.pushLogs(entries);
			const opts = mockRequestUrl.mock.calls[0][0] as any;
			expect(opts.method).toBe("POST");
			expect(opts.url).toBe(`${TEST_API_BASE}/logs`);
			const body = JSON.parse(opts.body);
			expect(body.logs).toEqual(entries);
		});
	});

	describe("auth provider integration", () => {
		test("setAuthProvider stores the provider", () => {
			const provider: AuthProvider = {
				getToken: mock(() => Promise.resolve("oauth-token")),
				getVaultId: mock(() => "99"),
				isAuthenticated: mock(() => true),
				signOut: mock(() => {}),
			};
			api.setAuthProvider(provider);
			expect(api.getActiveVaultId()).toBe("99");
		});

		test("getActiveVaultId returns provider.getVaultId when provider set", () => {
			const provider: AuthProvider = {
				getToken: mock(() => Promise.resolve("t")),
				getVaultId: mock(() => "77"),
				isAuthenticated: mock(() => true),
				signOut: mock(() => {}),
			};
			api.setAuthProvider(provider);
			expect(api.getActiveVaultId()).toBe("77");
		});

		test("getActiveVaultId returns this.vaultId when no provider", () => {
			api.setVaultId("42");
			expect(api.getActiveVaultId()).toBe("42");
		});

		test("request uses provider.getToken in Authorization header", async () => {
			const provider: AuthProvider = {
				getToken: mock(() => Promise.resolve("oauth-token-123")),
				getVaultId: mock(() => null),
				isAuthenticated: mock(() => true),
				signOut: mock(() => {}),
			};
			api.setAuthProvider(provider);
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				json: { user: { id: "user-1", email: "test@example.com" } },
			} as any);
			await api.getMe();
			const opts = mockRequestUrl.mock.calls[0][0] as any;
			expect(opts.headers.Authorization).toBe("Bearer oauth-token-123");
		});

		test("request falls back to apiKey when no authProvider", async () => {
			// No provider set — should use the constructor apiKey
			mockRequestUrl.mockResolvedValueOnce({
				status: 200,
				json: { user: { id: "user-1", email: "test@example.com" } },
			} as any);
			await api.getMe();
			const opts = mockRequestUrl.mock.calls[0][0] as any;
			expect(opts.headers.Authorization).toBe(`Bearer ${TEST_KEY}`);
		});

		// An empty credential produces `Authorization: Bearer ` — the HTTP layer
		// strips the trailing space, so the server sees a bare `Bearer` and logs
		// reason=no_auth. An unlinked install used to loop those forever (prod
		// 2026-07-26: 890 no_auth 401s/24h from 3 installs, tripping the
		// auth-failure-burst alert). Never spend a request we know is a 401.
		test("request refuses to send when the api key is empty", async () => {
			const unauthed = new EngramApi(TEST_SERVER, "");
			await expect(unauthed.getMe()).rejects.toThrow(/not authenticated/i);
			expect(mockRequestUrl).not.toHaveBeenCalled();
		});

		test("request refuses to send when the provider yields an empty token", async () => {
			const provider: AuthProvider = {
				getToken: mock(() => Promise.resolve("")),
				getVaultId: mock(() => null),
				isAuthenticated: mock(() => false),
				signOut: mock(() => {}),
			};
			api.setAuthProvider(provider);
			await expect(api.getMe()).rejects.toThrow(/not authenticated/i);
			expect(mockRequestUrl).not.toHaveBeenCalled();
		});

		test("beacon drops spans instead of posting them unauthenticated", () => {
			const calls: any[] = [];
			(global as any).fetch = (url: string, opts: unknown) => {
				calls.push({ url, opts });
				return Promise.resolve();
			};
			const unauthed = new EngramApi(TEST_SERVER, "");
			unauthed.setTracingEnabled(true);
			unauthed.beacon.enqueue({
				trace_id: "1".repeat(32),
				parent_span_id: "2".repeat(16),
				name: "obsidian.push",
				start_us: 1,
				end_us: 2,
				attributes: {},
			});
			unauthed.beacon.flush();
			expect(calls).toHaveLength(0);
		});

		test("on 401, invalidates access token and retries once with refreshed token", async () => {
			let callCount = 0;
			const invalidate = mock(() => {});
			const provider: AuthProvider = {
				getToken: mock(() => Promise.resolve(`token-${++callCount}`)),
				getVaultId: mock(() => null),
				isAuthenticated: mock(() => true),
				signOut: mock(() => {}),
				invalidateAccessToken: invalidate,
			};
			api.setAuthProvider(provider);

			mockRequestUrl.mockRejectedValueOnce({ status: 401 }).mockResolvedValueOnce({
				status: 200,
				json: { user: { id: "user-1", email: "test@example.com" } },
			} as any);

			const result = await api.getMe();
			expect(result.id).toBe("user-1");
			expect(invalidate).toHaveBeenCalledTimes(1);
			expect(mockRequestUrl).toHaveBeenCalledTimes(2);
			const firstAuth = (mockRequestUrl.mock.calls[0][0] as any).headers.Authorization;
			const secondAuth = (mockRequestUrl.mock.calls[1][0] as any).headers.Authorization;
			expect(firstAuth).toBe("Bearer token-1");
			expect(secondAuth).toBe("Bearer token-2");
		});

		test("does not retry on 401 if provider has no invalidateAccessToken (e.g. API key)", async () => {
			const provider: AuthProvider = {
				getToken: mock(() => Promise.resolve("static-key")),
				getVaultId: mock(() => null),
				isAuthenticated: mock(() => true),
				signOut: mock(() => {}),
			};
			api.setAuthProvider(provider);

			mockRequestUrl.mockRejectedValueOnce({ status: 401 });

			await expect(api.getMe()).rejects.toMatchObject({ status: 401 });
			expect(mockRequestUrl).toHaveBeenCalledTimes(1);
		});

		test("does not infinite-loop if 401 persists after refresh", async () => {
			const invalidate = mock(() => {});
			const provider: AuthProvider = {
				getToken: mock(() => Promise.resolve("t")),
				getVaultId: mock(() => null),
				isAuthenticated: mock(() => true),
				signOut: mock(() => {}),
				invalidateAccessToken: invalidate,
			};
			api.setAuthProvider(provider);

			mockRequestUrl
				.mockRejectedValueOnce({ status: 401 })
				.mockRejectedValueOnce({ status: 401 });

			await expect(api.getMe()).rejects.toMatchObject({ status: 401 });
			expect(mockRequestUrl).toHaveBeenCalledTimes(2);
			expect(invalidate).toHaveBeenCalledTimes(1);
		});
	});
});

// ---------------------------------------------------------------------------
// Path-in-URL encoding — must preserve slashes. Phoenix's Plug.Static rejects
// %2F-encoded slashes with a 400 (Plug.Static.InvalidPathError) before auth,
// so attachments/notes in subfolders could never be fetched or deleted.
// ---------------------------------------------------------------------------

describe("path encoding for by-path URL methods", () => {
	function api(): EngramApi {
		return new EngramApi("http://host", "key");
	}
	function lastUrl(): string {
		const calls = mockRequestUrl.mock.calls;
		return (calls[calls.length - 1]![0] as { url: string }).url;
	}

	test("getAttachment keeps real slashes and encodes segment chars", async () => {
		mockRequestUrl.mockResolvedValue({ json: {} });
		await api().getAttachment("Legal/Formation/a b.pdf");
		const url = lastUrl();
		expect(url).toContain("/attachments/Legal/Formation/a%20b.pdf");
		expect(url).not.toContain("%2F");
	});

	test("deleteAttachment keeps real slashes", async () => {
		mockRequestUrl.mockResolvedValue({ json: {} });
		await api().deleteAttachment("Legal/Formation/x.pdf");
		expect(lastUrl()).toContain("/attachments/Legal/Formation/x.pdf");
		expect(lastUrl()).not.toContain("%2F");
	});

	test("deleteNote keeps real slashes", async () => {
		mockRequestUrl.mockResolvedValue({ json: {} });
		await api().deleteNote("Notes/Sub/Deep.md");
		expect(lastUrl()).toContain("/notes/Notes/Sub/Deep.md");
		expect(lastUrl()).not.toContain("%2F");
	});
});

// ---------------------------------------------------------------------------
// Request timeout (issue #244 — a wedged requestUrl on a half-open connection
// hung forever, holding `pulling`/push slots and stalling sync both ways)
// ---------------------------------------------------------------------------

describe("request timeout", () => {
	const never = () => new Promise<never>(() => {});

	function timedApi(): EngramApi {
		const api = new EngramApi("http://host", "key");
		api.requestTimeoutMs = 20;
		api.attachmentTimeoutMs = 300;
		return api;
	}

	test("a request that never settles rejects with RequestTimeoutError", async () => {
		mockRequestUrl.mockImplementation(never);
		const start = Date.now();
		await expect(timedApi().getMe()).rejects.toThrow(RequestTimeoutError);
		// Bound the wait: the reject must come from the 20ms timer, not a fluke.
		await Bun.sleep(30);
		expect(Date.now() - start).toBeLessThan(500);
	});

	test("attachment paths use the longer attachment timeout", async () => {
		mockRequestUrl.mockImplementation(never);
		const api = timedApi();
		let settledAt: number | null = null;
		const p = api.pushAttachment("a.png", "AAAA", "image/png", 1).catch(() => {
			settledAt = Date.now();
		});
		const start = Date.now();
		// Probe well past the 20ms note timeout but far short of the 300ms
		// attachment timer — wide margins so CI-runner jitter can't invert
		// the ordering (review finding on the original 30ms/40ms pair).
		await Bun.sleep(80);
		expect(settledAt).toBeNull(); // still pending past the note timeout
		await p;
		expect(settledAt).not.toBeNull();
		expect((settledAt ?? 0) - start).toBeGreaterThanOrEqual(150);
	});

	test("a fast response is unaffected", async () => {
		mockRequestUrl.mockResolvedValue({ status: 200, json: { user: { id: "u", email: "e" } } });
		const user = await timedApi().getMe();
		expect(user.id).toBe("u");
	});

	test("health() is also bounded", async () => {
		mockRequestUrl.mockImplementation(never);
		const api = timedApi();
		const healthy = await api.health();
		expect(healthy).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Wedge detector (issue #244 follow-up): on channel disconnect, a fresh
// /health probe that answers while older in-flight requests still hang proves
// the CONNECTION is wedged (half-open after a drain), not the server — fail
// those requests now instead of waiting out the full deadline.
// ---------------------------------------------------------------------------

describe("failWedgedRequests", () => {
	const never = () => new Promise<never>(() => {});

	function api(): EngramApi {
		const a = new EngramApi("http://host", "key");
		a.requestTimeoutMs = 5_000; // far away — early rejection must come from the probe
		return a;
	}

	test("rejects stale in-flight requests when the health probe answers", async () => {
		mockRequestUrl.mockImplementation((opts: { url: string }) =>
			opts.url.includes("/health") ? Promise.resolve({ status: 200 }) : never(),
		);
		const a = api();
		const pending = a.getMe();
		const settled = pending.catch((e) => e);
		await Bun.sleep(1); // let sendRequest pass its async preamble and register
		const failed = await a.failWedgedRequests(0);
		expect(failed).toBe(1);
		expect(await settled).toBeInstanceOf(RequestTimeoutError);
	});

	test("leaves requests alone when the server is unreachable (real outage)", async () => {
		mockRequestUrl.mockImplementation((opts: { url: string }) =>
			opts.url.includes("/health") ? Promise.reject(new Error("down")) : never(),
		);
		const a = api();
		let settled = false;
		a.getMe().catch(() => {
			settled = true;
		});
		const failed = await a.failWedgedRequests(0);
		expect(failed).toBe(0);
		await Bun.sleep(10);
		expect(settled).toBe(false);
	});

	test("leaves young requests alone", async () => {
		mockRequestUrl.mockImplementation((opts: { url: string }) =>
			opts.url.includes("/health") ? Promise.resolve({ status: 200 }) : never(),
		);
		const a = api();
		let settled = false;
		a.getMe().catch(() => {
			settled = true;
		});
		const failed = await a.failWedgedRequests(60_000);
		expect(failed).toBe(0);
		await Bun.sleep(10);
		expect(settled).toBe(false);
	});
});

describe("attachment deadline scope", () => {
	test("attachment metadata (DELETE) uses the note deadline, not the transfer one", async () => {
		mockRequestUrl.mockImplementation(() => new Promise<never>(() => {}));
		const a = new EngramApi("http://host", "key");
		a.requestTimeoutMs = 20;
		a.attachmentTimeoutMs = 100_000;
		const start = Date.now();
		await expect(a.deleteAttachment("x.png")).rejects.toThrow(RequestTimeoutError);
		expect(Date.now() - start).toBeLessThan(5_000);
	});
});

// ---------------------------------------------------------------------------
// Review-wave fixes (2026-07-15): wedge-probe shielding, single-flight,
// exact /attachments/changes endpoint match, bulk deadline tier.
// ---------------------------------------------------------------------------

describe("wedge probe shielding + single-flight", () => {
	const never = () => new Promise<never>(() => {});

	test("a slow attachment transfer is never wedge-aborted", async () => {
		mockRequestUrl.mockImplementation((opts: { url: string }) =>
			opts.url.includes("/health") ? Promise.resolve({ status: 200 }) : never(),
		);
		const a = new EngramApi("http://host", "key");
		let settled = false;
		a.pushAttachment("big.png", "AAAA", "image/png", 1).catch(() => {
			settled = true;
		});
		await Bun.sleep(1);
		const failed = await a.failWedgedRequests(0);
		expect(failed).toBe(0);
		await Bun.sleep(10);
		expect(settled).toBe(false);
	});

	test("concurrent probes are single-flight (no double abandon/count)", async () => {
		let healthResolve: (v: unknown) => void = () => {};
		mockRequestUrl.mockImplementation((opts: { url: string }) =>
			opts.url.includes("/health")
				? new Promise((r) => {
						healthResolve = r;
					})
				: never(),
		);
		const a = new EngramApi("http://host", "key");
		const settled = a.getMe().catch((e) => e);
		await Bun.sleep(1);
		const p1 = a.failWedgedRequests(0);
		const p2 = a.failWedgedRequests(0); // in-flight → immediate 0
		healthResolve({ status: 200 });
		expect(await p2).toBe(0);
		expect(await p1).toBe(1);
		expect(await settled).toBeInstanceOf(RequestTimeoutError);
	});
});

describe("deadline classification", () => {
	test("an attachment literally named changes.pdf gets the transfer deadline", async () => {
		mockRequestUrl.mockImplementation(() => new Promise<never>(() => {}));
		const a = new EngramApi("http://host", "key");
		a.requestTimeoutMs = 20;
		a.attachmentTimeoutMs = 300;
		let settledAt: number | null = null;
		const p = a.getAttachment("changes.pdf").catch(() => {
			settledAt = Date.now();
		});
		await Bun.sleep(80); // past the note deadline, well short of transfer
		expect(settledAt).toBeNull();
		await p;
		expect(settledAt).not.toBeNull();
	});

	test("metadata GETs keep the short deadline", async () => {
		mockRequestUrl.mockImplementation(() => new Promise<never>(() => {}));
		const a = new EngramApi("http://host", "key");
		a.requestTimeoutMs = 20;
		a.attachmentTimeoutMs = 100_000;
		await expect(a.getManifest()).rejects.toThrow(RequestTimeoutError);
	});
});

// ---------------------------------------------------------------------------
// Repo-review safety batch (2026-08): stale beacon token, 401→402 mapping,
// upgrade_url scheme validation.
// ---------------------------------------------------------------------------

describe("stale cached beacon token", () => {
	// window.fetch is monkey-patched to capture beacon posts; restore it so the
	// patch can't leak into downstream test files (bun shares one process).
	const originalFetch = (global as any).fetch;
	afterAll(() => {
		(global as any).fetch = originalFetch;
	});

	function tracedApi(): EngramApi {
		const a = new EngramApi(TEST_SERVER, TEST_KEY);
		a.setTracingEnabled(true);
		return a;
	}

	async function primeTokenWithSpan(a: EngramApi): Promise<void> {
		// A traced mutation caches the token AND enqueues a span on the beacon.
		mockRequestUrl.mockResolvedValueOnce({ status: 200, json: {} } as any);
		await a.pushNote("a.md", "x", 1);
	}

	test("updateConfig clears the cached token so a pending beacon batch never posts to the new origin", async () => {
		const calls: any[] = [];
		(global as any).fetch = (url: string, opts: unknown) => {
			calls.push({ url, opts });
			return Promise.resolve();
		};
		const a = tracedApi();
		await primeTokenWithSpan(a);
		a.updateConfig("http://other-backend.example", TEST_KEY);
		a.beacon.flush();
		expect(calls).toHaveLength(0);
	});

	test("setAuthProvider clears the cached token", async () => {
		const calls: any[] = [];
		(global as any).fetch = (url: string, opts: unknown) => {
			calls.push({ url, opts });
			return Promise.resolve();
		};
		const a = tracedApi();
		await primeTokenWithSpan(a);
		a.setAuthProvider(null);
		a.beacon.flush();
		expect(calls).toHaveLength(0);
	});
});

describe("402 on the post-401 retry", () => {
	test("still surfaces LimitExceededError (not the raw rejection)", async () => {
		const api = new EngramApi(TEST_SERVER, TEST_KEY);
		const provider: AuthProvider = {
			getToken: mock(() => Promise.resolve("t")),
			getVaultId: mock(() => null),
			isAuthenticated: mock(() => true),
			signOut: mock(() => {}),
			invalidateAccessToken: mock(() => {}),
		};
		api.setAuthProvider(provider);
		mockRequestUrl
			.mockRejectedValueOnce({ status: 401 })
			.mockRejectedValueOnce({ status: 402, json: { reason: "notes_cap_exceeded" } });
		try {
			await api.pushNote("test.md", "x", 100);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(LimitExceededError);
			expect((err as LimitExceededError).reason).toBe("notes_cap_exceeded");
		}
	});
});

describe("upgrade_url scheme validation", () => {
	async function upgradeUrlFrom402(upgrade_url: string): Promise<string | null> {
		const api = new EngramApi(TEST_SERVER, TEST_KEY);
		mockRequestUrl.mockRejectedValueOnce({
			status: 402,
			json: { reason: "notes_cap_exceeded", upgrade_url },
		});
		try {
			await api.pushNote("test.md", "x", 100);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(LimitExceededError);
			return (err as LimitExceededError).upgradeUrl;
		}
	}

	test("non-http(s) upgrade_url from the 402 body is discarded", async () => {
		// The URL is handed to window.open (Electron external-open); a malicious
		// self-host backend must not be able to launch arbitrary protocol handlers.
		expect(await upgradeUrlFrom402("javascript:alert(1)")).toBeNull();
		expect(await upgradeUrlFrom402("file:///etc/passwd")).toBeNull();
		expect(await upgradeUrlFrom402("not a url")).toBeNull();
	});

	test("http(s) upgrade_url is preserved", async () => {
		expect(await upgradeUrlFrom402("https://app.engram.page/settings/billing")).toBe(
			"https://app.engram.page/settings/billing",
		);
	});
});
