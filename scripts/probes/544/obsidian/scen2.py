import json, time
src = open("scen.py").read().split("results = []")[0]
exec(src)
import sys
tag = sys.argv[1]
setup(tag+"a.md", P, 7000); focus(0, 1, 5); typekeys("TTT"); time.sleep(3); focus(0, 2, 7); typekeys("UUU")
ev('window.__remote("%sa.md", t => { t.delete(0, 5); t.insert(0, "ALPHA-S"); })' % tag); time.sleep(6)
check(tag+" S2 remote edit during entering", state(tag+"a.md"), "ALPHA-S\nbravoTTT\ncharlieUUU\n")
setup(tag+"b.md", P, 7000); focus(0, 2, 0); typekeys("TYPED\n"); time.sleep(3); focus(0, 4, 0); typekeys("more\n"); time.sleep(6)
check(tag+" S7 new line typed, autosave, more lines", state(tag+"b.md"), "alpha\nbravo\nTYPED\ncharlie\nmore\n")
