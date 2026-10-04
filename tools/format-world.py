# Pretty-print src/world.json: short objects/arrays stay on one line.
#   python3 tools/format-world.py
import json, os
P = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src", "world.json")
def fmt(v, d=0, key=0):
    one = json.dumps(v, ensure_ascii=False)
    if not isinstance(v, (dict, list)) or len(one) + d * 2 + key <= 140: return one
    pad, end = "  " * (d + 1), "  " * d
    if isinstance(v, dict):
        return "{\n" + ",\n".join(f"{pad}{json.dumps(k)}: {fmt(x, d + 1, len(k) + 4)}" for k, x in v.items()) + "\n" + end + "}"
    return "[\n" + ",\n".join(pad + fmt(x, d + 1) for x in v) + "\n" + end + "]"
w = json.load(open(P))
open(P, "w").write(fmt(w) + "\n")
print("formatted", P)
