/*
 * Uji dataset semua rute: tiap file web/routes/<id>.js bisa dimuat, konsisten dengan
 * katalog web/routes-index.js, dan bisa dipakai TijeEngine (armada, ETA, status operasi).
 *   node scripts/test_routes.js
 */
const path = require("path");
const WEB = path.join(__dirname, "..", "web");
global.window = {};
require(path.join(WEB, "routes-index.js"));
const E = require(path.join(WEB, "engine.js"));
const X = window.TIJE_INDEX;

let fails = 0;
const fail = (m) => { fails++; console.log("  FAIL", m); };
const clock = E.wibNow();
const RD = { patterns: {}, stops: {}, routes: {}, calendar: X.calendar };
let payload = null;
global.TIJE_ROUTE_LOADED = (rid, p) => { payload = { rid, p }; };

let patterns = 0, buses = 0;
const states = {};
for (const r of X.routes) {
  RD.routes[r.id] = r;
  payload = null;
  require(path.join(WEB, "routes", r.file));
  if (!payload || payload.rid !== r.id) { fail(`${r.id}: file ${r.file} tidak memanggil TIJE_ROUTE_LOADED`); continue; }
  const { p } = payload;
  if (p.order.length !== r.variants) fail(`${r.id}: jumlah varian ${p.order.length} != katalog ${r.variants}`);
  for (const tid of p.order) {
    const pt = p.patterns[tid];
    patterns++;
    if (pt.route_id !== r.id) fail(`${tid}: route_id salah`);
    if (pt.stops.length !== pt.t.length || pt.stops.length !== pt.stopDist.length) fail(`${tid}: panjang array halte tidak sama`);
    for (let i = 1; i < pt.stopDist.length; i++) if (pt.stopDist[i] < pt.stopDist[i - 1]) { fail(`${tid}: stopDist mundur di ${i}`); break; }
    for (const sid of pt.stops) if (!p.stops[sid]) { fail(`${tid}: halte ${sid} tidak ada di tabel`); break; }
    if (!pt.freq.length) fail(`${tid}: tanpa jendela frekuensi`);
    RD.patterns[tid] = pt;
  }
  Object.assign(RD.stops, p.stops);
  const f = E.fleet(RD, p.order, clock);
  for (const b of f) if (!isFinite(b.lat) || !isFinite(b.lon)) { fail(`${r.id}: posisi bus NaN`); break; }
  const live = E.routeLive(X.calendar, r, clock);
  if (live.state === "run" && live.buses !== f.length) fail(`${r.id}: routeLive ${live.buses} != fleet ${f.length}`);
  buses += f.length;
  states[live.state] = (states[live.state] || 0) + 1;
  // Jika rute masih punya keberangkatan hari ini, minimal satu varian aktif harus punya ETA di halte awal
  if (live.state === "run" || live.state === "wait" || live.state === "before") {
    const any = p.order.some((tid) => E.serviceActive(RD, p.patterns[tid].service_id, clock.weekday) &&
      E.nextArrivals(p.patterns[tid], 0, clock.sec, 1).length);
    if (!any) fail(`${r.id}: status ${live.state} tapi tidak ada kedatangan berikutnya`);
  }
}
for (const pl of X.places) if (!pl[3].every((rid) => RD.routes[rid])) { fail(`halte ${pl[0]} merujuk rute tak dikenal`); break; }

console.log(`WIB ${E.fmtClock(clock.sec, true)} | ${X.routes.length} rute | ${patterns} pola trip | ${X.places.length} halte | ${buses} bus aktif`);
console.log("status:", JSON.stringify(states));
console.log(fails ? `${fails} kegagalan` : "OK semua rute lolos");
process.exit(fails ? 1 : 0);
