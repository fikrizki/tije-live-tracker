"""
Membuat bundel HTML mandiri untuk panel preview Antigravity (tije_live_tracker.html)
yang memuat seluruh dataset GTFS resmi Transjakarta (58 koridor BRT, 200 halte BRT,
29 pola trip, frequencies.txt, stop_times.txt, shapes.txt) dan TijeEngine yang sama persis
dengan aplikasi web di tije-live-tracker/web/index.html.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_JS = (ROOT / "web" / "data.js").read_text(encoding="utf-8")
ENGINE_JS = (ROOT / "web" / "engine.js").read_text(encoding="utf-8")
ARTIFACT = Path("/Users/fikrizki/.gemini/antigravity/brain/c2c5cee9-ae90-4ea7-b588-c66f4f8e4091/tije_live_tracker.html")

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TIJE Live — Rasuna Said ➜ Jakarta Barat (GTFS Resmi Transjakarta)</title>
  <script src="https://www.gstatic.com/antigravity/web/dev/tailwindcss.min.js"></script>
  <style>
    canvas { touch-action: none; }
    .custom-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
    .custom-scroll::-webkit-scrollbar-thumb { background: rgba(148, 163, 184, 0.45); border-radius: 9999px; }
  </style>
</head>
<body class="bg-[var(--background)] text-[var(--foreground)] antialiased p-3 md:p-4">
  <div class="max-w-7xl mx-auto space-y-3.5">

    <!-- Top Header -->
    <div class="bg-[#1351a8] text-white rounded-xl p-4 shadow flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-white text-[#1351a8] font-black text-base flex items-center justify-center shrink-0">
          TJ
        </div>
        <div>
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-extrabold text-base">TIJE Live</span>
            <span class="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-400/20 text-emerald-200 border border-emerald-300/30">
              ● GTFS Resmi Transjakarta (58 Koridor • 200 Halte BRT)
            </span>
          </div>
          <p class="text-xs text-blue-100 mt-0.5">
            Dari <strong>Halte Rasuna Said</strong> ➜ <strong>Jakarta Barat (4 Tujuan)</strong> • Untuk peta ubin jalan OpenStreetMap penuh, buka <code class="px-1.5 py-0.5 rounded bg-blue-900/60">http://127.0.0.1:8787/</code> di browser
          </p>
        </div>
      </div>

      <div class="flex items-center gap-3 self-end lg:self-center">
        <div class="text-right">
          <div id="clockDisplay" class="font-mono font-extrabold text-lg leading-tight">--:--:--</div>
          <div id="dayBadge" class="text-xs text-blue-200">WIB</div>
        </div>
      </div>
    </div>

    <!-- 4 Journey Cards -->
    <div id="journeyCards" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5"></div>

    <!-- Main Layout: Map (8 cols) + Detail Timeline (4 cols) -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-4">

      <!-- Left 8 Cols: High-Detail GTFS Shape Map -->
      <div class="lg:col-span-8 space-y-3">
        <div class="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden shadow-sm">
          <div class="px-3.5 py-2.5 border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold text-[var(--foreground)]">Peta Geometri GTFS Resmi (shapes.txt &amp; stops.txt)</span>
              <span id="busCountPill" class="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-500/15 text-blue-500">0 bus</span>
            </div>
            <div class="flex flex-wrap items-center gap-1.5 text-xs">
              <button id="btnZoomIn" class="px-2.5 py-1 rounded border border-[var(--border)] bg-[var(--background)] font-bold">+</button>
              <button id="btnZoomOut" class="px-2.5 py-1 rounded border border-[var(--border)] bg-[var(--background)] font-bold">−</button>
              <button id="btnFitRoute" class="px-2.5 py-1 rounded border border-[var(--border)] bg-[var(--background)] font-semibold">⤢ Rute</button>
              <button id="btnRasuna" class="px-2.5 py-1 rounded border border-[var(--border)] bg-[var(--background)] font-semibold">◎ Rasuna Said</button>
              <label class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-[var(--border)] bg-[var(--background)] cursor-pointer">
                <input type="checkbox" id="chkAllBuses" class="accent-blue-600" /> Semua bus
              </label>
              <label class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-[var(--border)] bg-[var(--background)] cursor-pointer">
                <input type="checkbox" id="chkNetwork" checked class="accent-blue-600" /> Jaringan BRT
              </label>
            </div>
          </div>

          <div class="relative w-full h-[500px] bg-[#eef2f6] select-none overflow-hidden">
            <canvas id="gtfsCanvas" class="w-full h-full cursor-grab active:cursor-grabbing"></canvas>

            <!-- Selected Bus / Stop Floating Card -->
            <div id="floatingCard" class="hidden absolute right-3 bottom-3 w-80 bg-white text-slate-900 border border-slate-200 rounded-xl p-3.5 shadow-xl"></div>
          </div>
        </div>
      </div>

      <!-- Right 4 Cols: Timeline & Stop Inspector -->
      <div class="lg:col-span-4 space-y-3">
        <div id="detailPanel" class="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 shadow-sm max-h-[555px] overflow-y-auto custom-scroll"></div>
      </div>

    </div>
  </div>

  <script>
__DATA_JS__
  </script>
  <script>
__ENGINE_JS__
  </script>
  <script>
  (function () {
    const D = window.TIJE_DATA;
    const E = window.TijeEngine;
    const $ = (id) => document.getElementById(id);
    const DAYS = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];

    const state = {
      journey: 0,
      allBuses: false,
      showNetwork: true,
      selectedBus: null,
      follow: false,
      expanded: {},
      centerLat: -6.195,
      centerLon: 106.79,
      zoom: 13.1,
      dragging: false,
      dragDist: 0,
      lx: 0,
      ly: 0,
    };

    const route = (rid) => D.routes[rid] || { short: rid, color: "#1351a8", text: "#fff" };
    const stop = (sid) => D.stops[sid];
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const chip = (rid) => {
      const r = route(rid);
      return `<span class="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-xs font-extrabold" style="background:${r.color};color:${r.text}">${r.short}</span>`;
    };

    const legPosCache = new Map();
    function legPos(leg, tid) {
      const k = leg.from + ">" + leg.to + "|" + tid;
      if (!legPosCache.has(k)) legPosCache.set(k, E.legPositions(D, D.patterns[tid], leg.from, leg.to));
      return legPosCache.get(k);
    }

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

    function fitJourneyBounds() {
      const j = D.journeys[state.journey];
      let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
      j.legs.forEach((leg) => {
        if (leg.type !== "ride") return;
        const p = D.patterns[leg.trip_id];
        const pts = sliceShape(p, p.stopDist[leg.from_pos], p.stopDist[leg.to_pos]);
        pts.forEach(([la, lo]) => {
          if (la < minLat) minLat = la;
          if (la > maxLat) maxLat = la;
          if (lo < minLon) minLon = lo;
          if (lo > maxLon) maxLon = lo;
        });
      });
      state.centerLat = (minLat + maxLat) / 2;
      state.centerLon = (minLon + maxLon) / 2;
      const span = Math.max(maxLat - minLat, (maxLon - minLon) * 0.75);
      state.zoom = Math.min(14.5, Math.max(12.2, Math.log2(180 / Math.max(0.01, span)) - 0.15));
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
    function computeFleet(clock) {
      const j = D.journeys[state.journey];
      const patIds = [
        ...new Set(j.legs.filter((l) => l.type === "ride").flatMap((l) => (state.allBuses ? l.patterns : [l.trip_id]))),
      ];
      lastFleet = E.fleet(D, patIds, clock)
        .map((b) => Object.assign(b, { onRoute: onRoute(b, j) }))
        .filter((b) => state.allBuses || b.onRoute);

      const sel = lastFleet.find((b) => b.id === state.selectedBus);
      if (sel && state.follow) {
        state.centerLat = sel.lat;
        state.centerLon = sel.lon;
      }
    }

    // Canvas Projection
    const canvas = $("gtfsCanvas");
    const ctx = canvas.getContext("2d");
    let hitBuses = [];
    let hitStops = [];

    function project(lat, lon, W, H) {
      const scale = Math.pow(2, state.zoom) * 1.45;
      return {
        x: W / 2 + (lon - state.centerLon) * scale,
        y: H / 2 - (lat - state.centerLat) * scale * 1.01,
      };
    }

    function drawMap() {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.floor(rect.width * dpr) || canvas.height !== Math.floor(rect.height * dpr)) {
        canvas.width = Math.floor(rect.width * dpr);
        canvas.height = Math.floor(rect.height * dpr);
      }
      ctx.save();
      ctx.scale(dpr, dpr);
      const W = rect.width, H = rect.height;

      // Light cartographic background matching TIJE map
      ctx.fillStyle = "#f1f5f9";
      ctx.fillRect(0, 0, W, H);

      // Subtle coordinate grid
      ctx.strokeStyle = "rgba(148, 163, 184, 0.22)";
      ctx.lineWidth = 1;
      for (let lon = 106.68; lon <= 106.88; lon += 0.02) {
        const p = project(-6.19, lon, W, H);
        ctx.beginPath(); ctx.moveTo(p.x, 0); ctx.lineTo(p.x, H); ctx.stroke();
      }
      for (let lat = -6.27; lat <= -6.12; lat += 0.02) {
        const p = project(lat, 106.79, W, H);
        ctx.beginPath(); ctx.moveTo(0, p.y); ctx.lineTo(W, p.y); ctx.stroke();
      }

      // 1. Background 58 BRT Corridors (shapes.txt)
      if (state.showNetwork) {
        D.network.forEach((n) => {
          ctx.strokeStyle = route(n.route_id).color;
          ctx.globalAlpha = 0.25;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          n.coords.forEach(([la, lo], i) => {
            const p = project(la, lo, W, H);
            if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
          });
          ctx.stroke();
        });
        ctx.globalAlpha = 1;

        D.networkStations.forEach((s) => {
          const p = project(s.lat, s.lon, W, H);
          if (p.x < -10 || p.x > W + 10 || p.y < -10 || p.y > H + 10) return;
          ctx.fillStyle = "#ffffff";
          ctx.strokeStyle = "#64748b";
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          if (state.zoom >= 14.8) {
            ctx.fillStyle = "#334155";
            ctx.font = "600 12px sans-serif";
            ctx.fillText(s.name, p.x + 6, p.y + 4);
          }
        });
      }

      // 2. Selected Journey Exact Road Polylines (shapes.txt)
      hitStops = [];
      const j = D.journeys[state.journey];
      j.legs.forEach((leg, li) => {
        if (leg.type === "walk") {
          const a = stop(leg.from), b = stop(leg.to);
          const pa = project(a.lat, a.lon, W, H), pb = project(b.lat, b.lon, W, H);
          ctx.strokeStyle = "#475569";
          ctx.lineWidth = 4;
          ctx.setLineDash([4, 6]);
          ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
          ctx.setLineDash([]);
          return;
        }
        const p = D.patterns[leg.trip_id];
        const r = route(leg.route_id);
        const coords = sliceShape(p, p.stopDist[leg.from_pos], p.stopDist[leg.to_pos]);

        // White casing
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 10;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        coords.forEach(([la, lo], i) => {
          const pt = project(la, lo, W, H);
          if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();

        // Corridor color
        ctx.strokeStyle = r.color;
        ctx.lineWidth = 6.5;
        ctx.beginPath();
        coords.forEach(([la, lo], i) => {
          const pt = project(la, lo, W, H);
          if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();

        // Stops along the leg
        for (let i = leg.from_pos; i <= leg.to_pos; i++) {
          const sid = p.stops[i];
          const st = stop(sid);
          const pt = project(st.lat, st.lon, W, H);
          const major = i === leg.from_pos || i === leg.to_pos;
          ctx.fillStyle = "#ffffff";
          ctx.strokeStyle = r.color;
          ctx.lineWidth = major ? 3.5 : 2.5;
          ctx.beginPath(); ctx.arc(pt.x, pt.y, major ? 6.5 : 4.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          hitStops.push({ id: sid, x: pt.x, y: pt.y, r: 9 });

          if (major || state.zoom >= 13.7) {
            ctx.font = major ? "bold 12px sans-serif" : "600 12px sans-serif";
            const tw = ctx.measureText(st.name).width;
            ctx.fillStyle = "rgba(255,255,255,0.92)";
            ctx.fillRect(pt.x + 8, pt.y - 9, tw + 8, 18);
            ctx.fillStyle = "#0f172a";
            ctx.fillText(st.name, pt.x + 12, pt.y + 4);
          }
        }
      });

      // 3. Live Buses along GTFS shapes
      hitBuses = [];
      lastFleet.forEach((b) => {
        const pt = project(b.lat, b.lon, W, H);
        const r = route(b.routeId);
        const isSel = b.id === state.selectedBus;

        if (isSel) {
          ctx.fillStyle = "rgba(19, 81, 168, 0.25)";
          ctx.beginPath(); ctx.arc(pt.x, pt.y, 20, 0, Math.PI * 2); ctx.fill();
        }

        // Heading pointer triangle
        const rad = ((b.bearing - 90) * Math.PI) / 180;
        ctx.fillStyle = r.color;
        ctx.beginPath();
        ctx.moveTo(pt.x + Math.cos(rad) * 19, pt.y + Math.sin(rad) * 19);
        ctx.lineTo(pt.x + Math.cos(rad + 0.5) * 12, pt.y + Math.sin(rad + 0.5) * 12);
        ctx.lineTo(pt.x + Math.cos(rad - 0.5) * 12, pt.y + Math.sin(rad - 0.5) * 12);
        ctx.closePath();
        ctx.fill();

        // Circular bus badge
        ctx.fillStyle = r.color;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

        ctx.fillStyle = r.text;
        ctx.font = "bold 12px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(r.short, pt.x, pt.y + 4);
        ctx.textAlign = "left";

        hitBuses.push({ id: b.id, x: pt.x, y: pt.y, r: 15 });
      });

      ctx.restore();
    }

    function renderFloatingCard() {
      const card = $("floatingCard");
      const b = lastFleet.find((x) => x.id === state.selectedBus);
      if (!b) {
        card.classList.add("hidden");
        return;
      }
      card.classList.remove("hidden");
      const r = route(b.routeId);
      const p = D.patterns[b.tripId];
      const status = b.stopped
        ? `Berhenti di <b>${esc(stop(b.atStop).name)}</b>`
        : `Menuju <b>${esc(stop(b.nextStop).name)}</b> · ${E.fmtWait(b.etaNext)}`;

      card.innerHTML = `
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            ${chip(b.routeId)}
            <div>
              <div class="text-xs font-extrabold">${esc(b.headsign)}</div>
              <div class="text-xs text-slate-500">${esc(r.long)}</div>
            </div>
          </div>
          <button id="btnCloseFloat" class="w-6 h-6 rounded-full bg-slate-100 text-xs font-bold">✕</button>
        </div>
        <div class="text-xs text-slate-600 mt-2">${status}</div>
        <div class="grid grid-cols-2 gap-1.5 mt-2 text-xs">
          <div class="bg-slate-100 rounded-lg p-1.5"><span class="text-slate-500 block">Kecepatan</span><b>${b.stopped ? 0 : b.speedKmh} km/j</b></div>
          <div class="bg-slate-100 rounded-lg p-1.5"><span class="text-slate-500 block">Berangkat Awal</span><b>${E.fmtClock(b.dep)} WIB</b></div>
          <div class="col-span-2 bg-slate-100 rounded-lg p-1.5 font-mono text-xs">${esc(b.tripId)} · ${b.lat.toFixed(5)}, ${b.lon.toFixed(5)}</div>
        </div>
      `;
      $("btnCloseFloat").onclick = () => { state.selectedBus = null; card.classList.add("hidden"); };
    }

    function renderPanels(clock) {
      $("journeyCards").innerHTML = D.journeys.map((j, idx) => {
        const plan = E.planJourney(D, j, clock);
        const chips = j.legs.map((l) => (l.type === "walk"
          ? `<span class="px-1.5 py-0.5 rounded text-xs font-bold bg-slate-200 text-slate-700">🚶 ${l.meters} m</span>`
          : chip(l.route_id))).join(' <span class="text-xs text-slate-400">›</span> ');
        const firstRide = plan.ok ? plan.steps.find((s) => s.type === "ride") : null;
        const wait = firstRide ? firstRide.board - clock.sec : 0;

        return `
          <button data-j="${idx}" class="text-left rounded-xl p-3 border transition ${
            idx === state.journey
              ? "bg-[var(--card)] border-blue-600 ring-2 ring-blue-500/25 shadow-sm"
              : "bg-[var(--card)] border-[var(--border)] opacity-80 hover:opacity-100"
          }">
            <div class="flex items-baseline justify-between gap-2">
              <div class="font-extrabold text-sm text-[var(--foreground)]">${esc(j.dest)}</div>
              <div class="font-black text-base text-[var(--foreground)]">${plan.ok ? Math.round(plan.duration / 60) : "–"} <span class="text-xs font-normal text-[var(--muted-foreground)]">mnt</span></div>
            </div>
            <div class="text-xs text-[var(--muted-foreground)]">${esc(j.title)}</div>
            <div class="flex flex-wrap items-center gap-1 my-2">${chips}</div>
            <div class="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
              <span>${plan.ok ? (wait < 45 ? '<b class="text-emerald-500">Bus tiba sekarang</b>' : `Bus pertama <b>${E.fmtWait(wait)}</b>`) : "Di luar jam"}</span>
              <span>${plan.ok ? `Tiba <b>${E.fmtClock(plan.end)}</b>` : ""} · Rp3.500</span>
            </div>
          </button>
        `;
      }).join("");

      const j = D.journeys[state.journey];
      const plan = E.planJourney(D, j, clock);
      if (!plan.ok) {
        $("detailPanel").innerHTML = `<div class="text-xs text-amber-500">Di luar jam operasional untuk rute ini.</div>`;
        return;
      }

      $("detailPanel").innerHTML = `
        <div class="font-extrabold text-sm text-[var(--foreground)]">Rasuna Said ➜ ${esc(j.dest)}</div>
        <div class="text-xs text-[var(--muted-foreground)] mb-3">${esc(j.title)} • Tarif Flat Rp3.500</div>
        <div class="space-y-3">
          ${plan.steps.map((s) => {
            if (s.type === "walk") {
              return `<div class="p-2.5 rounded-lg border border-dashed border-[var(--border)] text-xs text-[var(--muted-foreground)]">
                🚶 Jalan kaki <b>${s.meters} m</b> (±${Math.round((s.end - s.start) / 60)} mnt) ke Halte <b>${esc(stop(s.to).name)}</b>
              </div>`;
            }
            const r = route(s.routeId);
            const nextPills = s.upcoming.slice(0, 4).map((u) => {
              const w = u.at - clock.sec;
              return `<span class="px-2 py-0.5 rounded-full text-xs font-bold ${w < 180 ? "bg-emerald-500/15 text-emerald-500" : "bg-[var(--background)] text-[var(--foreground)]"} border border-[var(--border)]">${E.fmtWait(w)}</span>`;
            }).join(" ");
            return `
              <div class="p-3 rounded-xl border border-[var(--border)] bg-[var(--background)] space-y-1.5">
                <div class="flex items-center justify-between text-xs">
                  <div class="flex items-center gap-1.5">${chip(s.routeId)} <b class="text-[var(--foreground)]">Arah ${esc(s.headsign)}</b></div>
                  <span class="font-mono font-bold text-[var(--foreground)]">${E.fmtClock(s.board)} – ${E.fmtClock(s.end)}</span>
                </div>
                <div class="text-xs text-[var(--foreground)]">
                  Naik: <b>${esc(stop(s.from).name)}</b> ➜ Turun: <b>${esc(stop(s.to).name)}</b> (${s.stopsCount} halte)
                </div>
                <div class="flex flex-wrap items-center gap-1 pt-1">${nextPills}</div>
              </div>
            `;
          }).join("")}
        </div>
      `;
    }

    $("journeyCards").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-j]");
      if (!btn) return;
      state.journey = Number(btn.dataset.j);
      state.selectedBus = null;
      fitJourneyBounds();
      tick(true);
    });

    canvas.addEventListener("mousedown", (e) => {
      state.dragging = true; state.dragDist = 0; state.lx = e.clientX; state.ly = e.clientY;
    });
    window.addEventListener("mousemove", (e) => {
      if (!state.dragging) return;
      const dx = e.clientX - state.lx, dy = e.clientY - state.ly;
      state.dragDist += Math.hypot(dx, dy);
      state.lx = e.clientX; state.ly = e.clientY;
      const scale = Math.pow(2, state.zoom) * 1.45;
      state.centerLon -= dx / scale;
      state.centerLat += dy / (scale * 1.01);
      drawMap();
    });
    window.addEventListener("mouseup", (e) => {
      if (!state.dragging) return;
      state.dragging = false;
      if (state.dragDist < 6) {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        for (const b of hitBuses) {
          if (Math.hypot(mx - b.x, my - b.y) <= b.r) {
            state.selectedBus = b.id;
            renderFloatingCard();
            drawMap();
            return;
          }
        }
      }
    });
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      state.zoom = Math.min(16.5, Math.max(11.5, state.zoom + (e.deltaY < 0 ? 0.3 : -0.3)));
      drawMap();
    }, { passive: false });

    $("btnZoomIn").onclick = () => { state.zoom = Math.min(16.5, state.zoom + 0.4); drawMap(); };
    $("btnZoomOut").onclick = () => { state.zoom = Math.max(11.5, state.zoom - 0.4); drawMap(); };
    $("btnFitRoute").onclick = () => { fitJourneyBounds(); drawMap(); };
    $("btnRasuna").onclick = () => {
      const s = stop(D.journeys[state.journey].legs[0].from);
      state.centerLat = s.lat; state.centerLon = s.lon; state.zoom = 15.2; drawMap();
    };
    $("chkAllBuses").onchange = (e) => { state.allBuses = e.target.checked; tick(true); };
    $("chkNetwork").onchange = (e) => { state.showNetwork = e.target.checked; drawMap(); };

    let lastSec = -1;
    function tick(force) {
      const clock = E.wibNow();
      computeFleet(clock);
      drawMap();
      const sec = Math.floor(clock.sec);
      if (force || sec !== lastSec) {
        lastSec = sec;
        $("clockDisplay").textContent = E.fmtClock(clock.sec, true);
        $("dayBadge").textContent = `${DAYS[clock.weekday]} · WIB`;
        $("busCountPill").textContent = `${lastFleet.length} bus di jalur`;
        renderFloatingCard();
        if (force || sec % 5 === 0) renderPanels(clock);
      }
    }

    fitJourneyBounds();
    tick(true);
    setInterval(() => tick(false), 250);
    window.addEventListener("resize", drawMap);
  })();
  </script>
</body>
</html>
"""

html_out = HTML_TEMPLATE.replace("__DATA_JS__", DATA_JS).replace("__ENGINE_JS__", ENGINE_JS)
ARTIFACT.write_text(html_out, encoding="utf-8")
print(f"Bundled artifact -> {ARTIFACT} ({ARTIFACT.stat().st_size / 1024:.0f} KB)")
