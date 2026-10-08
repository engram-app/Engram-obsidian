import { World, View, P, tick } from "./harness";
import { rebaseBufferedTextAcrossReplacement } from "/home/open-claw/documents/code-projects/relay/Relay/src/merge-hsm/integration/replayBufferedEdits";

async function tracking(): Promise<{ w: World; a: View }> {
	const w = new World(); w.open();
	const a = new View(w, "A", P);
	await w.goLive(); a.bind(); await tick();
	return { w, a };
}

(async () => {
	// ---- S5 sibling panes ----
	{
		const { w, a } = await tracking();
		const b = new View(w, "B", P); b.bornAttachedEligible = true; // created while tracking, pre-bind, stale buffer
		a.type("bravo", "XYZ");
		b.set(a.text); // Obsidian mirrors A into B: unannotated full-buffer set
		await tick();
		w.report("S5a: B pre-bind, A types XYZ, mirror set into B -> born-attached bind+render", [a, b]);
		w.drift(a);
	}
	{
		const { w, a } = await tracking();
		const b = new View(w, "B", P); b.bornAttachedEligible = true;
		b.type("charlie", "QQ");            // B's own pre-bind typing into stale buffer
		a.type("bravo", "XYZ");
		b.set(a.text);                       // mirror of A (does not contain QQ)
		await tick();
		w.report("S5b: B pre-bind typed QQ, A types XYZ, mirror set(A) into B", [a, b]);
		w.drift(a);
	}
	{
		const { w, a } = await tracking();
		const b = new View(w, "B", P); b.bornAttachedEligible = true;
		b.set(w.local()); await tick();      // B bound + rendered
		a.type("bravo", "XYZ");
		b.set(a.text);                       // A's keystrokes mirrored into bound B as "set"
		a.type("charlie", "W");
		b.set(a.text);
		await tick();
		w.report("S5c: B bound; A types, each mirrored into B as set", [a, b]);
		w.drift(a);
	}
	{
		const { w, a } = await tracking();
		const b = new View(w, "B", P); b.bornAttachedEligible = true;
		b.type("charlie", "QQ");            // B pre-bind typing
		a.set(b.text);                       // B's save echo reaches bound A as set (delivers QQ)
		b.set(b.text);                       // reload/set in B -> born-attached render; QQ must not double
		await tick();
		w.report("S5d: B pre-bind typed QQ, its save echo delivered via A, then B binds", [a, b]);
		w.drift(a);
	}

	// ---- S6 stale set echo after a remote paint ----
	{
		const { w, a } = await tracking();
		const stale = a.text;
		w.remoteEdit(); await tick();
		const painted = a.text;
		a.set(stale);                        // stale unannotated set echo of pre-remote text
		await tick();
		w.report(`S6: tracking, remote painted (${JSON.stringify(painted)}), then stale set echo`, [a]);
		w.drift(a);
	}
	{
		const { w, a } = await tracking();
		const b = new View(w, "B", P); b.bornAttachedEligible = true;
		b.set(w.local()); await tick();
		const stale = b.text;
		w.remoteEdit(); await tick();
		b.set(stale);
		await tick();
		w.report("S6b: sibling B receives stale set echo after remote paint", [a, b]);
		w.drift(a);
	}

	// ---- S7 recovery mode (no LCA) ----
	for (const disk of ["alpha\nbravo\ncharlie\nDISK-ONLY\n", P]) {
		const w = new World({ withLca: false, disk });
		w.open();
		const a = new View(w, "A", disk);
		await w.goLive(); a.bind(); await tick();
		w.report(`S7: no LCA, localDoc=P, disk=${JSON.stringify(disk)}`, [a]);
	}
	{
		const w = new World({ withLca: false, disk: "alpha\nbravo\ncharlie\nDISK-ONLY\n" });
		w.open();
		const a = new View(w, "A", w.disk);
		a.type("bravo", "TT"); w.autosave(a);
		await w.goLive(); a.bind(); await tick();
		w.report(`S7b: no LCA, disk!=local, typed TT + autosave during entering`, [a]);
	}

	// ---- S8 pre-bind buffering ----
	const show = (l: string, r: string | null) => console.log(`  ${l}: ${JSON.stringify(r)}`);
	console.log("\n=== S8 rebaseBufferedTextAcrossReplacement (direct) ===");
	show("8a empty pre-load buf, typed 'Z', set(P)", rebaseBufferedTextAcrossReplacement("", "Z", P));
	show("8b base P, typed T, replacement P (plain setViewData reload)", rebaseBufferedTextAcrossReplacement(P, "alpha\nbravoTTT\ncharlie\n", P));
	show("8c base P, typed TTT, replacement=P+TTT, ingested [P+TTT] (echo delivered all)", rebaseBufferedTextAcrossReplacement(P, "alpha\nbravoTTT\ncharlie\n", "alpha\nbravoTTT\ncharlie\n", ["alpha\nbravoTTT\ncharlie\n"]));
	show("8d base P, typed TTT, replacement=P+TT, ingested [P+TT] (echo delivered part)", rebaseBufferedTextAcrossReplacement(P, "alpha\nbravoTTT\ncharlie\n", "alpha\nbravoTT\ncharlie\n", ["alpha\nbravoTT\ncharlie\n"]));
	show("8e same as 8c but NO ingested list", rebaseBufferedTextAcrossReplacement(P, "alpha\nbravoTTT\ncharlie\n", "alpha\nbravoTTT\ncharlie\n"));
	show("8f base P, typed TTT, replacement=S+TT (remote+partial echo), ingested [S+TT]", rebaseBufferedTextAcrossReplacement(P, "alpha\nbravoTTT\ncharlie\n", "ALPHA-S\nbravoTT\ncharlie\n", ["ALPHA-S\nbravoTT\ncharlie\n"]));
	show("8g base P, typed TTT, replacement=S (remote only)", rebaseBufferedTextAcrossReplacement(P, "alpha\nbravoTTT\ncharlie\n", "ALPHA-S\nbravo\ncharlie\n"));
	show("8h base P, deleted charlie, replacement=P", rebaseBufferedTextAcrossReplacement(P, "alpha\nbravo\n", P));
	show("8i base P, deleted charlie, replacement=P-charlie (echo delivered), ingested [it]", rebaseBufferedTextAcrossReplacement(P, "alpha\nbravo\n", "alpha\nbravo\n", ["alpha\nbravo\n"]));

	// plugin-level: unbound first editor, typing into pre-load buffer, setViewData, bind
	{
		const w = new World(); w.open();
		const a = new View(w, "A", "");      // pre-load empty buffer
		a.type(0, "Z");                       // typing before populate
		a.set(P);                             // setViewData populate, userEvent set
		await tick();
		await w.goLive(); a.bind(); await tick();
		w.report("S8-plugin-1: type Z into empty pre-load buffer, set(P), go live, bind", [a]);
		w.drift(a);
	}
	{
		const w = new World(); w.open();
		const a = new View(w, "A", P);
		a.type("bravo", "TTT");
		w.disk = "alpha\nbravoTT\ncharlie\n"; w.mtime++;
		w.hsm.send({ type: "DISK_CHANGED", contents: w.disk, mtime: w.mtime, hash: require("./harness").h(w.disk) } as any);
		a.set(w.disk);                        // reload/set whose content already carries part of the typing
		await tick();
		await w.goLive(); a.bind(); await tick();
		w.report("S8-plugin-2: typed TTT pre-bind, set(P+TT) echo, go live, bind", [a]);
		w.drift(a);
	}
	{
		const w = new World(); w.open();
		const a = new View(w, "A", P);
		a.type("bravo", "TTT");
		w.autosave(a);                        // disk P+TTT, DISK_CHANGED during entering
		a.set(w.disk);                        // Obsidian reload of the same disk (set) -> converts buffer to restore
		await tick();
		await w.goLive(); a.bind(); await tick();
		w.report("S8-plugin-3: typed TTT, autosave, set(disk) reload, live, bind", [a]);
		w.drift(a);
	}
})();
