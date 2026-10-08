import { World, View, P, tick } from "./harness";
async function run(label: string, mode: "A"|"B", body: (w: World, v: View) => void) {
	const w = new World(); w.open(); const v = new View(w, "e", P);
	if (mode === "A") v.bind();
	body(w, v);
	await w.goLive(); if (mode === "B") { v.bind(); await tick(); }
	w.report(label, [v]); w.drift(v);
}
(async () => {
	for (const m of ["A","B"] as const) {
		await run(`S0 ${m}: type TTT, NO autosave, live`, m, (w, v) => v.type("bravo", "TTT"));
		await run(`S4b ${m}: backspace 'charlie\\n' per char, autosave, live`, m, (w, v) => { for (let i=0;i<8;i++){ const e=v.text.length; v.tx([{from:e-1,to:e,insert:""}],"delete.backward"); } w.autosave(v); });
		await run(`S4c ${m}: backspace per char, autosave midway, more backspace, live`, m, (w, v) => { for (let i=0;i<4;i++){ const e=v.text.length; v.tx([{from:e-1,to:e,insert:""}],"delete.backward"); } w.autosave(v); for (let i=0;i<4;i++){ const e=v.text.length; v.tx([{from:e-1,to:e,insert:""}],"delete.backward"); } });
	}
})();
