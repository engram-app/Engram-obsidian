import { encodeCursor } from "../src/cursor";

describe("encodeCursor", () => {
  test("encodes <seq>:<id> as url-safe base64 without padding", () => {
    const id = "0a8b1c2d-3e4f-5061-7283-94a5b6c7d8e9";
    const tok = encodeCursor(42, id);
    const b64 = tok.replace(/-/g, "+").replace(/_/g, "/");
    expect(atob(b64)).toBe(`42:${id}`);   // round-trips
    expect(tok).not.toContain("+");
    expect(tok).not.toContain("/");
    expect(tok).not.toContain("=");
  });

  test("matches the backend format for a fixed vector", () => {
    // EXPECTED below is base64url(no-pad) of "1:00000000-0000-0000-0000-000000000000".
    // Derived via: Buffer.from("1:00000000-0000-0000-0000-000000000000").toString("base64url")
    expect(encodeCursor(1, "00000000-0000-0000-0000-000000000000"))
      .toBe("MTowMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDA");
  });
});
