import json, time, sys
from cdp import ev, type_
P = "alpha\nbravo\ncharlie\n"

def setup(name, content, delay, panes=1):
    return ev('''(async () => {
      app.workspace.iterateAllLeaves(l => { if (l.view.getViewType() === "markdown") l.detach(); });
      await new Promise(r => setTimeout(r, 300));
      const p = %s; await app.vault.adapter.write(p, %s); await new Promise(r => setTimeout(r, 400));
      window.__docs.delete("id:" + p); window.__lca.delete("id:" + p); window.__diskLog.delete(p); window.__conflicts = [];
      window.__delay = %d;
      const f = app.vault.getAbstractFileByPath(p);
      window.__panes = [];
      const a = app.workspace.getLeaf("tab"); await a.openFile(f); window.__panes.push(a);
      for (let i = 1; i < %d; i++) { const b = app.workspace.getLeaf("split"); await b.openFile(f); window.__panes.push(b); }
      return "ok";
    })()''' % (json.dumps(name), json.dumps(content), delay, panes))

def focus(pane, line, ch):
    ev('(() => { const l = window.__panes[%d]; app.workspace.setActiveLeaf(l, {focus:true}); const ed = l.view.editor; ed.focus(); ed.setCursor(%d, %d); })()' % (pane, line, ch))

def typekeys(s):
    for c in s:
        type_(c); time.sleep(0.05)

def state(name):
    return ev('''(async () => {
      const p = %s;
      return { editors: window.__panes.map(l => l.view.editor.getValue()),
               doc: window.__docs.get("id:" + p).getText("body").toJSON(),
               disk: await app.vault.adapter.read(p), conflicts: window.__conflicts.length };
    })()''' % json.dumps(name))

def check(label, st, want):
    okE = all(e == want for e in st["editors"])
    ok = okE and st["doc"] == want
    print(("PASS " if ok else "FAIL ") + label, "" if ok else json.dumps(st))
    return ok

results = []
# S1: type T, real autosave, type U, then go live
setup("s1.md", P, 7000); focus(0, 1, 5); typekeys("TTT"); time.sleep(3); focus(0, 2, 7); typekeys("UUU"); time.sleep(6)
results.append(check("S1 autosave during entering then more typing", state("s1.md"), "alpha\nbravoTTT\ncharlieUUU\n"))
# S2: + remote edit during entering
setup("s2.md", P, 7000); focus(0, 1, 5); typekeys("TTT"); time.sleep(3); focus(0, 2, 7); typekeys("UUU")
ev('window.__remote("s2.md", t => { t.delete(0, 5); t.insert(0, "ALPHA-S"); })'); time.sleep(6)
results.append(check("S2 + remote edit during entering", state("s2.md"), "ALPHA-S\nbravoTTT\ncharlieUUU\n"))
# S3: delete a line during entering (keyboard), autosave, more typing
setup("s3.md", P, 7000)
ev('(() => { const ed = window.__panes[0].view.editor; ed.focus(); ed.setSelection({line:2,ch:0},{line:3,ch:0}); })()')
from cdp import call
call("Input.dispatchKeyEvent", {"type":"keyDown","key":"Backspace","code":"Backspace","windowsVirtualKeyCode":8}); call("Input.dispatchKeyEvent", {"type":"keyUp","key":"Backspace","code":"Backspace","windowsVirtualKeyCode":8})
time.sleep(3); focus(0, 0, 5); typekeys("X"); time.sleep(6)
results.append(check("S3 saved deletion then more typing", state("s3.md"), "alphaX\nbravo\n"))
# S4: two panes, typing in pane B while entering
setup("s4.md", P, 5000, panes=2); focus(1, 1, 5); typekeys("QQ"); time.sleep(3); focus(1, 2, 7); typekeys("WW"); time.sleep(5)
results.append(check("S4 two panes typing while entering", state("s4.md"), "alpha\nbravoQQ\ncharlieWW\n"))
# S5: live two panes; type in A then remote edit within the mirror window (stale mirror)
setup("s5.md", P, 0, panes=2); time.sleep(1); focus(0, 1, 5); type_("K")
ev('window.__remote("s5.md", t => t.insert(0, "R"))'); time.sleep(2)
results.append(check("S5 stale mirror after remote edit", state("s5.md"), "Ralpha\nbravoK\ncharlie\n"))
# S6: external modify while entering with typing
setup("s6.md", P, 7000); focus(0, 1, 5); typekeys("TT"); time.sleep(0.3)
ev('require("fs").writeFileSync(app.vault.adapter.basePath + "/s6.md", "alpha\\nbravo\\ncharlie\\nEXT\\n")'); time.sleep(8)
results.append(check("S6 external modify while entering", state("s6.md"), "alpha\nbravoTT\ncharlie\nEXT\n"))
print("passed", sum(results), "of", len(results))
