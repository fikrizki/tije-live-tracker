"""Eksplorasi GTFS resmi Transjakarta: tampilkan trip & urutan halte untuk rute tertentu."""
import csv
import sys
from collections import defaultdict
from pathlib import Path

GTFS = Path(__file__).resolve().parent.parent / "data" / "gtfs"


def read(name):
    with open(GTFS / name, encoding="utf-8-sig", newline="") as f:
        return [{k.strip(): (v or "").strip() for k, v in r.items()} for r in csv.DictReader(f)]


stops = {s["stop_id"]: s for s in read("stops.txt")}
trips = read("trips.txt")
freqs = defaultdict(list)
for f in read("frequencies.txt"):
    freqs[f["trip_id"]].append(f)
st = defaultdict(list)
for r in read("stop_times.txt"):
    st[r["trip_id"]].append(r)

routes = sys.argv[1:] or ["1", "3", "3F", "6", "6A", "6B", "8", "9"]
for t in trips:
    if t["route_id"] not in routes:
        continue
    seq = sorted(st[t["trip_id"]], key=lambda r: int(r["stop_sequence"]))
    print(f"\n=== {t['route_id']} | {t['trip_id']} | svc={t['service_id']} dir={t['direction_id']} | {t['trip_headsign']} | shape={t['shape_id']}")
    print("   freq:", [(f["start_time"], f["end_time"], f["headway_secs"]) for f in freqs[t["trip_id"]]])
    print("   " + " > ".join(f"{stops[r['stop_id']]['stop_name']}[{r['stop_id']}@{r['arrival_time'][:5]}]" for r in seq))
