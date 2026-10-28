/* TIJE Live — UI peta & panel. Bergantung pada: Leaflet, TIJE_DATA, TijeEngine, TIJE_CONFIG. */
(function () {
  "use strict";

  const D = window.TIJE_DATA;
  const E = window.TijeEngine;
  const CFG = window.TIJE_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const DAYS = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];

  const state = {
    journey: 0,
    selectedBus: null,
    follow: false,
    allBuses: false,
    expanded: {},          // leg index -> daftar halte terbuka
    liveVehicles: [],      // dari liveFeedUrl (opsional)
    lastPanelSec: -1,
  };

  // ======================================================================= helpers
  const route = (rid) => D.routes[rid] || { short: rid, color: "#1351a8", text: "#fff" };
  const stop = (sid) => D.stops[sid];
  const chip = (rid) => {
    const r = route(rid);
    return `<span class="chip" style="background:${r.color};color:${r.text}">${r.short}</span>`;
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const journeyPatterns = (j, all) => [
    ...new Set(j.legs.filter((l) => l.type === "ride").flatMap((l) => (all ? l.patterns : [l.trip_id]))),
  ];

  function sliceShape(p, d0, d1) {
    const out = [];
    const a = E.pointAtDist(p, d0);
    out.push([a.lat, a.lon]);
    for (let i = 0; i < p.shape.length; i++) {
      if (p.shapeDist[i] > d0 && p.shapeDist[i] < d1) out.push(p.shape[i]);
    }
    const b = E.pointAtDist(p, d1);
    out.push([b.lat, b.lon]);
    return out;
  }

  // Cache posisi leg per (leg, pola)
  const legPosCache = new Map();
  function legPos(leg, tid) {
    const k = leg.from + ">" + leg.to + "|" + tid;
    if (!legPosCache.has(k)) legPosCache.set(k, E.legPositions(D, D.patterns[tid], leg.from, leg.to));
    return legPosCache.get(k);
  }

  // ======================================================================= peta
  const map = L.map("map", { zoomControl: false, preferCanvas: false, minZoom: 11, maxZoom: 19 })
    .setView([-6.195, 106.79], 13);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.control.scale({ position: "bottomleft", imperial: false }).addTo(map);

  const base = {
    "Peta Jalan (OSM)": L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }),
    "Peta Detail (Esri)": L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
      attribution: "Tiles &copy; Esri",
    }),
    "Satelit": L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
      attribution: "Tiles &copy; Esri",
    }),
  };
  base["Peta Jalan (OSM)"].addTo(map);
  L.control.layers(base, null, { position: "bottomright" }).addTo(map);

  map.createPane("network").style.zIndex = 380;
  map.createPane("legs").style.zIndex = 410;
  map.createPane("stations").style.zIndex = 430;
  map.createPane("legStops").style.zIndex = 450;
  map.createPane("buses").style.zIndex = 620;
  map.createPane("pins").style.zIndex = 640;

  function syncZoomClass() {
    const z = map.getZoom();
    const c = map.getContainer().classList;
    c.toggle("zoom-lt13", z < 13);
    c.toggle("zoom-lt14", z < 14);
    c.toggle("zoom-lt16", z < 16);
  }
  map.on("zoomend", syncZoomClass);
  syncZoomClass();

  // --------------------------------------------------- jaringan BRT latar (seperti peta TIJE)
  const networkLayer = L.layerGroup().addTo(map);
  for (const n of D.network) {
    L.polyline(n.coords, {
      pane: "network", color: route(n.route_id).color, weight: 3, opacity: 0.28, interactive: false,
    }).addTo(networkLayer);
  }
  for (const s of D.networkStations) {
    const m = L.circleMarker([s.lat, s.lon], {
      pane: "stations", radius: 4, color: "#5b6b82", weight: 1.5, fillColor: "#fff", fillOpacity: 1,
    }).addTo(networkLayer);
    m.bindTooltip(esc(s.name), { permanent: true, direction: "right", offset: [6, 0], className: "stop-label net" });
    m.on("click", () => openStationPopup(s.id, [s.lat, s.lon]));
  }
  $("chkNetwork").addEventListener("change", (e) => {
    if (e.target.checked) networkLayer.addTo(map); else map.removeLayer(networkLayer);
  });

  // --------------------------------------------------- gambar perjalanan terpilih
  const journeyLayer = L.layerGroup().addTo(map);
  let journeyBounds = null;

  function pinIcon(color, label) {
    return L.divIcon({
      className: "pin", iconSize: [30, 30], iconAnchor: [4, 34],
      html: `<div class="pin-body" style="background:${color}"><span>${label}</span></div>`,
    });
  }

  function drawJourney() {
    journeyLayer.clearLayers();
    const j = D.journeys[state.journey];
    const all = [];
    j.legs.forEach((leg, li) => {
      if (leg.type === "walk") {
        const a = stop(leg.from), b = stop(leg.to);
        L.polyline([[a.lat, a.lon], [b.lat, b.lon]], {
          pane: "legs", color: "#5b6b82", weight: 5, dashArray: "2 9", lineCap: "round",
        }).addTo(journeyLayer);
        L.marker([(a.lat + b.lat) / 2, (a.lon + b.lon) / 2], {
          pane: "pins", icon: L.divIcon({ className: "walk-icon", iconSize: [26, 26], html: "🚶" }),
        }).bindTooltip(`Jalan kaki ${leg.meters} m`, { direction: "top" }).addTo(journeyLayer);
        return;
      }
      const p = D.patterns[leg.trip_id];
      const r = route(leg.route_id);
      const coords = sliceShape(p, p.stopDist[leg.from_pos], p.stopDist[leg.to_pos]);
      all.push(...coords);
      L.polyline(coords, { pane: "legs", color: "#ffffff", weight: 11, opacity: 1, lineJoin: "round" }).addTo(journeyLayer);
      L.polyline(coords, { pane: "legs", color: r.color, weight: 7, opacity: 1, lineJoin: "round" }).addTo(journeyLayer);

      for (let i = leg.from_pos; i <= leg.to_pos; i++) {
        const sid = p.stops[i];
        const s = stop(sid);
        const major = i === leg.from_pos || i === leg.to_pos;
        const m = L.circleMarker([s.lat, s.lon], {
          pane: "legStops", radius: major ? 7 : 4.5, color: r.color, weight: major ? 4 : 3,
          fillColor: "#fff", fillOpacity: 1,
        }).addTo(journeyLayer);
        const isEnds = (li === 0 && i === leg.from_pos) || (li === j.legs.length - 1 && i === leg.to_pos);
        m.bindTooltip(esc(s.name), {
          permanent: true, direction: major ? "top" : "right", offset: major ? [0, -8] : [6, 0],
          className: "stop-label " + (major ? "major" + (isEnds ? "" : " mid") : "minor"),
        });
        m.on("click", () => openStationPopup(sid, [s.lat, s.lon]));
      }
    });
    const o = stop(j.legs[0].from);
    const lastRide = [...j.legs].reverse().find((l) => l.type === "ride");
    const dEnd = stop(lastRide.to);
    L.marker([o.lat, o.lon], { pane: "pins", icon: pinIcon("#1351a8", "A") }).addTo(journeyLayer);
    L.marker([dEnd.lat, dEnd.lon], { pane: "pins", icon: pinIcon("#e5484d", "B") }).addTo(journeyLayer);
    journeyBounds = L.latLngBounds(all);
  }

  function fitJourney() {
    if (!journeyBounds) return;
    const wide = window.innerWidth > 820;
    map.fitBounds(journeyBounds, { paddingTopLeft: [30, 70], paddingBottomRight: [wide ? 30 : 30, wide ? 40 : 30] });
  }

  // --------------------------------------------------- popup halte: kedatangan berikutnya
  function openStationPopup(sid, latlng) {
    const station = E.stationOf(D, sid);
    const clock = E.wibNow();
    const rows = new Map();
    for (const [tid, p] of Object.entries(D.patterns)) {
      if (!E.serviceActive(D, p.service_id, clock.weekday)) continue;
      for (let i = 0; i < p.stops.length - 1; i++) {
        if (E.stationOf(D, p.stops[i]) !== station) continue;
        const key = p.route_id + "|" + p.headsign;
        const arr = E.nextArrivals(p, i, clock.sec, 2);
        const cur = rows.get(key) || { rid: p.route_id, hs: p.headsign, times: [] };
        cur.times.push(...arr);
        rows.set(key, cur);
      }
    }
    const netSt = D.networkStations.find((s) => s.id === station);
    const name = (netSt && netSt.name) || stop(sid)?.name || "Halte";
    const routesHere = netSt ? netSt.routes.map(chip).join(" ") : "";
    const list = [...rows.values()]
      .map((r) => ({ ...r, times: [...new Set(r.times.map((t) => Math.round(t / 30) * 30))].sort((a, b) => a - b) }))
      .filter((r) => r.times.length)
      .sort((a, b) => a.times[0] - b.times[0])
      .slice(0, 8)
      .map((r) => `<div class="pop-row">${chip(r.rid)}<span class="hs">${esc(r.hs)}</span>
        <span class="eta">${r.times.slice(0, 2).map((t) => E.fmtWait(t - clock.sec)).join(" · ")}</span></div>`)
      .join("");
    L.popup({ maxWidth: 320 })
      .setLatLng(latlng)
      .setContent(`<div class="pop-title">Halte ${esc(name)}</div>
        <div class="pop-sub">${routesHere || ""}</div>
        ${list || '<div class="pop-row">Pilih rute di panel untuk melihat kedatangan bus di halte ini.</div>'}
        <div class="pop-sub" style="margin:6px 0 0">Estimasi dari jadwal GTFS · ${E.fmtClock(clock.sec)} WIB</div>`)
      .openOn(map);
  }

  // ======================================================================= armada bus
  const busMarkers = new Map();

  function busIcon(b, cls) {
    const r = route(b.routeId);
    return L.divIcon({
      className: "bus-icon", iconSize: [30, 30], iconAnchor: [15, 15],
      html: `<div class="bus ${cls}" style="--c:${r.color};--t:${r.text};--b:${Math.round(b.bearing)}deg">
               <div class="arrow"></div>${r.short}</div>`,
    });
  }

  function onRoute(b, j) {
    for (const leg of j.legs) {
      if (leg.type !== "ride" || !leg.patterns.includes(b.tripId)) continue;
      const pos = legPos(leg, b.tripId);
      if (pos && b.segIndex >= pos.i - 4 && b.segIndex < pos.j) return true;
    }
    return false;
  }

  let lastFleet = [];
  function updateBuses() {
    const clock = E.wibNow();
    const j = D.journeys[state.journey];
    const fleet = E.fleet(D, journeyPatterns(j, state.allBuses), clock)
      .map((b) => Object.assign(b, { onRoute: onRoute(b, j) }))
      .filter((b) => state.allBuses || b.onRoute);

    // kendaraan GPS (opsional, dari liveFeedUrl)
    const rids = new Set(j.legs.filter((l) => l.type === "ride").map((l) => l.route_id));
    for (const v of state.liveVehicles) {
      if (!rids.has(String(v.route_id))) continue;
      fleet.push({
        id: "gps:" + v.id, gps: true, routeId: String(v.route_id), lat: v.lat, lon: v.lon,
        bearing: v.bearing || 0, label: v.id, headsign: v.headsign || "", stopped: false, onRoute: true,
      });
    }
    lastFleet = fleet;

    const seen = new Set();
    for (const b of fleet) {
      seen.add(b.id);
      const cls = [b.stopped ? "stopped" : "", b.onRoute ? "" : "offroute", b.gps ? "gps" : "",
        state.selectedBus === b.id ? "selected" : ""].join(" ");
      let m = busMarkers.get(b.id);
      if (!m) {
        m = L.marker([b.lat, b.lon], { pane: "buses", icon: busIcon(b, cls), keyboard: false });
        m.on("click", (ev) => { L.DomEvent.stopPropagation(ev); selectBus(b.id); });
        m.addTo(map);
        m._cls = cls;
        busMarkers.set(b.id, m);
      } else {
        m.setLatLng([b.lat, b.lon]);
        const el = m.getElement() && m.getElement().firstElementChild;
        if (el) {
          el.style.setProperty("--b", Math.round(b.bearing) + "deg");
          if (m._cls !== cls) { el.className = "bus " + cls; m._cls = cls; }
        }
      }
    }
    for (const [id, m] of busMarkers) {
      if (!seen.has(id)) { map.removeLayer(m); busMarkers.delete(id); }
    }

    const sel = fleet.find((b) => b.id === state.selectedBus);
    if (state.selectedBus && !sel) {
      // bus sudah tiba di terminal / keluar dari filter
      state.selectedBus = null; state.follow = false; $("busCard").classList.add("hidden");
    }
    if (sel && state.follow) map.panTo([sel.lat, sel.lon], { animate: false });
    return { clock, sel };
  }

  function selectBus(id) {
    state.selectedBus = id;
    renderBusCard();
    $("busCard").classList.remove("hidden");
  }

  function renderBusCard() {
    const b = lastFleet.find((x) => x.id === state.selectedBus);
    const card = $("busCard");
    if (!b) { card.classList.add("hidden"); return; }
    const r = route(b.routeId);
    if (b.gps) {
      card.innerHTML = `<div class="bc-head">${chip(b.routeId)}<div class="bc-title">${esc(b.label)}<small>Posisi GPS live</small></div>
        <button class="bc-close" data-act="close">✕</button></div>`;
      return;
    }
    const p = D.patterns[b.tripId];
    const status = b.stopped
      ? `Berhenti di <b>${esc(stop(b.atStop).name)}</b>`
      : `Menuju <b>${esc(stop(b.nextStop).name)}</b>`;
    const remainStops = p.stops.length - 1 - b.segIndex;
    card.style.setProperty("--c", r.color);
    card.innerHTML = `
      <div class="bc-head">${chip(b.routeId)}
        <div class="bc-title">${esc(b.headsign)}<small>${esc(r.long)}</small></div>
        <button class="bc-close" data-act="close" title="Tutup">✕</button>
      </div>
      <div class="tl-note" style="margin-top:8px">${status}${b.stopped ? "" : ` · ${E.fmtWait(b.etaNext)}`}</div>
      <div class="bc-progress"><div style="width:${(b.progress * 100).toFixed(1)}%"></div></div>
      <div class="bc-grid">
        <div><span>Kecepatan est.</span><b>${b.stopped ? "0" : b.speedKmh} km/j</b></div>
        <div><span>Sisa halte</span><b>${remainStops} halte</b></div>
        <div><span>Berangkat terminal</span><b>${E.fmtClock(b.dep)} WIB</b></div>
        <div><span>Tiba di akhir</span><b>${E.fmtClock(b.dep + p.t[p.t.length - 1])} WIB</b></div>
        <div style="grid-column:span 2"><span>Trip GTFS · koordinat</span><b style="font-family:ui-monospace,monospace;font-size:12px">${esc(b.tripId)} · ${b.lat.toFixed(5)}, ${b.lon.toFixed(5)}</b></div>
      </div>
      <div class="bc-actions">
        <button data-act="follow" class="${state.follow ? "on" : ""}">${state.follow ? "● Mengikuti bus" : "Ikuti bus"}</button>
        <button data-act="zoom">Perbesar</button>
      </div>`;
  }

  $("busCard").addEventListener("click", (e) => {
    const act = e.target.closest("button")?.dataset.act;
    if (act === "close") { state.selectedBus = null; state.follow = false; $("busCard").classList.add("hidden"); }
    if (act === "follow") { state.follow = !state.follow; renderBusCard(); }
    if (act === "zoom") {
      const b = lastFleet.find((x) => x.id === state.selectedBus);
      if (b) map.setView([b.lat, b.lon], 17);
    }
  });
  map.on("dragstart", () => {
    if (state.follow) { state.follow = false; renderBusCard(); toast("Mode ikuti bus dimatikan"); }
  });

  // ======================================================================= panel
  function renderJourneyList(clock) {
    $("journeyList").innerHTML = D.journeys.map((j, idx) => {
      const plan = E.planJourney(D, j, clock);
      const chips = j.legs.map((l) => (l.type === "walk"
        ? `<span class="chip chip-walk">🚶 ${l.meters} m</span>` : chip(l.route_id))).join('<span class="chev">›</span>');
      const transfers = j.legs.filter((l) => l.type === "ride").length - 1;
      let meta;
      if (plan.ok) {
        const first = plan.steps.find((s) => s.type === "ride");
        const wait = first.board - clock.sec;
        meta = `<span>${wait < 45 ? '<span class="depart-now">Bus tiba sekarang</span>' : `Bus pertama <b>${E.fmtWait(wait)}</b>`}</span>
                <span>Tiba <b>${E.fmtClock(plan.end)}</b> · Rp${D.fare.toLocaleString("id-ID")}</span>`;
      } else {
        meta = `<span style="color:var(--red)">Di luar jam operasional</span><span>${transfers}x transit</span>`;
      }
      return `<button class="jcard ${idx === state.journey ? "active" : ""}" data-idx="${idx}">
        <div class="jcard-top">
          <div><div class="jcard-dest">${esc(j.dest)}</div><div class="jcard-area">${esc(j.title)} · Kec. ${esc(j.area)}</div></div>
          <div class="jcard-dur">${plan.ok ? Math.round(plan.duration / 60) : "–"}<small> mnt</small></div>
        </div>
        <div class="chips">${chips}</div>
        <div class="jcard-meta">${meta}</div>
      </button>`;
    }).join("");
  }

  $("journeyList").addEventListener("click", (e) => {
    const btn = e.target.closest(".jcard");
    if (!btn) return;
    selectJourney(Number(btn.dataset.idx));
  });

  function busesBetween(leg, step, fleet) {
    // bus pada leg ini yang sedang berada di antara halte-halte leg (untuk daftar halte)
    const res = {};
    for (const b of fleet) {
      if (b.gps || !leg.patterns.includes(b.tripId)) continue;
      const pos = legPos(leg, b.tripId);
      if (!pos) continue;
      const rel = b.segIndex - pos.i; // index halte relatif terhadap halte naik
      if (rel < 0 || rel > pos.j - pos.i) continue;
      const k = b.stopped ? rel : rel + 1;
      (res[k] = res[k] || []).push(b);
    }
    return res;
  }

  function renderDetail(clock) {
    const j = D.journeys[state.journey];
    const plan = E.planJourney(D, j, clock);
    const el = $("detail");
    if (!plan.ok) {
      el.innerHTML = `<div class="detail-title">${esc(j.dest)}</div>
        <div class="warn" style="margin-top:8px">Belum ada layanan untuk rute ini pada ${E.fmtClock(clock.sec)} WIB
        (di luar jam operasional GTFS). Silakan cek kembali saat layanan beroperasi.</div>`;
      return;
    }
    const transfers = plan.steps.filter((s) => s.type === "ride").length - 1;
    const walkM = plan.steps.filter((s) => s.type === "walk").reduce((a, s) => a + s.meters, 0);
    let html = `
      <div class="detail-head">
        <div><div class="detail-title">Rasuna Said → ${esc(j.dest)}</div>
        <div class="detail-sub">${esc(j.title)} · tarif terintegrasi selama tidak tap-out</div></div>
      </div>
      <div class="summary-grid">
        <div><b>${Math.round(plan.duration / 60)}</b><span>menit</span></div>
        <div><b>${E.fmtClock(plan.end)}</b><span>tiba</span></div>
        <div><b>${transfers}x</b><span>transit</span></div>
        <div><b>Rp${(D.fare / 1000).toFixed(1).replace(".", ",")}rb</b><span>${walkM ? walkM + " m jalan" : "tarif"}</span></div>
      </div>
      <div class="tl">`;

    const rideLegs = j.legs;
    plan.steps.forEach((s, si) => {
      const leg = rideLegs[si];
      if (s.type === "walk") {
        html += `<div class="tl-item walk">
          <div class="tl-time"></div><div class="tl-rail"></div>
          <div class="tl-body"><div class="tl-note">🚶 Jalan kaki <b>${s.meters} m</b> (±${Math.round((s.end - s.start) / 60)} mnt)
          ke Halte <b>${esc(stop(s.to).name)}</b> — keluar &amp; tap-in ulang masih dalam batas waktu integrasi tarif.</div></div>
        </div>`;
        return;
      }
      const r = route(s.routeId);
      const p = D.patterns[s.tripId];
      const groups = busesBetween(leg, s, lastFleet);
      const nb = s.upcoming
        .filter((u, i, arr) => i === 0 || u.at - arr[i - 1].at > 30)
        .slice(0, 4)
        .map((u) => {
          const w = u.at - clock.sec;
          return `<span class="nb ${w < 180 ? "soon" : ""}">${E.fmtWait(w)}</span>`;
        }).join("");
      const open = !!state.expanded[si];
      let mini = "";
      if (open) {
        mini = '<ul class="mini-stops">';
        for (let i = s.fromPos + 1; i < s.toPos; i++) {
          const sid = p.stops[i];
          const busesHere = groups[i - s.fromPos] || [];
          mini += `<li data-stop="${sid}"><span class="tl-node small" style="--rail:${r.color};margin:0"></span>
            ${esc(stop(sid).name)}${busesHere.length ? `<span class="bus-pill" style="background:${r.color}">🚌 ${busesHere.length}</span>` : ""}</li>`;
        }
        mini += "</ul>";
      }
      const boardBuses = (groups[0] || []).length;
      html += `
        <div class="tl-item ${si === 0 ? "first" : ""}" style="--rail:${r.color}">
          <div class="tl-time">${E.fmtClock(s.board)}</div>
          <div class="tl-rail"><span class="tl-node"></span></div>
          <div class="tl-body">
            <div class="tl-stop" data-stop="${s.from}">${esc(stop(s.from).name)}</div>
            <div class="tl-note">${si === 0 ? "Tap-in di halte" : "Transit"}${boardBuses ? ` · ${boardBuses} bus sedang di halte` : ""}</div>
            <div class="ride-box">
              <div class="ride-head">${chip(s.routeId)} <span>Arah ${esc(s.headsign)}</span></div>
              <div class="next-buses">${nb}</div>
              <div class="tl-note">Tunggu ±${Math.max(0, Math.round(s.wait / 60))} mnt · naik ${Math.round((s.end - s.board) / 60)} mnt · ${s.stopsCount} halte</div>
              ${s.stopsCount > 1 ? `<button class="stops-toggle" data-toggle="${si}">${open ? "Sembunyikan" : "Lihat"} ${s.stopsCount - 1} halte yang dilewati ${open ? "▴" : "▾"}</button>` : ""}
              ${mini}
            </div>
          </div>
        </div>
        <div class="tl-item ${si === plan.steps.length - 1 ? "last" : ""}" style="--rail:${r.color}">
          <div class="tl-time">${E.fmtClock(s.end)}</div>
          <div class="tl-rail"><span class="tl-node"></span></div>
          <div class="tl-body">
            <div class="tl-stop" data-stop="${s.to}">${esc(stop(s.to).name)}</div>
            <div class="tl-note">${si === plan.steps.length - 1 ? "🏁 Tiba di tujuan · tap-out" : "Turun di sini"}</div>
          </div>
        </div>`;
    });
    html += "</div>";
    el.innerHTML = html;
  }

  $("detail").addEventListener("click", (e) => {
    const t = e.target.closest("[data-toggle]");
    if (t) {
      const k = t.dataset.toggle;
      state.expanded[k] = !state.expanded[k];
      renderDetail(E.wibNow());
      return;
    }
    const s = e.target.closest("[data-stop]");
    if (s) {
      const st = stop(s.dataset.stop);
      map.setView([st.lat, st.lon], 16);
      openStationPopup(s.dataset.stop, [st.lat, st.lon]);
      if (window.innerWidth <= 820) $("panel").classList.remove("expanded");
    }
  });

  function selectJourney(idx) {
    state.journey = idx;
    state.expanded = {};
    state.selectedBus = null;
    state.follow = false;
    $("busCard").classList.add("hidden");
    for (const m of busMarkers.values()) map.removeLayer(m);
    busMarkers.clear();
    drawJourney();
    fitJourney();
    tick(true);
  }

  // ======================================================================= toolbar
  $("btnFit").addEventListener("click", fitJourney);
  $("btnLocate").addEventListener("click", () => {
    const s = stop(D.journeys[state.journey].legs[0].from);
    map.setView([s.lat, s.lon], 17);
    openStationPopup(D.journeys[state.journey].legs[0].from, [s.lat, s.lon]);
  });
  $("chkAllBuses").addEventListener("change", (e) => { state.allBuses = e.target.checked; tick(true); });
  $("sheetHandle").addEventListener("click", () => $("panel").classList.toggle("expanded"));

  let toastTimer;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), 2200);
  }

  // ======================================================================= live feed opsional
  async function pollLive() {
    if (!CFG.liveFeedUrl) return;
    try {
      const res = await fetch(CFG.liveFeedUrl, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const json = await res.json();
      state.liveVehicles = Array.isArray(json.vehicles) ? json.vehicles : [];
      $("modeBadge").className = "badge badge-live";
      $("modeBadge").innerHTML = `<i></i>GPS live · ${state.liveVehicles.length} unit`;
    } catch (err) {
      state.liveVehicles = [];
      $("modeBadge").className = "badge badge-sched";
      $("modeBadge").innerHTML = "<i></i>Feed GPS gagal · pakai jadwal GTFS";
    }
  }
  if (CFG.liveFeedUrl) {
    pollLive();
    setInterval(pollLive, CFG.liveFeedIntervalMs || 10000);
  }

  // ======================================================================= loop
  function tick(forcePanel) {
    const { clock } = updateBuses();
    const sec = Math.floor(clock.sec);
    if (forcePanel || sec !== state.lastPanelSec) {
      state.lastPanelSec = sec;
      $("clock").textContent = E.fmtClock(clock.sec, true);
      $("dayBadge").textContent = `${DAYS[clock.weekday]} · ${lastFleet.length} bus di layar`;
      if (state.selectedBus) renderBusCard();
      // panel cukup diperbarui tiap 5 detik (atau saat dipaksa)
      if (forcePanel || sec % 5 === 0) {
        renderJourneyList(clock);
        renderDetail(clock);
      }
    }
  }

  let lastFrame = 0;
  function frame(ts) {
    if (ts - lastFrame > 120) { // ~8 fps: halus & hemat baterai
      lastFrame = ts;
      tick(false);
    }
    requestAnimationFrame(frame);
  }

  $("feedDate").textContent = D.feedDate;
  drawJourney();
  fitJourney();
  tick(true);
  requestAnimationFrame(frame);
})();
