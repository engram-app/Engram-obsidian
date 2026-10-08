import { World, View, P, tick } from "./harness";

// Variant A: editor bound to HSM during entering (CM6_CHANGE -> accumulateCM6Change)
// Variant B: editor NOT bound until after tracking (HSMEditorPlugin pendingEdits, real first-open order)
// Variant C: editor bound while HSM sits in active.merging.threeWay (between persistence sync and merge completion)
async function seq(label: string, mode: "A" | "B" | "C", opts: { remote?: boolean; U?: boolean; del?: boolean; perKey?: boolean }) {
	const w = new World();
	w.open();
	const v = new View(w, "e", P);
	if (mode === "A") v.bind();
	if (opts.del) v.del("charlie\n");
	else v.type("bravo", process.env.T ?? "T", opts.perKey ?? true);
	if (opts.remote) w.remoteEdit();
	w.autosave(v);
	if (opts.U) v.type("charlie", process.env.U ?? "U", opts.perKey ?? true);
	console.log(`  [pre-live] state=${w.hsm.statePath} editor=${JSON.stringify(v.text)} disk=${JSON.stringify(w.disk)}`);
	if (mode === "C") {
		w.hsm.send({ type: "CONNECTED" } as any);
		w.hsm.send({ type: "PROVIDER_SYNCED" } as any);
		w.persistence.fire(); // synchronous: reconciling -> merging.threeWay entry; invoke async
		console.log(`  [C] bind in state=${w.hsm.statePath}`);
		v.bind();
		await tick();
	} else {
		await w.goLive();
		if (mode === "B") { v.bind(); await tick(); }
	}
	w.report(label, [v]);
	w.drift(v);
}

(async () => {
	const which = process.argv[2] ?? "all";
	for (const mode of ["A", "B", "C"] as const) {
		if (which === "all" || which === "1") await seq(`S1 mode ${mode} (T, autosave P+T, U, live)`, mode, { U: true });
		if (which === "all" || which === "2") await seq(`S2 mode ${mode} (T, remote S, autosave, U, live)`, mode, { U: true, remote: true });
		if (which === "all" || which === "3") await seq(`S3 mode ${mode} (T, autosave P+T, live)`, mode, {});
		if (which === "all" || which === "4") await seq(`S4 mode ${mode} (delete charlie, autosave, live)`, mode, { del: true });
	}
	if (which === "all" || which === "1c") for (const mode of ["A", "B"] as const)
		await seq(`S1 mode ${mode} single-chunk typing`, mode, { U: true, perKey: false });
})();
