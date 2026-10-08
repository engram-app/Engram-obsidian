import json, sys, urllib.request, websocket
def ws():
    pages = json.load(urllib.request.urlopen("http://127.0.0.1:9291/json/list", timeout=3))
    url = [p for p in pages if p["type"] == "page"][0]["webSocketDebuggerUrl"]
    return websocket.create_connection(url, timeout=30, suppress_origin=True)
_id = 0
def call(method, params=None):
    global _id
    c = ws(); _id += 1
    c.send(json.dumps({"id": _id, "method": method, "params": params or {}}))
    while True:
        m = json.loads(c.recv())
        if m.get("id") == _id:
            c.close(); return m
def ev(expr):
    r = call("Runtime.evaluate", {"expression": expr, "awaitPromise": True, "returnByValue": True})
    res = r.get("result", {})
    if "exceptionDetails" in res: return {"EXC": res["exceptionDetails"].get("exception", {}).get("description")}
    return res.get("result", {}).get("value")
def type_(text):
    return call("Input.insertText", {"text": text})
if __name__ == "__main__":
    print(json.dumps(ev(sys.argv[1]), indent=1))
