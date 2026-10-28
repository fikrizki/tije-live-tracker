"""
Builder dataset web app TIJE Live Tracker dari GTFS resmi Transjakarta.

Output: web/data.js  (window.TIJE_DATA = {...})

Isi dataset:
  - 4 perjalanan (journey) Rasuna Said -> Jakarta Barat hasil route_planner.py
  - pola trip (trip pattern) lengkap: geometri jalan asli (shapes.txt, disederhanakan),
    jarak kumulatif tiap halte di sepanjang shape, offset waktu stop_times, dan
    seluruh jendela headway frequencies.txt (untuk posisi bus per detik)
  - jaringan latar: semua koridor BRT & halte BRT di area peta (seperti app TIJE)
"""
import csv
import json
import math
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GTFS = ROOT / "data" / "gtfs"
OUT = ROOT / "web" / "data.js"

BBOX = (-6.275, 106.680, -6.120, 106.880)  # lat_min, lon_min, lat_max, lon_max


def read(name):
    with open(GTFS / name, encoding="utf-8-sig", newline="") as f:
        return [{k.strip(): (v or "").strip() for k, v in r.items()} for r in csv.DictReader(f)]


def tsec(t):
    h, m, s = (int(x) for x in t.split(":"))
    return h * 3600 + m * 60 + s


def meters(a, b):
    x = math.radians(b[1] - a[1]) * math.cos(math.radians((a[0] + b[0]) / 2))
    y = math.radians(b[0] - a[0])
    return math.hypot(x, y) * 6371000


def simplify(pts, tol):
    """Douglas-Peucker (toleransi meter), iteratif."""
    if len(pts) < 3:
        return pts[:]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        s, e = stack.pop()
        a, b = pts[s], pts[e]
        best, bi = -1, -1
        for i in range(s + 1, e):
            d = point_seg_dist(pts[i], a, b)[0]
            if d > best:
                best, bi = d, i
        if best > tol:
            keep[bi] = True
            stack += [(s, bi), (bi, e)]
    return [p for p, k in zip(pts, keep) if k]


def point_seg_dist(p, a, b):
    """Jarak titik p ke segmen a-b (meter) + parameter t (0..1)."""
    kx = math.cos(math.radians(p[0])) * 111320
    ky = 110540
    ax, ay = (a[1] - p[1]) * kx, (a[0] - p[0]) * ky
    bx, by = (b[1] - p[1]) * kx, (b[0] - p[0]) * ky
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0 if L == 0 else max(0, min(1, -(ax * dx + ay * dy) / L))
    cx, cy = ax + t * dx, ay + t * dy
    return math.hypot(cx, cy), t


def in_bbox(lat, lon, pad=0.0):
    return BBOX[0] - pad <= lat <= BBOX[2] + pad and BBOX[1] - pad <= lon <= BBOX[3] + pad


# ---------------------------------------------------------------- load GTFS
stops = {s["stop_id"]: s for s in read("stops.txt")}
routes = {r["route_id"]: r for r in read("routes.txt")}
trips = {t["trip_id"]: t for t in read("trips.txt")}
freq = defaultdict(list)
for f in read("frequencies.txt"):
    freq[f["trip_id"]].append([tsec(f["start_time"]), tsec(f["end_time"]), int(f["headway_secs"])])
seqs = defaultdict(list)
for r in read("stop_times.txt"):
    seqs[r["trip_id"]].append(r)
shapes = defaultdict(list)
for r in read("shapes.txt"):
    shapes[r["shape_id"]].append((int(r["shape_pt_sequence"]), float(r["shape_pt_lat"]), float(r["shape_pt_lon"])))
for k in shapes:
    shapes[k].sort()
    shapes[k] = [(la, lo) for _, la, lo in shapes[k]]


def station(sid):
    return stops[sid]["parent_station"] or sid


def coord(sid):
    return float(stops[sid]["stop_lat"]), float(stops[sid]["stop_lon"])


def brt(route_id):
    r = routes.get(route_id)
    return bool(r) and r["route_desc"] == "BRT"


# ---------------------------------------------------------------- trip pattern
def build_pattern(tid):
    t = trips[tid]
    seq = sorted(seqs[tid], key=lambda x: int(x["stop_sequence"]))
    base = tsec(seq[0]["arrival_time"])
    stop_ids = [x["stop_id"] for x in seq]
    toffs = [tsec(x["arrival_time"]) - base for x in seq]
    raw = shapes.get(t["shape_id"]) or [coord(s) for s in stop_ids]

    # Proyeksikan halte ke shape (maju searah urutan, aman untuk rute loop)
    cum = [0.0]
    for i in range(1, len(raw)):
        cum.append(cum[-1] + meters(raw[i - 1], raw[i]))
    stop_dist = []
    seg = 0
    for sid in stop_ids:
        p = coord(sid)
        best = (1e18, seg, 0.0)
        found_close = False
        for i in range(seg, len(raw) - 1):
            d, tt = point_seg_dist(p, raw[i], raw[i + 1])
            if d < best[0]:
                best = (d, i, tt)
            if d < 60:
                found_close = True
            elif found_close and d > 400:
                break
        _, bi, bt = best
        dist = cum[bi] + bt * (cum[bi + 1] - cum[bi]) if bi + 1 < len(cum) else cum[-1]
        if stop_dist and dist < stop_dist[-1]:
            dist = stop_dist[-1]
        stop_dist.append(round(dist, 1))
        seg = bi

    simp = simplify(raw, 4.0)
    scum = [0.0]
    for i in range(1, len(simp)):
        scum.append(scum[-1] + meters(simp[i - 1], simp[i]))
    # Skala ulang jarak halte agar konsisten dengan panjang shape tersederhana
    k = scum[-1] / cum[-1] if cum[-1] else 1
    return {
        "route_id": t["route_id"],
        "headsign": t["trip_headsign"],
        "service_id": t["service_id"],
        "direction_id": t["direction_id"],
        "shape": [[round(a, 6), round(b, 6)] for a, b in simp],
        "shapeDist": [round(x, 1) for x in scum],
        "stops": stop_ids,
        "stopDist": [round(d * k, 1) for d in stop_dist],
        "t": toffs,
        "freq": sorted(freq[tid]),
    }


def stations_seq(tid):
    seq = sorted(seqs[tid], key=lambda x: int(x["stop_sequence"]))
    return [station(x["stop_id"]) for x in seq], [tsec(x["arrival_time"]) for x in seq]


def best_pair(tid, from_name, to_name):
    """Cari (i, j) pada trip dengan nama halte asal->tujuan yang waktu tempuhnya paling singkat."""
    seq = sorted(seqs[tid], key=lambda x: int(x["stop_sequence"]))
    names = [stops[x["stop_id"]]["stop_name"] for x in seq]
    ts = [tsec(x["arrival_time"]) for x in seq]
    best = None
    for i, a in enumerate(names):
        if a != from_name:
            continue
        for j in range(i + 1, len(names)):
            if names[j] == to_name and (best is None or ts[j] - ts[i] < best[2]):
                best = (i, j, ts[j] - ts[i])
    if not best:
        raise SystemExit(f"Pasangan {from_name}->{to_name} tidak ditemukan di {tid}")
    return best[0], best[1]


def serving_patterns(route_id, from_station, to_station):
    """Semua pola trip (rute sama) yang melayani from_station lalu to_station."""
    out = []
    for tid, t in trips.items():
        if t["route_id"] != route_id or not freq.get(tid):
            continue
        st, _ = stations_seq(tid)
        for i, s in enumerate(st):
            if s == from_station and to_station in st[i + 1:]:
                out.append(tid)
                break
    return out


# ---------------------------------------------------------------- 4 journey
# Hasil mesin route_planner.py (GTFS resmi, jam siang hari kerja)
JOURNEYS = [
    {
        "id": "J1", "dest": "Grogol Reformasi", "area": "Grogol Petamburan",
        "title": "Via Tol Dalam Kota (Koridor 6 + 9)",
        "legs": [
            ("ride", "6-R04", "Rasuna Said", "Underpass Kuningan"),
            ("walk",),
            ("ride", "9-R01", "Simpang Kuningan", "Grogol Reformasi"),
        ],
    },
    {
        "id": "J2", "dest": "Rawa Buaya", "area": "Cengkareng",
        "title": "Via Balai Kota (6A + 2A)",
        "legs": [
            ("ride", "6A-R08", "Rasuna Said", "Balai Kota"),
            ("ride", "2A-L02", "Balai Kota", "Rawa Buaya"),
        ],
    },
    {
        "id": "J3", "dest": "Kalideres", "area": "Kalideres",
        "title": "Via Thamrin & Monas (6A + 1 + 3)",
        "legs": [
            ("ride", "6A-R08", "Rasuna Said", "Bundaran HI Astra"),
            ("ride", "1-R07", "Bundaran HI Astra", "Monumen Nasional"),
            ("ride", "3-L04", "Monumen Nasional", "Kalideres"),
        ],
    },
    {
        "id": "J4", "dest": "Kebon Jeruk", "area": "Kebon Jeruk",
        "title": "Via Tol Layang Express (L13E + 8)",
        "legs": [
            ("ride", "L13E-R11", "Rasuna Said", "Velbak"),
            ("walk",),
            ("ride", "8-R03", "Kebayoran", "Kebon Jeruk"),
        ],
    },
]

patterns = {}
out_journeys = []
for j in JOURNEYS:
    legs = []
    for leg in j["legs"]:
        if leg[0] == "walk":
            legs.append({"type": "walk"})
            continue
        _, tid, fname, tname = leg
        i, k = best_pair(tid, fname, tname)
        seq = sorted(seqs[tid], key=lambda x: int(x["stop_sequence"]))
        from_sid, to_sid = seq[i]["stop_id"], seq[k]["stop_id"]
        serv = serving_patterns(trips[tid]["route_id"], station(from_sid), station(to_sid))
        if tid not in serv:
            serv.insert(0, tid)
        for s in serv:
            if s not in patterns:
                patterns[s] = build_pattern(s)
        legs.append({
            "type": "ride", "route_id": trips[tid]["route_id"], "trip_id": tid,
            "from_pos": i, "to_pos": k, "from": from_sid, "to": to_sid,
            "patterns": serv,
        })
    # Isi detail leg jalan kaki (JPO / trotoar) dari leg sebelum & sesudahnya
    for n, leg in enumerate(legs):
        if leg["type"] == "walk":
            a, b = legs[n - 1]["to"], legs[n + 1]["from"]
            leg.update({"from": a, "to": b, "meters": round(meters(coord(a), coord(b)))})
    out_journeys.append({k: v for k, v in j.items() if k != "legs"} | {"legs": legs})

# ---------------------------------------------------------------- jaringan latar
net_lines = {}
station_routes = defaultdict(set)
for tid, t in trips.items():
    if not brt(t["route_id"]) or not freq.get(tid):
        continue
    sh = shapes.get(t["shape_id"])
    for x in seqs[tid]:
        station_routes[station(x["stop_id"])].add(t["route_id"])
    if not sh:
        continue
    key = (t["route_id"], t["direction_id"])
    # Satu shape terpanjang per (rute, arah) cukup untuk peta latar
    if key not in net_lines or len(sh) > len(net_lines[key][1]):
        net_lines[key] = (tid, sh)

network = []
for (rid, _), (_, sh) in net_lines.items():
    if not any(in_bbox(a, b) for a, b in sh):
        continue
    simp = simplify(sh, 12.0)
    network.append({"route_id": rid, "coords": [[round(a, 5), round(b, 5)] for a, b in simp]})

net_stations = []
for st_id, rids in station_routes.items():
    la, lo = coord(st_id)
    if not in_bbox(la, lo):
        continue
    net_stations.append({
        "id": st_id, "name": stops[st_id]["stop_name"], "lat": la, "lon": lo,
        "routes": sorted(rids, key=lambda r: (len(r), r)),
    })

# ---------------------------------------------------------------- tabel halte & rute
used_stops = set()
for p in patterns.values():
    used_stops.update(p["stops"])
stop_table = {}
for sid in used_stops:
    la, lo = coord(sid)
    stop_table[sid] = {"name": stops[sid]["stop_name"], "lat": la, "lon": lo, "station": station(sid)}

used_routes = {p["route_id"] for p in patterns.values()} | {n["route_id"] for n in network}
route_table = {
    rid: {
        "short": routes[rid]["route_short_name"], "long": routes[rid]["route_long_name"],
        "color": "#" + (routes[rid]["route_color"] or "1d4ed8"),
        "text": "#" + (routes[rid]["route_text_color"] or "FFFFFF"),
    }
    for rid in used_routes
}

calendar = {}
for c in read("calendar.txt"):
    calendar[c["service_id"]] = [int(c[d]) for d in
                                 ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")]

feed_date = datetime.fromtimestamp((GTFS / "stop_times.txt").stat().st_mtime).strftime("%Y-%m-%d")
data = {
    "generatedAt": datetime.now().isoformat(timespec="seconds"),
    "feedDate": feed_date,
    "source": "https://gtfs.transjakarta.co.id/files/file_gtfs.zip (CC BY 4.0)",
    "fare": 3500,
    "calendar": calendar,
    "routes": route_table,
    "stops": stop_table,
    "patterns": patterns,
    "journeys": out_journeys,
    "network": network,
    "networkStations": net_stations,
}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text("window.TIJE_DATA = " + json.dumps(data, separators=(",", ":"), ensure_ascii=False) + ";\n", encoding="utf-8")

print(f"OK -> {OUT} ({OUT.stat().st_size/1024:.0f} KB)")
print(f"   patterns: {len(patterns)} | network lines: {len(network)} | stations: {len(net_stations)}")
for j in out_journeys:
    print("  ", j["id"], j["dest"], "|", " + ".join(
        (f"{l['route_id']}[{len(l['patterns'])} pola]" if l["type"] == "ride" else f"jalan {l['meters']}m") for l in j["legs"]))
