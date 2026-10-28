"""
Mini routing engine (RAPTOR-lite) di atas GTFS resmi Transjakarta.

Mencari perjalanan terbaik (maks. 2x transit) dari Halte Rasuna Said ke
beberapa halte tujuan di Jakarta Barat, memakai:
  - stop_times.txt  -> waktu tempuh antar halte per pola trip
  - frequencies.txt -> headway (estimasi waktu tunggu = headway / 2)
  - stops.txt       -> parent_station (transit di dalam halte yang sama)
  - jarak <= 350 m  -> transit jalan kaki (JPO / skybridge)
Hanya layanan BRT (koridor bernomor) yang dipakai.
"""
import csv
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

GTFS = Path(__file__).resolve().parent.parent / "data" / "gtfs"
WALK_MAX_M = 350
WALK_SPEED_MPS = 1.1


def read(name):
    with open(GTFS / name, encoding="utf-8-sig", newline="") as f:
        return [{k.strip(): (v or "").strip() for k, v in r.items()} for r in csv.DictReader(f)]


def tsec(t):
    h, m, s = (int(x) for x in t.split(":"))
    return h * 3600 + m * 60 + s


def hav(a, b):
    R = 6371000
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    d = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(d))


stops = {s["stop_id"]: s for s in read("stops.txt")}
routes = {r["route_id"]: r for r in read("routes.txt")}
trips = {t["trip_id"]: t for t in read("trips.txt")}
freq = defaultdict(list)
for f in read("frequencies.txt"):
    freq[f["trip_id"]].append(f)
seqs = defaultdict(list)
for r in read("stop_times.txt"):
    seqs[r["trip_id"]].append(r)


def station_of(sid):
    s = stops[sid]
    return s["parent_station"] or sid


def coord(sid):
    s = stops[sid]
    return float(s["stop_lat"]), float(s["stop_lon"])


def headway_at(trip_id, at_sec=14 * 3600):
    best = None
    for f in freq[trip_id]:
        if tsec(f["start_time"]) <= at_sec <= tsec(f["end_time"]):
            best = int(f["headway_secs"])
    return best


# Pola trip BRT yang aktif hari kerja jam siang (default 14:00, bisa diganti argumen)
AT = tsec(sys.argv[1]) if len(sys.argv) > 1 else 14 * 3600
patterns = []
for tid, t in trips.items():
    r = routes.get(t["route_id"])
    if not r or r["route_desc"] != "BRT":
        continue
    hw = headway_at(tid, AT)
    if not hw:
        continue
    seq = sorted(seqs[tid], key=lambda x: int(x["stop_sequence"]))
    if len(seq) < 2:
        continue
    base = tsec(seq[0]["arrival_time"])
    patterns.append({
        "trip_id": tid,
        "route_id": t["route_id"],
        "headsign": t["trip_headsign"],
        "shape_id": t["shape_id"],
        "headway": hw,
        "stops": [x["stop_id"] for x in seq],
        "t": [tsec(x["arrival_time"]) - base for x in seq],
    })

# Indeks: station -> [(pattern_idx, pos)]
by_station = defaultdict(list)
for pi, p in enumerate(patterns):
    for pos, sid in enumerate(p["stops"]):
        by_station[station_of(sid)].append((pi, pos))

# Transit jalan kaki antar-station yang berdekatan
stations = list(by_station.keys())
walk = defaultdict(list)
for i, a in enumerate(stations):
    ca = coord(a)
    for b in stations[i + 1:]:
        d = hav(ca, coord(b))
        if d <= WALK_MAX_M:
            walk[a].append((b, d))
            walk[b].append((a, d))


def name(st):
    return stops[st]["stop_name"]


ORIGIN = [s for s in by_station if name(s) == "Rasuna Said"]
TARGETS = ["Grogol Reformasi", "Kalideres", "Rawa Buaya", "Kebon Jeruk", "Tomang Raya", "Pluit", "Jelambar"]

# Label-setting: state = station, cost = detik, simpan jejak legs
INF = float("inf")
best = {}
frontier = {}
for o in ORIGIN:
    best[(o, 0)] = (0, [])
    frontier[o] = (0, [])

results = defaultdict(list)
for rnd in range(3):  # maks 3 leg = 2 transit
    nxt = {}
    for st, (cost, legs) in frontier.items():
        used_routes = {l["route_id"] for l in legs if l["type"] == "ride"}
        for pi, pos in by_station[st]:
            p = patterns[pi]
            if p["route_id"] in used_routes:
                continue
            wait = p["headway"] / 2
            for j in range(pos + 1, len(p["stops"])):
                ride = p["t"][j] - p["t"][pos]
                if ride <= 0:
                    continue
                dst = station_of(p["stops"][j])
                c = cost + wait + ride
                leg = {
                    "type": "ride", "route_id": p["route_id"], "trip_id": p["trip_id"],
                    "headsign": p["headsign"], "shape_id": p["shape_id"], "headway": p["headway"],
                    "from_pos": pos, "to_pos": j,
                    "from": p["stops"][pos], "to": p["stops"][j], "ride": ride, "wait": wait,
                }
                nl = legs + [leg]
                if name(dst) in TARGETS:
                    results[name(dst)].append((c, nl))
                if dst not in nxt or nxt[dst][0] > c:
                    nxt[dst] = (c, nl)
                for w, d in walk[dst]:
                    cw = c + d / WALK_SPEED_MPS + 60
                    wl = nl + [{"type": "walk", "from": p["stops"][j], "to_station": w, "meters": round(d)}]
                    if w not in nxt or nxt[w][0] > cw:
                        nxt[w] = (cw, wl)
    frontier = nxt


def describe(c, legs):
    out = []
    for l in legs:
        if l["type"] == "ride":
            out.append(f"[{l['route_id']}] {name(l['from'])} -> {name(l['to'])} ({l['ride']//60}m ride, hw {l['headway']//60}m, {l['trip_id']})")
        else:
            out.append(f"(jalan {l['meters']} m ke {name(l['to_station'])})")
    return f"{round(c/60)} mnt | " + " ; ".join(out)


summary = {}
for tgt in TARGETS:
    cands = sorted(results[tgt], key=lambda x: x[0])
    seen = set()
    print(f"\n##### {tgt}")
    k = 0
    for c, legs in cands:
        key = tuple(l.get("route_id", "W") for l in legs)
        if key in seen:
            continue
        seen.add(key)
        print("  ", describe(c, legs))
        k += 1
        if k >= 5:
            break
    if cands:
        summary[tgt] = cands[0]

if "--json" in sys.argv:
    print(json.dumps({k: {"cost": v[0], "legs": v[1]} for k, v in summary.items()}, indent=1))
