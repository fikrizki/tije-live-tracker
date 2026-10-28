# TIJE Live — Transjakarta Route Planner & Real-Time Bus Tracker

Aplikasi web interaktif perencana rute dan pelacak posisi bus **Transjakarta (TIJE)** untuk **4 rute utama dari Halte H.R. Rasuna Said menuju Jakarta Barat**, dibangun menggunakan dataset **GTFS Resmi PT Transjakarta** (`https://gtfs.transjakarta.co.id/files/file_gtfs.zip`, CC BY 4.0).

## Fitur Utama

- **4 Rute Rasuna Said ➜ Jakarta Barat:**
  1. **Grogol Reformasi** — Via Tol Dalam Kota (*Koridor 6 + JPO Kuningan + Koridor 9*)
  2. **Rawa Buaya** — Via Balai Kota (*Rute 6A + Rute 2A*)
  3. **Kalideres** — Via Thamrin & Monas (*Rute 6A + Koridor 1 + Koridor 3*)
  4. **Kebon Jeruk** — Via Tol Layang Express (*Rute L13E + Koridor 8*)
- **Geometri Jalan & Halte Asli (`shapes.txt` & `stops.txt`):** Menampilkan 58 koridor BRT latar, 200 halte BRT, dan jalur jalan presisi di atas peta **OpenStreetMap**, **Esri Street Map**, dan **Citra Satelit**.
- **Pelacakan Bus Real-Time (WIB / `Asia/Jakarta`):** Posisi bus, arah hadap (*bearing*), kecepatan, dan waktu tunggu halte berikutnya dihitung secara real-time berdasarkan `frequencies.txt` dan `stop_times.txt` resmi Transjakarta.
- **Dukungan Feed GPS Eksternal:** Dapat dihubungkan ke endpoint GTFS-Realtime kustom melalui `web/config.js`.

## Struktur Direktori

```
tije-live-tracker/
├── web/
│   ├── index.html       # Aplikasi utama (Leaflet + Panel Rute TIJE)
│   ├── app.js           # Logika UI peta, marker bus, popup halte, timeline
│   ├── engine.js        # Mesin kalkulasi posisi bus & ETA real-time (WIB)
│   ├── data.js          # Dataset terkompilasi dari GTFS resmi Transjakarta
│   ├── styles.css       # Styling responsif (Desktop & Mobile Bottom Sheet)
│   └── config.js        # Konfigurasi endpoint GPS live opsional
└── scripts/
    ├── route_planner.py # Mesin pencari rute (RAPTOR-lite) di atas GTFS
    ├── build_data.py    # Kompilator GTFS resmi -> web/data.js
    └── test_engine.js   # Pengujian unit engine di Node.js
```

## Cara Menjalankan Secara Lokal

```bash
cd web
python3 -m http.server 8787
```

Lalu buka `http://127.0.0.1:8787/` di browser.
