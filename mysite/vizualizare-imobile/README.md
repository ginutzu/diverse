# Vizualizare Imobile

Hartă web pentru vizualizarea imobilelor (parcele) și clădirilor din baza ANCPI,
nativ în sistemul de proiecție **Stereo70 (EPSG:3844)**.

## Funcții
- Tile-uri vectoriale `.pbf` ANCPI (`imobile_cladiri`) randate nativ în EPSG:3844 (Leaflet + Proj4Leaflet + VectorGrid).
- Fundaluri globale (Satelit Esri, OSM, OpenTopoMap, CARTO) **reproiectate client-side** în Stereo70.
- Căutare imobil după `INSPIRE_ID`, prefix județ-UAT sau număr cadastral; identificare prin click pe hartă (`eterra3_publish`).
- Poziție GPS a dispozitivului, transformată **WGS84 → EPSG:3844 cu GDAL** (gdal3.js, cu proj4 ca rezervă).
- Export imobile vizibile în **GeoJSON / SHP** (Stereo70, prin GDAL).
- Citire live coordonate Stereo70 (X·Nord / Y·Est), WGS84 și scară 1:N.
- PWA: instalabilă pe mobil/desktop, cu shell offline.

## Rulare locală
Aplicația folosește GDAL-WASM și geolocație, deci trebuie servită prin **http(s)**, nu `file://`:

```bash
# Python
python -m http.server 8080
# sau Node
npx serve .
```
Apoi deschide http://localhost:8080

## Publicare pe GitHub Pages
1. Pune fișierele acestui folder în rădăcina unui repository.
2. Settings → Pages → Source: `Deploy from a branch` → `main` / `/ (root)`.
3. Site-ul va fi la `https://<user>.github.io/<repo>/`.
Fișierul `.nojekyll` asigură servirea ca atare.

## Surse & drepturi
Date: **ANCPI** (geoportal.ancpi.ro). Datele cadastrale sunt proprietatea ANCPI și
se supun termenilor ANCPI; o parte se comercializează prin epay/myEterra — folosiți responsabil, cu atribuire.
Fundalurile: © OpenStreetMap, © Esri/Maxar, © OpenTopoMap, © CARTO.

## Securitate
Nu comiteți niciodată token-uri/parole în acest repository. Folosiți secrete GitHub
sau autentificare locală. Codul nu conține și nu trebuie să conțină credențiale.

## Cod
Cod sub licență MIT (vezi `LICENSE`). Datele ANCPI nu sunt acoperite de această licență.
