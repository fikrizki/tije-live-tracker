"""
Builder dataset SEMUA RUTE Transjakarta dari GTFS resmi.

Output:
  web/routes-index.js       window.TIJE_INDEX = {...}
      katalog 241 rute (kategori, warna, tarif GTFS, ringkasan jadwal per pola trip),
      garis jaringan ringkas per arah, dan daftar halte (dikelompokkan per nama & lokasi)
  web/routes/<route_id>.js  TIJE_ROUTE_LOADED("<route_id>", {...})
      detail satu rute: semua pola trip (shape asli, jarak & waktu antar-halte,
      jendela headway) + tabel halte. Dimuat sesuai kebutuhan saat rute dibuka.

Jalankan setelah data/gtfs/ berisi GTFS terbaru:
  python3 scripts/build_routes.py
"""
import json
import re
from collections import defaultdict
from datetime import datetime

from gtfs_lib import GTFS, ROOT, Feed, meters, read, simplify

WEB = ROOT / "web"
OUT_INDEX = WEB / "routes-index.js"
OUT_DIR = WEB / "routes"

CATEGORY_ORDER = ["BRT", "Angkutan Umum Integrasi", "Transjabodetabek", "Royaltrans", "Mikrotrans", "Rusun", "Bus Wisata"]
PLACE_RADIUS_M = 350  # halte bernama sama dalam radius ini digabung jadi satu titik pencarian

feed = Feed()


# ---------------------------------------------------------------- warna chip (WCAG AA)
def _lum(hexcol):
    h = hexcol.lstrip("#")
    rgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def contrast(a, b):
    la, lb = sorted((_lum(a), _lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def chip_colors(r):
    bg = "#" + (r["route_color"] or "1351a8").upper()
    fg = "#" + (r["route_text_color"] or "FFFFFF").upper()
    if contrast(bg, fg) < 4.5:
        # Pasangan warna GTFS tidak lolos AA untuk teks 12px: pakai hitam/putih yang lebih kontras
        fg = "#000000" if contrast(bg, "#000000") >= contrast(bg, "#FFFFFF") else "#FFFFFF"
    return bg, fg


def natural_key(s):
    return [int(x) if x.isdigit() else x for x in re.split(r"(\d+)", s)]


# ---------------------------------------------------------------- tarif GTFS
fare_price = {f["fare_id"]: int(float(f["price"])) for f in read("fare_attributes.txt")}
route_fare = {fr["route_id"]: fare_price.get(fr["fare_id"]) for fr in read("fare_rules.txt")}

# ---------------------------------------------------------------- halte -> tempat (place)
used_stops = set()
stop_routes = defaultdict(set)
for tid, t in feed.trips.items():
    for x in feed.seqs[tid]:
        used_stops.add(x["stop_id"])
        stop_routes[x["stop_id"]].add(t["route_id"])


def norm_name(n):
    return re.sub(r"\s+", " ", n.strip().lower())


by_name = defaultdict(list)
for sid in used_stops:
    by_name[norm_name(feed.stops[sid]["stop_name"])].append(sid)

places = []          # [name, lat, lon, [route ids]]
stop_place = {}
for _, sids in sorted(by_name.items()):
    clusters = []    # [ [sid...], (lat, lon) ]
    for sid in sorted(sids):
        c = feed.coord(sid)
        for cl in clusters:
            if meters(c, cl[1]) <= PLACE_RADIUS_M:
                cl[0].append(sid)
                break
        else:
            clusters.append([[sid], c])
    for members, _ in clusters:
        lat = sum(feed.coord(s)[0] for s in members) / len(members)
        lon = sum(feed.coord(s)[1] for s in members) / len(members)
        rids = set()
        for s in members:
            rids |= stop_routes[s]
        idx = len(places)
        places.append([feed.stops[members[0]]["stop_name"], round(lat, 6), round(lon, 6),
                       sorted(rids, key=natural_key)])
        for s in members:
            stop_place[s] = idx

# ---------------------------------------------------------------- per rute
trips_by_route = defaultdict(list)
for tid, t in feed.trips.items():
    trips_by_route[t["route_id"]].append(tid)

OUT_DIR.mkdir(parents=True, exist_ok=True)
for old in OUT_DIR.glob("*.js"):
    old.unlink()

index_routes = []
total_bytes = 0
for rid, r in feed.routes.items():
    tids = trips_by_route.get(rid, [])
    if not tids:
        continue
    patterns = {}
    for tid in tids:
        p = feed.build_pattern(tid)
        p["label"] = feed.trips[tid]["trip_short_name"] or p["headsign"]
        p["loop"] = feed.station(p["stops"][0]) == feed.station(p["stops"][-1])
        p["length"] = round(p["shapeDist"][-1])
        patterns[tid] = p
    # Urutan varian: arah 0 dulu, lalu lintasan terpanjang (jumlah halte) di depan
    order = sorted(tids, key=lambda x: (patterns[x]["direction_id"], patterns[x]["loop"], -len(patterns[x]["stops"]), x))

    stop_table = {}
    for p in patterns.values():
        for sid in p["stops"]:
            la, lo = feed.coord(sid)
            stop_table[sid] = {"name": feed.stops[sid]["stop_name"], "lat": la, "lon": lo,
                               "station": feed.station(sid), "pl": stop_place.get(sid)}

    fname = re.sub(r"[^A-Za-z0-9._-]", "_", rid) + ".js"
    payload = {"patterns": patterns, "order": order, "stops": stop_table}
    text = "TIJE_ROUTE_LOADED(" + json.dumps(rid) + "," + json.dumps(payload, separators=(",", ":"), ensure_ascii=False) + ");\n"
    (OUT_DIR / fname).write_text(text, encoding="utf-8")
    total_bytes += len(text.encode())

    # Garis jaringan ringkas: satu shape terpanjang per arah
    lines = {}
    for tid in tids:
        d = feed.trips[tid]["direction_id"]
        sh = feed.raw_shape(tid)
        if d not in lines or len(sh) > len(lines[d]):
            lines[d] = sh
    net = [[[round(a, 5), round(b, 5)] for a, b in simplify(sh, 25.0)] for _, sh in sorted(lines.items())]
    lats = [pt[0] for ln in net for pt in ln]
    lons = [pt[1] for ln in net for pt in ln]

    main = patterns[order[0]]
    bg, fg = chip_colors(r)
    index_routes.append({
        "id": rid,
        "short": r["route_short_name"],
        "long": r["route_long_name"],
        "cat": r["route_desc"] or "Lainnya",
        "color": bg,
        "text": fg,
        "fare": route_fare.get(rid),
        "file": fname,
        "stops": len({feed.station(s) for p in patterns.values() for s in p["stops"]}),
        "km": round(max(p["length"] for p in patterns.values()) / 1000, 1),
        "variants": len(tids),
        "heads": sorted({patterns[t]["headsign"] for t in order}, key=lambda h: order.index(next(t for t in order if patterns[t]["headsign"] == h))),
        # [service_id, durasi tempuh (detik), jendela headway] per pola: untuk jam operasi & jumlah bus aktif
        "sched": [[patterns[t]["service_id"], patterns[t]["t"][-1], patterns[t]["freq"]] for t in order],
        "main": main["label"],
        "lines": net,
        "bbox": [min(lats), min(lons), max(lats), max(lons)],
    })

cat_rank = {c: i for i, c in enumerate(CATEGORY_ORDER)}
index_routes.sort(key=lambda x: (cat_rank.get(x["cat"], 99), natural_key(x["short"])))
cats = defaultdict(int)
for x in index_routes:
    cats[x["cat"]] += 1
categories = [{"id": c, "count": cats[c]} for c in sorted(cats, key=lambda c: cat_rank.get(c, 99))]

feed_date = datetime.fromtimestamp((GTFS / "stop_times.txt").stat().st_mtime).strftime("%Y-%m-%d")
index = {
    "generatedAt": datetime.now().isoformat(timespec="seconds"),
    "feedDate": feed_date,
    "source": "https://gtfs.transjakarta.co.id/files/file_gtfs.zip (CC BY 4.0)",
    "calendar": feed.calendar,
    "categories": categories,
    "routes": index_routes,
    "places": places,
}
OUT_INDEX.write_text("window.TIJE_INDEX = " + json.dumps(index, separators=(",", ":"), ensure_ascii=False) + ";\n", encoding="utf-8")

print(f"OK -> {OUT_INDEX.relative_to(ROOT)} ({OUT_INDEX.stat().st_size / 1024:.0f} KB)")
print(f"OK -> {OUT_DIR.relative_to(ROOT)}/ {len(index_routes)} file ({total_bytes / 1024:.0f} KB total)")
print(f"   rute: {len(index_routes)} | pola trip: {sum(x['variants'] for x in index_routes)} | halte (tempat): {len(places)}")
for c in categories:
    print(f"   {c['id']}: {c['count']}")
fixed = [x["short"] for x in index_routes if x["text"] != "#" + (feed.routes[x["id"]]["route_text_color"] or "FFFFFF").upper()]
print(f"   warna teks chip disesuaikan ke AA: {len(fixed)} rute")
