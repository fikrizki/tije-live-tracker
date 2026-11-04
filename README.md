# TIJE Live · Transjakarta Route Planner & Bus Tracker

Aplikasi web peta rute dan pelacak posisi bus **Transjakarta (TIJE)** berbasis dataset **GTFS resmi PT Transjakarta** (`https://gtfs.transjakarta.co.id/files/file_gtfs.zip`, CC BY 4.0). Posisi bus adalah **estimasi dari jadwal GTFS** (frekuensi, waktu antar-halte, geometri jalan), bukan GPS bus.

Dua mode, berpindah lewat tab di panel:

## 1. Semua Rute (`#rute`)

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

## 2. Rasuna Said ke Jakarta Barat (`#perjalanan`)

4 perjalanan dari Halte H.R. Rasuna Said, dengan rencana "berangkat sekarang", waktu tunggu, transit, dan timeline halte:

1. **Grogol Reformasi** via Tol Dalam Kota (Koridor 6 + JPO Kuningan + Koridor 9)
2. **Rawa Buaya** via Balai Kota (6A + 2A)
3. **Kalideres** via Thamrin & Monas (6A + 1 + 3)
4. **Kebon Jeruk** via Tol Layang Express (L13E + 8)

## Struktur Direktori

```
tije-live-tracker/
├── web/
│   ├── index.html        # Aplikasi (Leaflet + panel)
│   ├── app.js            # Mode perjalanan, peta, tab & routing hash
│   ├── routes.js         # Mode Semua Rute (katalog, pencarian, detail, bus)
│   ├── engine.js         # Posisi bus, ETA, status operasi rute (WIB)
│   ├── data.js           # Dataset 4 perjalanan Rasuna Said
│   ├── routes-index.js   # Katalog 241 rute + halte + garis jaringan (~1 MB, ~250 KB gzip)
│   ├── routes/<id>.js    # Detail per rute, dimuat saat rute dibuka (241 file)
│   ├── styles.css        # Desktop + bottom sheet mobile
│   └── config.js         # Endpoint GPS live opsional
└── scripts/
    ├── gtfs_lib.py       # Pembaca GTFS & pembentuk pola trip (dipakai kedua builder)
    ├── build_data.py     # GTFS -> web/data.js
    ├── build_routes.py   # GTFS -> web/routes-index.js + web/routes/*.js
    ├── route_planner.py  # Pencari rute (RAPTOR-lite)
    ├── test_engine.js    # Uji engine (4 perjalanan)
    └── test_routes.js    # Uji 241 file rute terhadap katalog & engine
```

## Memperbarui Data GTFS

```bash
mkdir -p data/gtfs
curl -L -o data/gtfs.zip https://gtfs.transjakarta.co.id/files/file_gtfs.zip
unzip -o data/gtfs.zip -d data/gtfs
python3 scripts/build_data.py
python3 scripts/build_routes.py
node scripts/test_routes.js && node scripts/test_engine.js
```

## Menjalankan Secara Lokal

```bash
cd web
python3 -m http.server 8787
```

Buka `http://127.0.0.1:8787/`. Fitur "Halte terdekat" butuh HTTPS atau localhost (syarat geolokasi browser).
