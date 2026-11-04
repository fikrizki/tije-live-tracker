/*
 * TIJE Engine: mesin posisi armada & ETA berbasis GTFS resmi Transjakarta.
 *
 * Posisi tiap bus dihitung dari:
 *   frequencies.txt  -> jendela operasi & headway (bus berangkat tiap N detik)
 *   stop_times.txt   -> offset waktu tiba di tiap halte
 *   shapes.txt       -> geometri jalan; bus diinterpolasi di sepanjang jalur asli
 * Semua dihitung terhadap jam aktual Asia/Jakarta (WIB, UTC+7).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TijeEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DAY = 86400;
  const MAX_DWELL = 20;     // waktu berhenti maksimum di halte (detik)

  /** Jam aktual WIB, tidak bergantung zona waktu perangkat. */
  function wibNow(ms) {
    const now = ms == null ? Date.now() : ms;
    const wib = new Date(now + 7 * 3600 * 1000); // baca via getUTC*
    const sec = wib.getUTCHours() * 3600 + wib.getUTCMinutes() * 60 + wib.getUTCSeconds() + wib.getUTCMilliseconds() / 1000;
    const jsDay = wib.getUTCDay(); // 0=Minggu
    return { ms: now, sec, weekday: (jsDay + 6) % 7 /* 0=Senin */, date: wib };
  }

  function fmtClock(sec, withSec) {
    const s = ((Math.floor(sec) % DAY) + DAY) % DAY;
    const h = String(Math.floor(s / 3600)).padStart(2, "0");
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    if (!withSec) return `${h}:${m}`;
    return `${h}:${m}:${String(s % 60).padStart(2, "0")}`;
  }

  function fmtWait(sec) {
    if (sec < 45) return "Tiba";
    const m = Math.round(sec / 60);
    return m < 60 ? `${m} mnt` : `${Math.floor(m / 60)} j ${m % 60} m`;
  }

  function serviceActive(data, serviceId, weekday) {
    const c = data.calendar[serviceId];
    return !c || c[weekday] === 1;
  }

  /** Daftar keberangkatan (dari halte awal pola) yang busnya sedang di jalan pada detik `now`. */
  function activeDepartures(p, now) {
    const T = p.t[p.t.length - 1];
    const out = [];
    for (const shift of [0, DAY]) {   // shift DAY: trip kemarin yang melewati tengah malam
      const n = now + shift;
      for (const [s, e, h] of p.freq) {
        const lo = Math.max(s, n - T);
        const hi = Math.min(e - 1, n);
        if (lo > hi) continue;
        let k = Math.ceil((lo - s) / h);
        for (let d = s + k * h; d <= hi; d += h) out.push({ dep: d - shift, elapsed: n - d });
      }
    }
    return out;
  }

  /** Titik (lat, lon) & arah pada jarak `dist` meter di sepanjang shape. */
  function pointAtDist(p, dist) {
    const D = p.shapeDist;
    if (dist <= 0) return { lat: p.shape[0][0], lon: p.shape[0][1], i: 0 };
    let lo = 0, hi = D.length - 1;
    if (dist >= D[hi]) return { lat: p.shape[hi][0], lon: p.shape[hi][1], i: hi - 1 };
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (D[mid] <= dist) lo = mid; else hi = mid;
    }
    const f = (dist - D[lo]) / Math.max(1e-6, D[hi] - D[lo]);
    const a = p.shape[lo], b = p.shape[hi];
    return { lat: a[0] + (b[0] - a[0]) * f, lon: a[1] + (b[1] - a[1]) * f, i: lo };
  }

  function bearingAt(p, i) {
    const a = p.shape[Math.max(0, i)], b = p.shape[Math.min(p.shape.length - 1, i + 1)];
    const toR = Math.PI / 180;
    const y = Math.sin((b[1] - a[1]) * toR) * Math.cos(b[0] * toR);
    const x = Math.cos(a[0] * toR) * Math.sin(b[0] * toR) - Math.sin(a[0] * toR) * Math.cos(b[0] * toR) * Math.cos((b[1] - a[1]) * toR);
    return (Math.atan2(y, x) / toR + 360) % 360;
  }

  /** Status bus pada `elapsed` detik setelah berangkat dari halte awal pola. */
  function vehicleState(p, elapsed) {
    const t = p.t;
    let i = 0;
    while (i < t.length - 2 && elapsed >= t[i + 1]) i++;
    const segT = Math.max(1, t[i + 1] - t[i]);
    const dwell = Math.min(MAX_DWELL, segT * 0.25);
    const inSeg = elapsed - t[i];
    let dist, stopped = false, speed = 0;
    const dA = p.stopDist[i], dB = p.stopDist[i + 1];
    if (inSeg < dwell) {
      dist = dA;
      stopped = true;
    } else {
      // percepatan & perlambatan halus (smoothstep) seperti bus sungguhan
      const x = Math.min(1, (inSeg - dwell) / (segT - dwell));
      const eased = x * x * (3 - 2 * x);
      dist = dA + (dB - dA) * eased;
      const avg = (dB - dA) / (segT - dwell);           // m/s rata-rata
      speed = avg * 6 * x * (1 - x) * 3.6;              // turunan smoothstep -> km/j
    }
    const pt = pointAtDist(p, dist);
    return {
      lat: pt.lat, lon: pt.lon, bearing: bearingAt(p, pt.i),
      segIndex: i, stopped, speedKmh: Math.max(0, Math.round(speed)),
      atStop: stopped ? p.stops[i] : null,
      nextStop: stopped ? p.stops[i] : p.stops[i + 1],
      etaNext: stopped ? 0 : Math.max(0, Math.round(t[i + 1] - elapsed)),
      progress: dist / p.shapeDist[p.shapeDist.length - 1],
    };
  }

  /** Semua bus aktif untuk daftar pola trip pada detik WIB `now`. */
  function fleet(data, tripIds, clock) {
    const out = [];
    for (const tid of tripIds) {
      const p = data.patterns[tid];
      if (!p || !serviceActive(data, p.service_id, clock.weekday)) continue;
      for (const { dep, elapsed } of activeDepartures(p, clock.sec)) {
        const st = vehicleState(p, elapsed);
        out.push(Object.assign({
          id: `${tid}@${Math.round(dep)}`,
          tripId: tid, routeId: p.route_id, headsign: p.headsign,
          dep, elapsed, label: `${data.routes[p.route_id].short}·${fmtClock(dep).replace(":", "")}`,
        }, st));
      }
    }
    return out;
  }

  /** Kedatangan berikutnya pola `p` di posisi halte `pos` setelah detik `after`. */
  function nextArrivals(p, pos, after, count) {
    const off = p.t[pos];
    const res = [];
    for (const shift of [0, DAY]) {
      for (const [s, e, h] of p.freq) {
        const target = after - off + shift;
        let k = Math.max(0, Math.ceil((target - s) / h));
        for (let d = s + k * h; d < e && res.length < 50; d += h) {
          res.push(d + off - shift);
          if (d + off - shift > after + 4 * 3600) break;
        }
      }
    }
    return res.filter((x) => x >= after).sort((a, b) => a - b).slice(0, count || 3);
  }

  function stationOf(data, sid) {
    return (data.stops[sid] && data.stops[sid].station) || sid;
  }

  function haversine(a, b) {
    const R = 6371000, toR = Math.PI / 180;
    const dLat = (b[0] - a[0]) * toR, dLon = (b[1] - a[1]) * toR;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /** Headway (detik) yang berlaku pada detik `sec`, atau null jika di luar jendela operasi. */
  function headwayAt(freq, sec) {
    let best = null;
    for (const [s, e, h] of freq) if (sec >= s && sec < e && (best == null || h < best)) best = h;
    return best;
  }

  /** Keberangkatan terakhir dari terminal awal dalam satu set jendela frekuensi. */
  function lastDeparture(freq) {
    let last = -1;
    for (const [s, e, h] of freq) last = Math.max(last, s + Math.floor((e - 1 - s) / h) * h);
    return last;
  }

  /**
   * Status operasi satu rute dari ringkasan jadwal di katalog (routes-index.js).
   * route.sched = [[service_id, durasi tempuh (detik), [[start, end, headway], ...]], ...]
   * Hasil: jumlah bus yang sedang di jalan (estimasi jadwal), jam keberangkatan pertama &
   * terakhir hari ini, dan state: "run" | "before" (belum mulai) | "after" (sudah selesai) | "off" (tidak ada layanan hari ini).
   */
  function routeLive(calendar, route, clock) {
    let buses = 0, first = null, last = null, next = null, allDay = false;
    for (const [svc, T, freq] of route.sched) {
      const c = calendar[svc];
      if (c && c[clock.weekday] !== 1) continue;
      buses += activeDepartures({ t: [0, T], freq }, clock.sec).length;
      for (const [s, e, h] of freq) {
        if (first == null || s < first) first = s;
        // keberangkatan berikutnya dari terminal awal (untuk rute berfrekuensi jarang)
        const k = Math.max(0, Math.ceil((clock.sec - s) / h));
        const d = s + k * h;
        if (d < e && (next == null || d < next)) next = d;
      }
      const l = lastDeparture(freq);
      if (last == null || l > last) last = l;
      if (freq.some(([s, e]) => s === 0 && e >= DAY - 1)) allDay = true;
    }
    let state;
    if (first == null) state = "off";
    else if (buses > 0) state = "run";
    else if (next != null) state = clock.sec < first ? "before" : "wait";
    else state = "after";
    return { buses, first, last, next, allDay, state };
  }

  return {
    wibNow, fmtClock, fmtWait, serviceActive, activeDepartures, vehicleState, fleet,
    nextArrivals, pointAtDist, haversine, stationOf,
    headwayAt, lastDeparture, routeLive,
  };
});
