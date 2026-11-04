# TIJE Live · Transjakarta Route Planner & Bus Tracker

Aplikasi web peta rute dan pelacak posisi bus **Transjakarta (TIJE)** berbasis dataset **GTFS resmi PT Transjakarta** (`https://gtfs.transjakarta.co.id/files/file_gtfs.zip`, CC BY 4.0). Posisi bus adalah **estimasi dari jadwal GTFS** (frekuensi, waktu antar-halte, geometri jalan), bukan GPS bus.

Seluruh **241 rute** di feed GTFS (feed 30 Okt 2026), **694 pola trip**, **7.541 titik halte**:

| Jenis layanan | Rute |
|---|---|
| BRT | 31 |
| Angkutan Umum Integrasi | 64 |
| Transjabodetabek | 18 |
| Royaltrans | 13 |
| Mikrotrans | 98 |
| Rusun | 14 |
| Bus Wisata | 3 |

- **Katalog rute**: filter per jenis layanan (bisa gabung), cari kode/nama/tujuan, filter "hanya yang sedang beroperasi". Tiap baris menampilkan jumlah halte, panjang lintasan, jumlah varian, jam operasi hari ini, dan jumlah bus yang sedang jalan.
- **Cari halte** berdasarkan nama, atau **Halte terdekat** dari lokasi perangkat (geolokasi). Tiap halte menampilkan semua rute yang singgah.
- **Detail rute**:
  - semua **varian lintasan** (trip_short_name GTFS: lintasan penuh, via tol, parsial, putar balik), hari berlaku, jumlah halte, km, waktu tempuh;
  - status operasi rute, headway saat ini, jumlah bus di varian;
  - **tabel jadwal & frekuensi** (frequencies.txt), baris jam berjalan disorot;
  - **daftar semua halte** dengan menit dari halte awal, ETA 2 bus berikutnya, posisi bus menuju/di halte, dan **chip transit** ke rute lain di halte yang sama;
  - peta: lintasan varian terpilih (varian lain tipis), semua halte berlabel, bus bergerak dengan arah hadap; klik bus untuk kecepatan, sisa halte, jam berangkat/tiba, mode ikuti bus.
- **Tautan langsung**: `#rute/9`, `#rute/JAK.10`, `#rute/9/9-R03` (varian). Tombol back browser berfungsi.
- **Tarif** dari `fare_rules.txt` + `fare_attributes.txt` (Rp3.500, Gratis, Rp20.000 dst.). Rute tanpa entri tarif ditandai "Tarif tidak tercantum di GTFS".
- Warna chip rute dari `routes.txt`; 13 pasangan warna GTFS yang tidak lolos kontras WCAG AA diganti teks hitam/putih yang lolos.

## Struktur Direktori

```
tije-live-tracker/
├── web/
│   ├── index.html        # Aplikasi (Leaflet + panel)
│   ├── app.js            # Kerangka: peta, toolbar, jam WIB, feed GPS opsional, routing hash
│   ├── routes.js         # Katalog rute, pencarian, detail rute, bus di peta
│   ├── engine.js         # Posisi bus, ETA, status operasi rute (WIB)
│   ├── routes-index.js   # Katalog 241 rute + halte + garis jaringan (~1 MB, ~250 KB gzip)
│   ├── routes/<id>.js    # Detail per rute, dimuat saat rute dibuka (241 file)
│   ├── styles.css        # Desktop + bottom sheet mobile
│   └── config.js         # Endpoint GPS live opsional (ditampilkan pada rute yang dibuka)
└── scripts/
    ├── gtfs_lib.py       # Pembaca GTFS & pembentuk pola trip
    ├── build_routes.py   # GTFS -> web/routes-index.js + web/routes/*.js
    └── test_routes.js    # Uji 241 file rute terhadap katalog & engine
```

## Memperbarui Data GTFS

```bash
mkdir -p data/gtfs
curl -L -o data/gtfs.zip https://gtfs.transjakarta.co.id/files/file_gtfs.zip
unzip -o data/gtfs.zip -d data/gtfs
python3 scripts/build_routes.py
node scripts/test_routes.js
```

## Menjalankan Secara Lokal

```bash
cd web
python3 -m http.server 8787
```

Buka `http://127.0.0.1:8787/`. Fitur "Halte terdekat" butuh HTTPS atau localhost (syarat geolokasi browser).
