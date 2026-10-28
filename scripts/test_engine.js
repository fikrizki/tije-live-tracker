// Uji cepat engine di Node: node scripts/test_engine.js [HH:MM]
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const E = require("../web/engine.js");

const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../web/data.js"), "utf8"), ctx);
const D = ctx.window.TIJE_DATA;

let clock = E.wibNow();
if (process.argv[2]) {
  const [h, m] = process.argv[2].split(":").map(Number);
  clock = { ...clock, sec: h * 3600 + m * 60 };
}
console.log("WIB", E.fmtClock(clock.sec, true), "weekday", clock.weekday);

// 1) Validasi data: jarak halte monoton & kecepatan antar-halte wajar
let warn = 0;
for (const [tid, p] of Object.entries(D.patterns)) {
  for (let i = 1; i < p.stops.length; i++) {
    const dd = p.stopDist[i] - p.stopDist[i - 1];
    const dt = p.t[i] - p.t[i - 1];
    const kmh = dt > 0 ? (dd / dt) * 3.6 : 0;
    if (dd < 0 || (dt > 0 && kmh > 80) || (dd < 30 && dt > 120 && p.stops[i] !== p.stops[i - 1])) {
      if (warn++ < 15) console.log("  WARN", tid, i, D.stops[p.stops[i - 1]].name, "->", D.stops[p.stops[i]].name, Math.round(dd) + "m", dt + "s", Math.round(kmh) + "km/j");
    }
  }
}
console.log("Peringatan data:", warn);

// 2) Armada & rencana perjalanan
for (const j of D.journeys) {
  const tids = [...new Set(j.legs.flatMap((l) => l.patterns || []))];
  const f = E.fleet(D, tids, clock);
  const plan = E.planJourney(D, j, clock);
  console.log(`\n${j.id} -> ${j.dest}: ${f.length} bus aktif | durasi ${Math.round(plan.duration / 60)} mnt, tiba ${E.fmtClock(plan.end)}`);
  for (const s of plan.steps) {
    if (s.type === "walk") console.log(`   jalan ${s.meters} m (${Math.round((s.end - s.start) / 60)} mnt)`);
    else console.log(`   [${s.routeId}] ${D.stops[s.from].name} ${E.fmtClock(s.board)} -> ${D.stops[s.to].name} ${E.fmtClock(s.end)} | tunggu ${Math.round(s.wait / 60)} mnt | ${s.stopsCount} halte | next: ${s.upcoming.map((u) => E.fmtClock(u.at)).join(", ")}`);
  }
  f.slice(0, 3).forEach((b) => console.log(`   bus ${b.label} ${b.headsign} @ ${b.lat.toFixed(5)},${b.lon.toFixed(5)} ${b.stopped ? "berhenti " + D.stops[b.atStop].name : "-> " + D.stops[b.nextStop].name + " " + b.etaNext + "s " + b.speedKmh + "km/j"}`));
}
