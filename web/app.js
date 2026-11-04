/* TIJE Live · kerangka aplikasi: peta, toolbar, jam WIB, feed GPS opsional, routing hash.
 * Bergantung pada: Leaflet, TIJE_INDEX, TijeEngine, TijeRoutes, TIJE_CONFIG. */
(function () {
  "use strict";

  const E = window.TijeEngine;
  const CFG = window.TIJE_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const DAYS = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];

  const state = {
    liveVehicles: [],      // dari liveFeedUrl (opsional)
    lastPanelSec: -1,
  };

  // ======================================================================= peta
  const map = L.map("map", { zoomControl: false, preferCanvas: false, minZoom: 9, maxZoom: 19 })
    .setView([-6.2, 106.83], 11);
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

  // ======================================================================= toast
  let toastTimer;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), 2200);
  }

  // ======================================================================= semua rute
  const routesMode = window.TijeRoutes({ map, E, toast, liveVehicles: () => state.liveVehicles });
  routesMode.enter();

  // ======================================================================= toolbar & panel
  $("btnFit").addEventListener("click", () => routesMode.fit());
  $("chkNetwork").addEventListener("change", (e) => routesMode.setNetwork(e.target.checked));
  $("sheetHandle").addEventListener("click", () => {
    const ex = $("panel").classList.toggle("expanded");
    $("sheetHandle").setAttribute("aria-expanded", String(ex));
  });

  // ======================================================================= routing hash
  // "#rute" = daftar, "#rute/<id>" = detail, "#rute/<id>/<trip>" = varian. Hash lain -> daftar.
  function onHash() {
    const h = location.hash.replace(/^#/, "");
    const parts = h.startsWith("rute/") ? h.split("/").slice(1) : [];
    routesMode.route(parts);
    tick(true);
  }
  window.addEventListener("hashchange", onHash);

  // ======================================================================= live feed opsional
  async function pollLive() {
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
    const clock = E.wibNow();
    const count = routesMode.frame(clock);
    const sec = Math.floor(clock.sec);
    if (forcePanel || sec !== state.lastPanelSec) {
      state.lastPanelSec = sec;
      $("clock").textContent = E.fmtClock(clock.sec, true);
      routesMode.busTick();
      routesMode.panelTick(clock, forcePanel);
      $("dayBadge").textContent = `${DAYS[clock.weekday]} · ${routesMode.badge(count)}`;
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

  $("feedDate").textContent = window.TIJE_INDEX.feedDate;
  onHash();
  requestAnimationFrame(frame);
})();
