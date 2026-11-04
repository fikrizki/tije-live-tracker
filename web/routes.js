/*
 * TIJE Live · mode "Semua Rute": katalog 241 rute GTFS resmi Transjakarta.
 * Bergantung pada: Leaflet, TIJE_INDEX (routes-index.js), TijeEngine.
 * Detail tiap rute (routes/<id>.js) dimuat saat rute dibuka, lewat tag <script>
 * sehingga tetap jalan saat dibuka dari file:// maupun GitHub Pages.
 */
(function () {
  "use strict";

  window.TijeRoutes = function (ctx) {
    const { map, E, toast } = ctx;
    const X = window.TIJE_INDEX;
    const $ = (id) => document.getElementById(id);
    const DAY_NAMES = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];
    const VARIANTS_COLLAPSED = 5;
    const TRANSFER_CHIPS = 6;

    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
    const byId = new Map(X.routes.map((r) => [r.id, r]));

    // Dataset runtime untuk TijeEngine (bentuk sama dengan TIJE_DATA), diisi saat rute dimuat
    const RD = { patterns: {}, stops: {}, routes: {}, calendar: X.calendar };
    for (const r of X.routes) RD.routes[r.id] = { short: r.short, long: r.long, color: r.color, text: r.text };

    const st = {
      active: false,
      cats: new Set(),
      query: "",
      runOnly: false,
      near: null,            // { lat, lon } dari geolokasi
      routeId: null,
      tid: null,
      allVariants: false,
      schedOpen: false,
      selectedBus: null,
      follow: false,
      netOn: true,
      listSig: "",
      live: new Map(),       // rid -> hasil E.routeLive
      fleet: [],
    };

    // ===================================================================== helpers tampilan
    function chip(rid, asButton) {
      const r = byId.get(rid);
      if (!r) return "";
      const style = `background:${r.color};color:${r.text}`;
      return asButton
        ? `<button type="button" class="chip chip-btn" data-open="${esc(rid)}" style="${style}" title="${esc(r.short)} · ${esc(r.long)}">${esc(r.short)}</button>`
        : `<span class="chip" style="${style}">${esc(r.short)}</span>`;
    }
    function fareLabel(f) {
      if (f === 0) return "Gratis";
      if (f == null) return "Tarif tidak tercantum di GTFS";
      return "Rp" + f.toLocaleString("id-ID");
    }
    function daysLabel(arr) {
      if (!arr) return "Setiap hari";
      const on = arr.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
      if (on.length === 7) return "Setiap hari";
      if (on.length > 1 && on[on.length - 1] - on[0] === on.length - 1) return `${DAY_NAMES[on[0]]} s.d. ${DAY_NAMES[on[on.length - 1]]}`;
      return on.map((i) => DAY_NAMES[i]).join(", ");
    }
    function hoursLabel(live) {
      if (live.allDay) return "24 jam";
      if (live.first == null) return "";
      return `${E.fmtClock(live.first)} - ${E.fmtClock(live.last)}`;
    }
    function liveLabel(live) {
      switch (live.state) {
        case "run": return { cls: "run", text: `${live.buses} bus jalan` };
        case "before": return { cls: "idle", text: `Mulai ${E.fmtClock(live.first)}` };
        case "wait": return { cls: "idle", text: `Berangkat ${E.fmtClock(live.next)}` };
        case "after": return { cls: "idle", text: "Selesai hari ini" };
        default: return { cls: "off", text: "Tidak ada layanan hari ini" };
      }
    }
    function mergeWindows(freq) {
      const out = [];
      for (const [s, e, h] of freq) {
        const last = out[out.length - 1];
        if (last && last[2] === h && last[1] === s) last[1] = e;
        else out.push([s, e, h]);
      }
      return out;
    }
    const mins = (sec) => Math.max(1, Math.round(sec / 60));

    // ===================================================================== pemuat data rute
    const loaded = new Map();
    const pending = new Map();
    window.TIJE_ROUTE_LOADED = (rid, payload) => {
      for (const [tid, p] of Object.entries(payload.patterns)) RD.patterns[tid] = p;
      Object.assign(RD.stops, payload.stops);
      loaded.set(rid, payload);
      const pd = pending.get(rid);
      if (pd) { pending.delete(rid); clearTimeout(pd.timer); pd.el.remove(); pd.resolve(payload); }
    };
    function loadRoute(rid) {
      if (loaded.has(rid)) return Promise.resolve(loaded.get(rid));
      if (pending.has(rid)) return pending.get(rid).promise;
      const r = byId.get(rid);
      const el = document.createElement("script");
      el.src = "routes/" + encodeURIComponent(r.file);
      el.async = true;
      const entry = { el };
      entry.promise = new Promise((resolve, reject) => {
        entry.resolve = resolve;
        const fail = () => { pending.delete(rid); clearTimeout(entry.timer); el.remove(); reject(new Error("Gagal memuat data rute")); };
        el.onerror = fail;
        entry.timer = setTimeout(fail, 20000);
      });
      pending.set(rid, entry);
      document.head.appendChild(el);
      return entry.promise;
    }

    // ===================================================================== lapisan peta
    const overviewLayer = L.layerGroup();
    const routeLayer = L.layerGroup();
    const busLayer = L.layerGroup();
    const nearLayer = L.layerGroup();
    const overviewLines = new Map(); // rid -> [polyline]
    for (const r of X.routes) {
      const lines = r.lines.map((coords) => {
        const pl = L.polyline(coords, { pane: "network", color: r.color, weight: 3, opacity: 0.55 });
        pl.bindTooltip(`<b>${esc(r.short)}</b> · ${esc(r.long)}`, { sticky: true, direction: "top", className: "net-tip" });
        pl.on("click", () => go(r.id));
        return pl;
      });
      overviewLines.set(r.id, lines);
    }

    function syncOverview(visibleIds) {
      overviewLayer.clearLayers();
      const sel = st.routeId;
      for (const rid of visibleIds) {
        for (const pl of overviewLines.get(rid)) {
          pl.setStyle({ opacity: sel ? (rid === sel ? 0 : 0.14) : 0.55, weight: sel ? 2 : 3 });
          overviewLayer.addLayer(pl);
        }
      }
    }

    // ===================================================================== filter & pencarian
    const searchText = new Map(X.routes.map((r) => [r.id, norm([r.short, r.long, r.main, r.cat, ...r.heads].join(" "))]));

    function matchRoutes() {
      const toks = norm(st.query).split(" ").filter(Boolean);
      const q = norm(st.query);
      const out = [];
      for (const r of X.routes) {
        if (st.cats.size && !st.cats.has(r.cat)) continue;
        if (st.runOnly && (st.live.get(r.id) || {}).state !== "run") continue;
        let score = 9;
        if (toks.length) {
          const text = searchText.get(r.id);
          if (!toks.every((t) => text.includes(t))) continue;
          const sh = norm(r.short);
          score = sh === q ? 0 : sh.startsWith(q) ? 1 : norm(r.long).includes(q) ? 2 : 3;
        }
        out.push({ r, score });
      }
      if (toks.length) out.sort((a, b) => a.score - b.score);
      return out.map((x) => x.r);
    }

    function matchPlaces() {
      const toks = norm(st.query).split(" ").filter(Boolean);
      if (!toks.length || norm(st.query).length < 3) return [];
      const q = norm(st.query);
      const res = [];
      X.places.forEach((p, idx) => {
        const n = norm(p[0]);
        if (!toks.every((t) => n.includes(t))) return;
        res.push({ idx, rank: n === q ? 0 : n.startsWith(q) ? 1 : 2, n: p[3].length });
      });
      res.sort((a, b) => a.rank - b.rank || b.n - a.n);
      return res.slice(0, 12).map((x) => ({ idx: x.idx }));
    }

    function nearestPlaces(lat, lon) {
      const res = X.places.map((p, idx) => ({ idx, d: E.haversine([lat, lon], [p[1], p[2]]) }));
      res.sort((a, b) => a.d - b.d);
      return res.slice(0, 10);
    }

    // ===================================================================== render: daftar
    function renderCats() {
      const total = X.routes.length;
      $("catFilter").innerHTML =
        `<button type="button" class="cat ${st.cats.size ? "" : "on"}" data-cat="" aria-pressed="${!st.cats.size}">Semua <small>${total}</small></button>` +
        X.categories.map((c) => {
          const on = st.cats.has(c.id);
          return `<button type="button" class="cat ${on ? "on" : ""}" data-cat="${esc(c.id)}" aria-pressed="${on}">${esc(c.id)} <small>${c.count}</small></button>`;
        }).join("");
    }

    function placeRow(idx, dist) {
      const p = X.places[idx];
      const rids = p[3];
      return `<li class="place">
        <button type="button" class="place-name" data-place="${idx}">
          <span>${esc(p[0])}</span>${dist != null ? `<small>${dist < 1000 ? Math.round(dist) + " m" : (dist / 1000).toFixed(1).replace(".", ",") + " km"}</small>` : ""}
        </button>
        <div class="chips">${rids.map((rid) => chip(rid, true)).join("")}</div>
      </li>`;
    }

    function renderPlaces() {
      const box = $("placeResults");
      if (st.near) {
        const list = nearestPlaces(st.near.lat, st.near.lon);
        box.innerHTML = `<section class="place-box">
          <div class="section-title">Halte terdekat dari lokasi Anda
            <button type="button" class="link-btn" data-act="clear-near">Tutup</button></div>
          <ul class="place-list">${list.map((x) => placeRow(x.idx, x.d)).join("")}</ul></section>`;
        return;
      }
      const list = matchPlaces();
      box.innerHTML = list.length
        ? `<section class="place-box"><div class="section-title">Halte cocok <span class="muted">${list.length}${list.length === 12 ? "+" : ""}</span></div>
           <ul class="place-list">${list.map((x) => placeRow(x.idx)).join("")}</ul></section>`
        : "";
    }

    function routeRow(r) {
      const live = st.live.get(r.id);
      const l = liveLabel(live);
      return `<li><button type="button" class="rrow" data-rid="${esc(r.id)}">
        <span class="chip rchip" style="background:${r.color};color:${r.text}">${esc(r.short)}</span>
        <span class="rrow-main">
          <span class="rrow-name">${esc(r.long)}</span>
          <span class="rrow-meta">${r.stops} halte · ${String(r.km).replace(".", ",")} km · ${r.variants} varian${hoursLabel(live) ? ` · <span class="nowrap">${hoursLabel(live)}</span>` : ""}</span>
        </span>
        <span class="rlive ${l.cls}" data-live="${esc(r.id)}">${l.text}</span>
      </button></li>`;
    }

    function renderList() {
      const routes = matchRoutes();
      st.listSig = routes.map((r) => r.id).join(",");
      const box = $("routeList");
      if (!routes.length) {
        const why = st.query ? `Tidak ada rute yang cocok dengan "<b>${esc(st.query)}</b>"` : "Tidak ada rute yang cocok dengan filter ini";
        box.innerHTML = `<div class="empty">${why}${st.runOnly ? " yang sedang beroperasi" : ""}.
          <button type="button" class="link-btn" data-act="reset">Hapus pencarian &amp; filter</button></div>`;
      } else {
        const groups = new Map();
        for (const r of routes) {
          const key = st.query ? "Hasil pencarian" : r.cat;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(r);
        }
        box.innerHTML = [...groups].map(([g, rs]) =>
          `<section><h3 class="group-title">${esc(g)} <span class="muted">${rs.length} rute</span></h3>
           <ul class="rlist">${rs.map(routeRow).join("")}</ul></section>`).join("");
      }
      syncOverview(routes.map((r) => r.id));
    }

    function refreshListLive() {
      if (st.runOnly) {
        const sig = matchRoutes().map((r) => r.id).join(",");
        if (sig !== st.listSig) { renderList(); return; }
      }
      document.querySelectorAll("#routeList [data-live]").forEach((el) => {
        const live = st.live.get(el.dataset.live);
        const l = liveLabel(live);
        if (el.textContent !== l.text) el.textContent = l.text;
        el.className = "rlive " + l.cls;
      });
    }

    function computeLive(clock) {
      for (const r of X.routes) st.live.set(r.id, E.routeLive(X.calendar, r, clock));
    }

    // ===================================================================== render: detail rute
    function variantMeta(p) {
      const cal = X.calendar[p.service_id];
      return `${p.stops.length} halte · ${(p.length / 1000).toFixed(1).replace(".", ",")} km · ${mins(p.t[p.t.length - 1])} mnt · ${daysLabel(cal)}`;
    }

    function renderDetailShell(rid, body) {
      const r = byId.get(rid);
      $("routeDetail").innerHTML = `
        <div class="rd-top">
          <button type="button" class="back-btn" data-act="back">‹ Semua rute</button>
          <button type="button" class="link-btn" data-act="copy">Salin tautan rute</button>
        </div>
        <div class="rd-head">
          <span class="chip chip-lg" style="background:${r.color};color:${r.text}">${esc(r.short)}</span>
          <div><h2 class="rd-title">${esc(r.long)}</h2>
          <div class="rd-sub">${esc(r.cat)} · ${fareLabel(r.fare)}</div></div>
        </div>
        <div id="rdStatus" class="rd-status"></div>
        ${body}`;
    }

    function renderDetail(clock) {
      const rid = st.routeId;
      const pay = loaded.get(rid);
      const p = pay.patterns[st.tid];
      const r = byId.get(rid);
      const today = clock.weekday;

      const ordered = pay.order;
      const shown = st.allVariants ? ordered : ordered.slice(0, VARIANTS_COLLAPSED);
      if (!shown.includes(st.tid)) shown.push(st.tid);
      const variants = shown.map((tid) => {
        const v = pay.patterns[tid];
        const off = !E.serviceActive(X, v.service_id, today);
        const on = tid === st.tid;
        return `<button type="button" class="variant ${on ? "on" : ""}" role="radio" aria-checked="${on}" data-tid="${esc(tid)}" style="--c:${r.color}">
          <span class="v-label">${esc(v.label)}${v.loop ? ' <span class="tag">Putar balik</span>' : ""}${off ? ' <span class="tag tag-off">Tidak berlaku hari ini</span>' : ""}</span>
          <span class="v-meta">Arah ${esc(v.headsign)} · ${variantMeta(v)}</span>
        </button>`;
      }).join("");
      const more = ordered.length > VARIANTS_COLLAPSED
        ? `<button type="button" class="link-btn" data-act="variants" aria-expanded="${st.allVariants}">${st.allVariants ? "Ringkas daftar varian" : `Tampilkan ${ordered.length - VARIANTS_COLLAPSED} varian lain`}</button>`
        : "";

      const cal = X.calendar[p.service_id];
      const sched = mergeWindows(p.freq).map(([s, e, h]) =>
        `<tr data-win="${s}-${e}"><td>${E.fmtClock(s)} - ${E.fmtClock(e)}</td><td>tiap ${mins(h)} mnt</td></tr>`).join("");

      const stopsHtml = p.stops.map((sid, i) => {
        const s = pay.stops[sid];
        const pl = s.pl != null ? X.places[s.pl] : null;
        const others = pl ? pl[3].filter((x) => x !== rid) : [];
        const chipsHtml = others.slice(0, TRANSFER_CHIPS).map((x) => chip(x, true)).join("") +
          (others.length > TRANSFER_CHIPS ? `<button type="button" class="chip chip-more" data-stop="${esc(sid)}">+${others.length - TRANSFER_CHIPS}</button>` : "");
        const first = i === 0, last = i === p.stops.length - 1;
        return `<li class="rs ${first ? "first" : ""} ${last ? "last" : ""}" style="--rail:${r.color}">
          <span class="rs-time">${first ? "Awal" : "+" + mins(p.t[i])}</span>
          <span class="rs-rail"><span class="tl-node ${first || last ? "" : "small"}"></span></span>
          <span class="rs-body">
            <span class="rs-line">
              <button type="button" class="rs-name" data-stop="${esc(sid)}">${esc(s.name)}</button>
              <span class="rs-bus" data-bus="${i}"></span>
              <span class="rs-eta" data-eta="${i}"></span>
            </span>
            ${chipsHtml ? `<span class="chips rs-chips"><span class="rs-tr">Transit</span>${chipsHtml}</span>` : ""}
          </span>
        </li>`;
      }).join("");

      renderDetailShell(rid, `
        <h3 class="sub-title">Varian lintasan <span class="muted">${ordered.length}</span></h3>
        <div class="variants" role="radiogroup" aria-label="Varian lintasan">${variants}</div>
        ${more}
        <div id="rdSummary" class="summary-grid"></div>
        <div id="rdNote" class="warn" role="status" hidden></div>
        <button type="button" class="disclosure" data-act="sched" aria-expanded="${st.schedOpen}" aria-controls="rdSched">
          Jadwal &amp; frekuensi varian ini <span class="muted">${esc(daysLabel(cal))}</span></button>
        <div id="rdSched" ${st.schedOpen ? "" : "hidden"}>
          <table class="sched"><thead><tr><th>Jam keberangkatan dari awal</th><th>Headway</th></tr></thead><tbody>${sched}</tbody></table>
          <p class="note">Sumber: frequencies.txt GTFS. Waktu antar-halte dari stop_times.txt.</p>
        </div>
        <h3 class="sub-title">Halte yang dilewati <span class="muted">${p.stops.length}</span></h3>
        <ol class="rstops">${stopsHtml}</ol>`);
      refreshDetail(clock);
    }

    function refreshDetail(clock) {
      const rid = st.routeId;
      const pay = loaded.get(rid);
      if (!pay || !st.tid || !$("rdSummary")) return;
      const p = pay.patterns[st.tid];
      const live = st.live.get(rid) || E.routeLive(X.calendar, byId.get(rid), clock);
      const l = liveLabel(live);
      $("rdStatus").innerHTML = `<span class="rlive ${l.cls}">${l.text}</span>
        <span class="muted">${live.state === "run" ? "semua varian, estimasi jadwal" : ""}${hoursLabel(live) ? (live.state === "run" ? " · " : "") + "Operasi hari ini " + hoursLabel(live) : ""}</span>`;

      const activeToday = E.serviceActive(X, p.service_id, clock.weekday);
      const hw = activeToday ? E.headwayAt(p.freq, clock.sec) : null;
      const busesHere = st.fleet.filter((b) => b.tripId === st.tid);
      const first = p.freq.length ? p.freq[0][0] : null;
      const allDay = p.freq.some(([s, e]) => s === 0 && e >= 86399);
      $("rdSummary").innerHTML = `
        <div><b>${hw ? mins(hw) + " mnt" : "-"}</b><span>headway kini</span></div>
        <div><b>${busesHere.length}</b><span>bus di varian</span></div>
        <div><b>${mins(p.t[p.t.length - 1])}</b><span>mnt tempuh</span></div>
        <div><b>${allDay ? "24 jam" : first != null ? E.fmtClock(first) : "-"}</b><span>${allDay ? "operasi" : "mulai"}</span></div>`;
      const note = $("rdNote");
      const noteTxt = !activeToday
        ? `Varian ini hanya berlaku ${daysLabel(X.calendar[p.service_id])}. Hari ini tidak ada keberangkatan.`
        : hw == null ? "Di luar jam operasi varian ini. Lihat tabel jadwal untuk jam keberangkatan." : "";
      note.hidden = !noteTxt;
      if (note.textContent !== noteTxt) note.textContent = noteTxt;
      document.querySelectorAll("#rdSched tr[data-win]").forEach((tr) => {
        const [s, e] = tr.dataset.win.split("-").map(Number);
        tr.classList.toggle("now", activeToday && clock.sec >= s && clock.sec < e);
      });

      // bus per halte (menuju / berhenti di halte i)
      const at = {};
      for (const b of busesHere) {
        const k = b.stopped ? b.segIndex : b.segIndex + 1;
        (at[k] = at[k] || []).push(b);
      }
      document.querySelectorAll("#routeDetail [data-eta]").forEach((el) => {
        const i = Number(el.dataset.eta);
        let txt = "-";
        if (activeToday) {
          const arr = E.nextArrivals(p, i, clock.sec, 2);
          if (arr.length) txt = arr.map((t) => E.fmtWait(t - clock.sec)).join(" · ");
        }
        if (el.textContent !== txt) el.textContent = txt;
      });
      document.querySelectorAll("#routeDetail [data-bus]").forEach((el) => {
        const list = at[Number(el.dataset.bus)] || [];
        const stopped = list.some((b) => b.stopped);
        const txt = list.length ? `🚌 ${list.length}${stopped ? " di halte" : ""}` : "";
        if (el.textContent !== txt) {
          el.textContent = txt;
          el.style.background = list.length ? byId.get(rid).color : "";
          el.style.color = list.length ? byId.get(rid).text : "";
          el.title = list.length ? `${list.length} bus ${stopped ? "berhenti di" : "menuju"} halte ini` : "";
        }
      });
    }

    // ===================================================================== peta: rute terpilih
    let routeBounds = null;
    function drawRoute() {
      routeLayer.clearLayers();
      const rid = st.routeId;
      const r = byId.get(rid);
      const pay = loaded.get(rid);
      if (!pay) {
        // data detail belum ada: tampilkan garis ringkas dari katalog
        for (const c of r.lines) L.polyline(c, { pane: "legs", color: r.color, weight: 5, opacity: 0.8 }).addTo(routeLayer);
        routeBounds = L.latLngBounds([[r.bbox[0], r.bbox[1]], [r.bbox[2], r.bbox[3]]]);
        return;
      }
      for (const tid of pay.order) {
        if (tid === st.tid) continue;
        L.polyline(pay.patterns[tid].shape, { pane: "legs", color: r.color, weight: 3, opacity: 0.35, interactive: false }).addTo(routeLayer);
      }
      const p = pay.patterns[st.tid];
      L.polyline(p.shape, { pane: "legs", color: "#ffffff", weight: 10, opacity: 1, lineJoin: "round", interactive: false }).addTo(routeLayer);
      L.polyline(p.shape, { pane: "legs", color: r.color, weight: 6, opacity: 1, lineJoin: "round", interactive: false }).addTo(routeLayer);
      p.stops.forEach((sid, i) => {
        const s = pay.stops[sid];
        const major = i === 0 || i === p.stops.length - 1;
        const m = L.circleMarker([s.lat, s.lon], {
          pane: "legStops", radius: major ? 7 : 4.5, color: r.color, weight: major ? 4 : 3, fillColor: "#fff", fillOpacity: 1,
        }).addTo(routeLayer);
        m.bindTooltip(esc(s.name), {
          permanent: true, direction: major ? "top" : "right", offset: major ? [0, -8] : [6, 0],
          className: "stop-label " + (major ? "major" : "minor"),
        });
        m.on("click", () => openStopPopup(sid));
      });
      routeBounds = L.latLngBounds(p.shape);
    }

    function fit() {
      const wide = window.innerWidth > 820;
      const opts = { paddingTopLeft: [30, 70], paddingBottomRight: [30, wide ? 40 : 30] };
      if (st.routeId && routeBounds) { map.fitBounds(routeBounds, opts); return; }
      const ids = st.listSig ? st.listSig.split(",") : [];
      let b = null;
      for (const id of ids) {
        const r = byId.get(id);
        const rb = L.latLngBounds([[r.bbox[0], r.bbox[1]], [r.bbox[2], r.bbox[3]]]);
        b = b ? b.extend(rb) : rb;
      }
      if (b) map.fitBounds(b, opts);
    }

    // ===================================================================== popup halte
    function stopEtaRows(stopIds, clock) {
      const set = new Set(stopIds);
      const rows = new Map();
      for (const [rid, pay] of loaded) {
        for (const tid of pay.order) {
          const p = pay.patterns[tid];
          if (!E.serviceActive(X, p.service_id, clock.weekday)) continue;
          for (let i = 0; i < p.stops.length - 1; i++) {
            if (!set.has(p.stops[i])) continue;
            const key = rid + "|" + p.headsign;
            const cur = rows.get(key) || { rid, hs: p.headsign, times: [] };
            cur.times.push(...E.nextArrivals(p, i, clock.sec, 2));
            rows.set(key, cur);
          }
        }
      }
      return [...rows.values()]
        .map((r) => ({ ...r, times: [...new Set(r.times.map((t) => Math.round(t / 30) * 30))].sort((a, b) => a - b) }))
        .filter((r) => r.times.length)
        .sort((a, b) => a.times[0] - b.times[0])
        .slice(0, 8);
    }

    function openPlacePopup(idx, latlng, stopIds) {
      const p = X.places[idx];
      const clock = E.wibNow();
      const rows = stopIds ? stopEtaRows(stopIds, clock) : [];
      const etas = rows.map((r) => `<div class="pop-row">${chip(r.rid)}<span class="hs">${esc(r.hs)}</span>
        <span class="eta">${r.times.slice(0, 2).map((t) => E.fmtWait(t - clock.sec)).join(" · ")}</span></div>`).join("");
      L.popup({ maxWidth: 320, autoPanPaddingTopLeft: [20, 70] })
        .setLatLng(latlng || [p[1], p[2]])
        .setContent(`<div class="pop-title">Halte ${esc(p[0])}</div>
          <div class="pop-sub">${p[3].length} rute singgah · pilih untuk membuka</div>
          <div class="chips pop-chips">${p[3].map((rid) => chip(rid, true)).join("")}</div>
          ${etas ? `<div class="pop-sub" style="margin:8px 0 0">Kedatangan berikutnya</div>${etas}` : ""}
          <div class="pop-sub" style="margin:6px 0 0">Estimasi dari jadwal GTFS · ${E.fmtClock(clock.sec)} WIB</div>`)
        .openOn(map);
    }

    function openStopPopup(sid) {
      const s = RD.stops[sid];
      if (!s) return;
      if (s.pl == null) { map.setView([s.lat, s.lon], 17); return; }
      const ids = Object.keys(RD.stops).filter((k) => RD.stops[k].pl === s.pl);
      openPlacePopup(s.pl, [s.lat, s.lon], ids);
    }

    function showPlace(idx) {
      const p = X.places[idx];
      map.setView([p[1], p[2]], 17);
      const ids = Object.keys(RD.stops).filter((k) => RD.stops[k].pl === idx);
      openPlacePopup(idx, [p[1], p[2]], ids);
      collapseSheet();
    }

    function collapseSheet() {
      if (window.innerWidth <= 820) $("panel").classList.remove("expanded");
    }

    // ===================================================================== bus (estimasi jadwal)
    const busMarkers = new Map();
    function busIcon(b, cls) {
      const r = byId.get(b.routeId);
      return L.divIcon({
        className: "bus-icon", iconSize: [30, 30], iconAnchor: [15, 15],
        html: `<div class="bus ${cls}" style="--c:${r.color};--t:${r.text};--b:${Math.round(b.bearing)}deg"><div class="arrow"></div>${esc(r.short)}</div>`,
      });
    }

    function updateBuses(clock) {
      const pay = loaded.get(st.routeId);
      st.fleet = pay ? E.fleet(RD, pay.order, clock) : [];
      const seen = new Set();
      for (const b of st.fleet) {
        seen.add(b.id);
        const cls = [b.stopped ? "stopped" : "", b.tripId === st.tid ? "" : "offroute", st.selectedBus === b.id ? "selected" : ""].join(" ");
        let m = busMarkers.get(b.id);
        if (!m) {
          m = L.marker([b.lat, b.lon], { pane: "buses", icon: busIcon(b, cls), keyboard: false });
          m.on("click", (ev) => { L.DomEvent.stopPropagation(ev); st.selectedBus = b.id; renderBusCard(); });
          m._cls = cls;
          busLayer.addLayer(m);
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
      for (const [id, m] of busMarkers) if (!seen.has(id)) { busLayer.removeLayer(m); busMarkers.delete(id); }
      const sel = st.fleet.find((b) => b.id === st.selectedBus);
      if (st.selectedBus && !sel) { st.selectedBus = null; st.follow = false; $("routeBusCard").classList.add("hidden"); }
      if (sel && st.follow) map.panTo([sel.lat, sel.lon], { animate: false });
      return st.fleet.length;
    }

    function clearBuses() {
      busLayer.clearLayers();
      busMarkers.clear();
      st.fleet = [];
      st.selectedBus = null;
      st.follow = false;
      $("routeBusCard").classList.add("hidden");
    }

    function renderBusCard() {
      const card = $("routeBusCard");
      const b = st.fleet.find((x) => x.id === st.selectedBus);
      if (!b) { card.classList.add("hidden"); return; }
      const r = byId.get(b.routeId);
      const p = RD.patterns[b.tripId];
      const status = b.stopped ? `Berhenti di <b>${esc(RD.stops[b.atStop].name)}</b>` : `Menuju <b>${esc(RD.stops[b.nextStop].name)}</b> · ${E.fmtWait(b.etaNext)}`;
      card.style.setProperty("--c", r.color);
      card.innerHTML = `
        <div class="bc-head">${chip(b.routeId)}
          <div class="bc-title">${esc(b.headsign)}<small>${esc(p.label)}</small></div>
          <button type="button" class="bc-close" data-act="close" aria-label="Tutup info bus">✕</button>
        </div>
        <div class="tl-note" style="margin-top:8px">${status}</div>
        <div class="bc-progress"><div style="width:${(b.progress * 100).toFixed(1)}%"></div></div>
        <div class="bc-grid">
          <div><span>Kecepatan est.</span><b>${b.stopped ? 0 : b.speedKmh} km/j</b></div>
          <div><span>Sisa halte</span><b>${p.stops.length - 1 - b.segIndex} halte</b></div>
          <div><span>Berangkat awal</span><b>${E.fmtClock(b.dep)} WIB</b></div>
          <div><span>Tiba di akhir</span><b>${E.fmtClock(b.dep + p.t[p.t.length - 1])} WIB</b></div>
        </div>
        <div class="bc-actions">
          <button type="button" data-act="follow" class="${st.follow ? "on" : ""}" aria-pressed="${st.follow}">${st.follow ? "Mengikuti bus" : "Ikuti bus"}</button>
          <button type="button" data-act="zoom">Perbesar</button>
        </div>`;
      card.classList.remove("hidden");
    }

    $("routeBusCard").addEventListener("click", (e) => {
      const act = e.target.closest("button")?.dataset.act;
      if (act === "close") { st.selectedBus = null; st.follow = false; $("routeBusCard").classList.add("hidden"); }
      if (act === "follow") { st.follow = !st.follow; renderBusCard(); }
      if (act === "zoom") {
        const b = st.fleet.find((x) => x.id === st.selectedBus);
        if (b) map.setView([b.lat, b.lon], 17);
      }
    });
    map.on("dragstart", () => {
      if (st.active && st.follow) { st.follow = false; renderBusCard(); toast("Mode ikuti bus dimatikan"); }
    });

    // ===================================================================== navigasi (hash)
    function go(rid, tid) {
      location.hash = "#rute/" + encodeURIComponent(rid) + (tid ? "/" + encodeURIComponent(tid) : "");
    }

    async function showRoute(rid, tid) {
      const r = byId.get(rid);
      if (!r) { toast("Rute tidak ditemukan di GTFS"); location.hash = "#rute"; return; }
      const changed = st.routeId !== rid;
      st.routeId = rid;
      if (changed) { st.allVariants = false; st.schedOpen = false; clearBuses(); }
      $("routesBrowse").hidden = true;
      $("routeDetail").hidden = false;
      syncOverview(st.listSig ? st.listSig.split(",") : X.routes.map((x) => x.id));

      if (!loaded.has(rid)) {
        st.tid = null;
        renderDetailShell(rid, `<div class="loading" role="status"><span class="spinner"></span>Memuat ${r.variants} varian lintasan dan ${r.stops} halte rute ${esc(r.short)}</div>`);
        drawRoute();
        fit();
        try {
          await loadRoute(rid);
        } catch (err) {
          if (st.routeId !== rid) return;
          renderDetailShell(rid, `<div class="warn" role="alert">Data rute ${esc(r.short)} gagal dimuat. Periksa koneksi lalu coba lagi.
            <button type="button" class="link-btn" data-act="retry">Coba lagi</button></div>`);
          return;
        }
        if (st.routeId !== rid) return;
      }
      const pay = loaded.get(rid);
      const clock = E.wibNow();
      const prevTid = st.tid;
      st.tid = tid && pay.patterns[tid] ? tid : (prevTid && pay.patterns[prevTid] ? prevTid : defaultVariant(pay, clock));
      if (st.tid !== prevTid) clearBuses();
      updateBuses(clock);
      renderDetail(clock);
      drawRoute();
      if (changed || st.tid !== prevTid) fit();
      if (changed) {
        $("panel").scrollTop = 0;
        const back = document.querySelector("#routeDetail .back-btn");
        if (back) back.focus({ preventScroll: true });
      }
    }

    function defaultVariant(pay, clock) {
      const today = pay.order.filter((t) => E.serviceActive(X, pay.patterns[t].service_id, clock.weekday));
      const now = today.find((t) => E.headwayAt(pay.patterns[t].freq, clock.sec));
      return now || today[0] || pay.order[0];
    }

    function showList() {
      const prev = st.routeId;
      st.routeId = null;
      st.tid = null;
      clearBuses();
      routeLayer.clearLayers();
      routeBounds = null;
      $("routeDetail").hidden = true;
      $("routesBrowse").hidden = false;
      renderList();
      if (prev) {
        const row = document.querySelector(`#routeList .rrow[data-rid="${CSS.escape(prev)}"]`);
        if (row) row.focus();
      }
    }

    // ===================================================================== event panel
    $("catFilter").addEventListener("click", (e) => {
      const b = e.target.closest("[data-cat]");
      if (!b) return;
      const c = b.dataset.cat;
      if (!c) st.cats.clear();
      else if (st.cats.has(c)) st.cats.delete(c);
      else st.cats.add(c);
      renderCats();
      renderList();
      fit();
    });
    let qTimer;
    $("routeQuery").addEventListener("input", (e) => {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => {
        st.query = e.target.value;
        st.near = null;
        nearLayer.clearLayers();
        renderPlaces();
        renderList();
        if (st.listSig) fit();
      }, 250);
    });
    $("routeQuery").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault(); // tanpa ini Enter ikut "mengklik" baris yang baru difokus
        const first = document.querySelector("#routeList .rrow");
        if (first) first.focus();
      }
    });
    $("chkRunning").addEventListener("change", (e) => { st.runOnly = e.target.checked; renderList(); });

    $("btnNearby").addEventListener("click", () => {
      if (!navigator.geolocation) { showNearError("Perangkat ini tidak mendukung geolokasi."); return; }
      const btn = $("btnNearby");
      btn.disabled = true;
      btn.textContent = "Mencari lokasi";
      navigator.geolocation.getCurrentPosition((pos) => {
        btn.disabled = false;
        btn.textContent = "Halte terdekat";
        st.near = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        renderPlaces();
        nearLayer.clearLayers();
        L.circleMarker([st.near.lat, st.near.lon], { pane: "pins", radius: 8, color: "#fff", weight: 3, fillColor: "#1351a8", fillOpacity: 1 })
          .bindTooltip("Lokasi Anda", { direction: "top" }).addTo(nearLayer);
        const pts = nearestPlaces(st.near.lat, st.near.lon).map((x) => [X.places[x.idx][1], X.places[x.idx][2]]);
        map.fitBounds(L.latLngBounds([[st.near.lat, st.near.lon], ...pts]), { padding: [40, 40], maxZoom: 17 });
      }, (err) => {
        btn.disabled = false;
        btn.textContent = "Halte terdekat";
        showNearError(err.code === 1
          ? "Izin lokasi ditolak. Aktifkan izin lokasi untuk situs ini di pengaturan browser, atau cari halte dengan nama."
          : "Lokasi tidak bisa didapat saat ini. Coba lagi, atau cari halte dengan nama.");
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
    });
    function showNearError(msg) {
      $("placeResults").innerHTML = `<div class="warn" role="alert">${esc(msg)}
        <button type="button" class="link-btn" data-act="clear-near">Tutup</button></div>`;
    }

    function onPanelClick(e) {
      const open = e.target.closest("[data-open]");
      if (open) { go(open.dataset.open); map.closePopup(); return; }
      const row = e.target.closest(".rrow");
      if (row) { go(row.dataset.rid); return; }
      const pl = e.target.closest("[data-place]");
      if (pl) { showPlace(Number(pl.dataset.place)); return; }
      const v = e.target.closest("[data-tid]");
      if (v) { history.replaceState(null, "", "#rute/" + encodeURIComponent(st.routeId) + "/" + encodeURIComponent(v.dataset.tid)); showRoute(st.routeId, v.dataset.tid); return; }
      const s = e.target.closest("[data-stop]");
      if (s) {
        const stp = RD.stops[s.dataset.stop];
        map.setView([stp.lat, stp.lon], 17);
        openStopPopup(s.dataset.stop);
        collapseSheet();
        return;
      }
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "back") location.hash = "#rute";
      else if (act === "retry") showRoute(st.routeId, st.tid);
      else if (act === "variants") { st.allVariants = !st.allVariants; renderDetail(E.wibNow()); }
      else if (act === "sched") {
        st.schedOpen = !st.schedOpen;
        $("rdSched").hidden = !st.schedOpen;
        e.target.closest("[data-act]").setAttribute("aria-expanded", String(st.schedOpen));
      } else if (act === "copy") {
        const url = location.href;
        (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
          .then(() => toast("Tautan rute disalin"), () => toast("Salin manual: " + url));
      } else if (act === "reset") {
        st.query = ""; st.cats.clear(); st.runOnly = false;
        $("routeQuery").value = ""; $("chkRunning").checked = false;
        renderCats(); renderPlaces(); renderList(); $("routeQuery").focus();
      } else if (act === "clear-near") {
        st.near = null; nearLayer.clearLayers(); renderPlaces();
      }
    }
    $("viewRoutes").addEventListener("click", onPanelClick);
    map.getContainer().addEventListener("click", (e) => {
      const open = e.target.closest(".leaflet-popup [data-open]");
      if (open) { go(open.dataset.open); map.closePopup(); }
    });

    // ===================================================================== API untuk app.js
    let panelSec = -1;
    return {
      total: X.routes.length,
      enter() {
        st.active = true;
        computeLive(E.wibNow());
        if (!$("catFilter").childElementCount) { renderCats(); renderList(); }
        if (st.netOn) overviewLayer.addTo(map);
        routeLayer.addTo(map);
        busLayer.addTo(map);
        nearLayer.addTo(map);
      },
      exit() {
        st.active = false;
        map.removeLayer(overviewLayer);
        map.removeLayer(routeLayer);
        map.removeLayer(busLayer);
        map.removeLayer(nearLayer);
        $("routeBusCard").classList.add("hidden");
      },
      /** hash "#rute", "#rute/<id>", "#rute/<id>/<trip>" */
      route(parts) {
        if (parts[0]) showRoute(decodeURIComponent(parts[0]), parts[1] ? decodeURIComponent(parts[1]) : null);
        else if (st.routeId || $("routesBrowse").hidden) showList();
        if (!parts[0]) fit();
      },
      frame(clock) {
        return st.routeId ? updateBuses(clock) : 0;
      },
      panelTick(clock, force) {
        const sec = Math.floor(clock.sec);
        if (!force && (sec === panelSec || sec % 5 !== 0)) return;
        panelSec = sec;
        computeLive(clock);
        if (st.routeId) {
          refreshDetail(clock);
          if (st.selectedBus) renderBusCard();
        } else refreshListLive();
      },
      busTick() { if (st.selectedBus) renderBusCard(); },
      /** Teks badge status: bus rute terbuka, atau total estimasi bus di seluruh jaringan. */
      badge(count) {
        if (st.routeId) return `${count} bus rute ${byId.get(st.routeId).short} di layar`;
        let sum = 0, n = 0;
        for (const l of st.live.values()) if (l.state === "run") { sum += l.buses; n++; }
        return `${sum.toLocaleString("id-ID")} bus di ${n} rute aktif`;
      },
      fit,
      setNetwork(on) {
        st.netOn = on;
        if (on) overviewLayer.addTo(map); else map.removeLayer(overviewLayer);
      },
    };
  };
})();
