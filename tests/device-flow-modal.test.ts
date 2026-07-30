/**
 * Tests for DeviceFlowModal — verifies the device-flow start request
 * carries the local Obsidian vault name so the web /link consent page
 * can pre-fill the "create new vault" field.
 */
import { beforeEach, describe, expect, type Mock, test } from "bun:test";
import { requestUrl } from "obsidian";
import { DeviceFlowModal } from "../src/device-flow-modal";

const mockRequestUrl = requestUrl as unknown as Mock<() => Promise<any>>;

const makeApp = (vaultName: string) =>
	({
		vault: { getName: () => vaultName },
	}) as any;

const makePlugin = (apiUrl: string, clientId: string) =>
	({
		settings: { apiUrl, clientId },
	}) as any;

describe("DeviceFlowModal.startDeviceFlow", () => {
	beforeEach(() => {
		mockRequestUrl.mockReset();
	});

	test("sends client_id and local vault_name", async () => {
		mockRequestUrl.mockResolvedValue({
			status: 200,
			json: {
				device_code: "abc",
				user_code: "AAAA-BBBB",
				verification_url: "https://example.test/link",
				expires_in: 300,
			},
		});

		const modal = new DeviceFlowModal(
			makeApp("My Local Notes"),
			makePlugin("https://example.test", "cid-1"),
		);

		await (modal as any).startDeviceFlow();

		expect(mockRequestUrl).toHaveBeenCalledTimes(1);
		const call = mockRequestUrl.mock.calls[0][0] as { url: string; body: string };
		expect(call.url).toBe("https://example.test/api/auth/device");

		const body = JSON.parse(call.body);
		expect(body).toEqual({
			client_id: "cid-1",
			vault_name: "My Local Notes",
		});
	});

	test("handles apiUrl that already ends with /api", async () => {
		mockRequestUrl.mockResolvedValue({
			status: 200,
			json: {
				device_code: "abc",
				user_code: "AAAA-BBBB",
				verification_url: "https://example.test/link",
				expires_in: 300,
			},
		});

		const modal = new DeviceFlowModal(
			makeApp("Vault A"),
			makePlugin("https://example.test/api", "cid-2"),
		);

		await (modal as any).startDeviceFlow();
		const call = mockRequestUrl.mock.calls[0][0] as { url: string };
		expect(call.url).toBe("https://example.test/api/auth/device");
	});

	test("trims surrounding whitespace from vault name before sending", async () => {
		mockRequestUrl.mockResolvedValue({
			status: 200,
			json: {
				device_code: "abc",
				user_code: "AAAA-BBBB",
				verification_url: "https://example.test/link",
				expires_in: 300,
			},
		});

		const modal = new DeviceFlowModal(
			makeApp("  Padded Vault \n"),
			makePlugin("https://example.test", "cid-3"),
		);

		await (modal as any).startDeviceFlow();
		const body = JSON.parse((mockRequestUrl.mock.calls[0][0] as { body: string }).body);
		expect(body.vault_name).toBe("Padded Vault");
	});

	test("omits vault_name when the vault name is empty (or only whitespace)", async () => {
		mockRequestUrl.mockResolvedValue({
			status: 200,
			json: {
				device_code: "abc",
				user_code: "AAAA-BBBB",
				verification_url: "https://example.test/link",
				expires_in: 300,
			},
		});

		const modal = new DeviceFlowModal(
			makeApp("   "),
			makePlugin("https://example.test", "cid-4"),
		);

		await (modal as any).startDeviceFlow();
		const body = JSON.parse((mockRequestUrl.mock.calls[0][0] as { body: string }).body);
		expect(body).toEqual({ client_id: "cid-4" });
		expect("vault_name" in body).toBe(false);
	});

	test("throws on non-2xx", async () => {
		mockRequestUrl.mockResolvedValue({ status: 500, json: {} });

		const modal = new DeviceFlowModal(
			makeApp("Vault"),
			makePlugin("https://example.test", "cid"),
		);

		await expect((modal as any).startDeviceFlow()).rejects.toThrow("HTTP 500");
	});
});
