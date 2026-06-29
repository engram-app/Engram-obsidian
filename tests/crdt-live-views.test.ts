import { describe, it, expect, mock } from "bun:test";
import { ViewerRefcount } from "../src/crdt/live/live-views";

describe("ViewerRefcount", () => {
  it("isBound true while at least one viewer holds the path", () => {
    const rc = new ViewerRefcount(() => {});
    expect(rc.isBound("a.md")).toBe(false);
    rc.bind("a.md", "v1");
    expect(rc.isBound("a.md")).toBe(true);
    rc.bind("a.md", "v2");
    rc.release("a.md", "v1");
    expect(rc.isBound("a.md")).toBe(true);
    rc.release("a.md", "v2");
    expect(rc.isBound("a.md")).toBe(false);
  });

  it("fires onLastRelease exactly once when the final viewer leaves", () => {
    const onLast = mock((_p: string) => {});
    const rc = new ViewerRefcount(onLast);
    rc.bind("a.md", "v1");
    rc.bind("a.md", "v2");
    rc.release("a.md", "v1");
    expect(onLast).toHaveBeenCalledTimes(0);
    rc.release("a.md", "v2");
    expect(onLast).toHaveBeenCalledTimes(1);
    expect(onLast).toHaveBeenCalledWith("a.md");
  });

  it("bind and release are idempotent per (path, viewId)", () => {
    const onLast = mock((_p: string) => {});
    const rc = new ViewerRefcount(onLast);
    rc.bind("a.md", "v1");
    rc.bind("a.md", "v1"); // dup bind, no double count
    rc.release("a.md", "v1");
    rc.release("a.md", "v1"); // dup release, no double fire
    expect(onLast).toHaveBeenCalledTimes(1);
    expect(rc.isBound("a.md")).toBe(false);
  });
});
