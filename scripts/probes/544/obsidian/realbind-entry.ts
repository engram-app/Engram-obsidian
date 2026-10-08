import { Plugin, TFile } from "obsidian";
import * as Y from "yjs";
import { liveBindingPlugin, setLiveBindingCoordinator } from "/home/open-claw/documents/code-projects/engram-obsidian-sync/.worktrees/544-proto/src/crdt/live/live-binding";
import { frontmatterPrefixLen } from "/home/open-claw/documents/code-projects/engram-obsidian-sync/.worktrees/544-proto/src/crdt/live/live-binding-decisions";
const w = window as any;
const docs = new Map<string, Y.Doc>();
const lca = new Map<string, string>();
const diskLog = new Map<string, Array<{ text: string; at: number }>>();
w.__docs = docs; w.__lca = lca; w.__diskLog = diskLog; w.__conflicts = []; w.__delay = 0; w.__legacyDiskWriter = false;
const body = (t: string) => t.slice(frontmatterPrefixLen(t));
export default class extends Plugin {
  async onload() {
    // Obsidian autosaves: record every disk write (the doc of an open note never takes it).
    this.registerEvent(this.app.vault.on("modify", async (f) => {
      if (!(f instanceof TFile)) return;
      const at = Date.now();
      const text = await this.app.vault.read(f);
      const log = diskLog.get(f.path) ?? []; log.push({ text, at }); diskLog.set(f.path, log);
      const d = docs.get("id:" + f.path);
      if (d && d.getText("body").toJSON() === body(text)) lca.set("id:" + f.path, text); // disk == doc
      // Today's sync engine (seedBodyAfterCreate / pushFile / cold reconcile): disk -> doc while bound.
      if (d && w.__legacyDiskWriter) {
        const t = d.getText("body"); const cur = t.toJSON(); const next = body(text);
        let a = 0; while (a < cur.length && a < next.length && cur[a] === next[a]) a++;
        let b = 0; while (b < cur.length - a && b < next.length - a && cur[cur.length - 1 - b] === next[next.length - 1 - b]) b++;
        d.transact(() => { t.delete(a, cur.length - a - b); t.insert(a, next.slice(a, next.length - b)); }, "sync-engine");
      }
    }));
    w.__remote = (path: string, fn: (t: Y.Text) => void) => { const d = docs.get("id:" + path)!; d.transact(() => fn(d.getText("body")), "remote"); };
    setLiveBindingCoordinator({
      resolveId: (p: string) => "id:" + p,
      residentText: (id: string) => {
        let d = docs.get(id);
        if (!d) {
          d = new Y.Doc(); docs.set(id, d);
          const f = this.app.vault.getAbstractFileByPath(id.slice(3)) as TFile;
          // "server" seed: the file at first open; LCA = that text (doc and disk agree)
          const seed = this.app.vault.read(f).then((t) => { d!.getText("body").insert(0, body(t)); lca.set(id, t); });
          (d as any).__ready = seed.then(() => new Promise((r) => setTimeout(r, w.__delay)));
        }
        return { text: d.getText("body"), ready: (d as any).__ready };
      },
      enroll: () => {}, onBind: () => {}, onRelease: () => {},
      lcaFor: (id: string) => lca.get(id) ?? null,
      latestDiskSince: (path: string, since: number) => { const hits = (diskLog.get(path) ?? []).filter((e) => e.at >= since); return hits.length ? hits[hits.length - 1].text : null; },
      onConflict: (path: string, editorText: string) => w.__conflicts.push({ path, editorText }),
    } as any);
    this.registerEditorExtension(liveBindingPlugin);
  }
  onunload() { setLiveBindingCoordinator(null); }
}
