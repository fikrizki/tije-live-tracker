"""
Utilitas bersama untuk membaca GTFS resmi Transjakarta dan membentuk pola trip.

Dipakai oleh build_data.py (4 perjalanan Rasuna Said) dan build_routes.py (semua rute).
"""
import csv
import math
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GTFS = ROOT / "data" / "gtfs"


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


class Feed:
    """GTFS yang sudah dimuat ke memori, plus pembentuk pola trip untuk web app."""

    def __init__(self):
        self.stops = {s["stop_id"]: s for s in read("stops.txt")}
        self.routes = {r["route_id"]: r for r in read("routes.txt")}
        self.trips = {t["trip_id"]: t for t in read("trips.txt")}
        self.freq = defaultdict(list)
        for f in read("frequencies.txt"):
            self.freq[f["trip_id"]].append([tsec(f["start_time"]), tsec(f["end_time"]), int(f["headway_secs"])])
        self.seqs = defaultdict(list)
        for r in read("stop_times.txt"):
            self.seqs[r["trip_id"]].append(r)
        for k in self.seqs:
            self.seqs[k].sort(key=lambda x: int(x["stop_sequence"]))
        shapes = defaultdict(list)
        for r in read("shapes.txt"):
            shapes[r["shape_id"]].append((int(r["shape_pt_sequence"]), float(r["shape_pt_lat"]), float(r["shape_pt_lon"])))
        self.shapes = {}
        for k, v in shapes.items():
            v.sort()
            self.shapes[k] = [(la, lo) for _, la, lo in v]
        self.calendar = {
            c["service_id"]: [int(c[d]) for d in
                              ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")]
            for c in read("calendar.txt")
        }

    def station(self, sid):
        return self.stops[sid]["parent_station"] or sid

    def coord(self, sid):
        return float(self.stops[sid]["stop_lat"]), float(self.stops[sid]["stop_lon"])

    def raw_shape(self, tid):
        t = self.trips[tid]
        return self.shapes.get(t["shape_id"]) or [self.coord(x["stop_id"]) for x in self.seqs[tid]]

    def build_pattern(self, tid, tol=4.0):
        """Pola trip: shape tersederhana + jarak kumulatif halte + offset waktu + jendela headway."""
        t = self.trips[tid]
        seq = self.seqs[tid]
        base = tsec(seq[0]["arrival_time"])
        stop_ids = [x["stop_id"] for x in seq]
        toffs = [tsec(x["arrival_time"]) - base for x in seq]
        raw = self.raw_shape(tid)

        # Proyeksikan halte ke shape (maju searah urutan, aman untuk rute loop)
        cum = [0.0]
        for i in range(1, len(raw)):
            cum.append(cum[-1] + meters(raw[i - 1], raw[i]))
        stop_dist = []
        seg = 0
        for sid in stop_ids:
            p = self.coord(sid)
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

        simp = simplify(raw, tol)
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
            "freq": sorted(self.freq[tid]),
        }
