/*
 * Konfigurasi opsional.
 *
 * liveFeedUrl: URL JSON posisi kendaraan (mis. proxy GTFS-Realtime milik Anda sendiri).
 * Jika diisi, marker bus GPS ditampilkan di atas estimasi jadwal. Format yang diterima:
 *   { "vehicles": [ { "id": "TJ-123", "route_id": "9", "lat": -6.2, "lon": 106.8,
 *                     "bearing": 270, "timestamp": 1730000000 } ] }
 * Biarkan kosong untuk mode estimasi jadwal GTFS.
 */
window.TIJE_CONFIG = {
  liveFeedUrl: "",
  liveFeedIntervalMs: 10000,
};
