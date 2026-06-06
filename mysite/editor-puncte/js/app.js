/* =====================================================================
 * Editor Puncte GIS — aplicație browser, crossplatform
 *  - Hartă Leaflet (WGS84) cu basemap Google Hybrid (implicit) + OSM
 *  - Adăugare puncte cu atribute
 *  - Export Shapefile (WGS84) într-o arhivă .zip folosind GDAL (gdal3.js)
 * ===================================================================== */

(function () {
  "use strict";

  /* -------------------- Stare aplicație -------------------- */
  const features = [];      // GeoJSON Features colectate în sesiune
  let pendingMarker = null; // marker temporar (înainte de salvare)
  let pendingLatLng = null; // coordonatele punctului curent
  let GdalPromise = null;   // inițializarea GDAL (lazy)

  /* -------------------- Referințe DOM -------------------- */
  const $ = (sel) => document.querySelector(sel);
  const logEl = $("#log");
  const pointCountEl = $("#point-count");
  const finalizeBtn = $("#btn-finalize");
  const gdalStatus = $("#gdal-status");
  const overlay = $("#modal-overlay");
  const form = $("#attr-form");
  const modalCoords = $("#modal-coords");

  /* ===================================================================
   * 0. TEMĂ (white / dark) cu persistență
   * =================================================================== */
  const themeBtn = $("#btn-theme");

  function applyTheme(theme) {
    const dark = theme === "dark";
    document.body.classList.toggle("theme-dark", dark);
    document.body.classList.toggle("theme-white", !dark);
    themeBtn.textContent = dark ? "☀️ Light" : "🌙 Dark";
    themeBtn.setAttribute("aria-pressed", String(dark));
    try { localStorage.setItem("epg-theme", theme); } catch (e) {}
  }

  let savedTheme = "white";
  try { savedTheme = localStorage.getItem("epg-theme") || "white"; } catch (e) {}
  applyTheme(savedTheme);

  themeBtn.addEventListener("click", function () {
    const next = document.body.classList.contains("theme-dark") ? "white" : "dark";
    applyTheme(next);
  });

  /* ===================================================================
   * 1. HARTA
   * =================================================================== */
  const ROMANIA_CENTER = [45.9432, 24.9668]; // centrul aproximativ al României
  const map = L.map("map", {
    center: ROMANIA_CENTER,
    zoom: 7,
    zoomControl: true,
  });

  // Basemap Google Hybrid (satelit + etichete) — implicit
  const googleHybrid = L.tileLayer(
    "https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
    {
      subdomains: ["mt0", "mt1", "mt2", "mt3"],
      maxZoom: 21,
      attribution: "© Google",
    }
  );

  // Basemap OpenStreetMap
  const osm = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors",
    }
  );

  googleHybrid.addTo(map); // implicit

  // Buton toggle între basemap-uri
  L.control
    .layers(
      { "Google Hybrid": googleHybrid, "OpenStreetMap": osm },
      {},
      { position: "topright", collapsed: false }
    )
    .addTo(map);

  /* ---- Granița României: încărcare, desenare, validare punct ---- */
  let romaniaPolygons = []; // listă de poligoane [ [outerRing, hole1, ...], ... ]

  function collectPolygons(geom) {
    if (!geom) return;
    if (geom.type === "Polygon") romaniaPolygons.push(geom.coordinates);
    else if (geom.type === "MultiPolygon") geom.coordinates.forEach((p) => romaniaPolygons.push(p));
  }

  fetch("data/romania.geojson")
    .then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then((gj) => {
      const feats = gj.type === "FeatureCollection" ? gj.features
        : gj.type === "Feature" ? [gj] : [{ geometry: gj }];
      feats.forEach((f) => collectPolygons(f.geometry));

      const border = L.geoJSON(gj, {
        style: { color: "#1565c0", weight: 1.5, fill: false, interactive: false },
      }).addTo(map);

      // Centrare pe România la prima accesare
      map.fitBounds(border.getBounds(), { padding: [20, 20] });
      log("ok", "Granița României încărcată — se acceptă puncte doar în interior.");
    })
    .catch((err) => {
      log("err", "Nu s-a putut încărca granița României (" + err.message + "). Validarea este dezactivată.");
    });

  // Ray casting: punct în inel
  function pointInRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  function pointInRomania(lng, lat) {
    if (!romaniaPolygons.length) return true; // dacă granița lipsește, nu blocăm
    for (const poly of romaniaPolygons) {
      if (!pointInRing(lng, lat, poly[0])) continue; // în afara inelului exterior
      let inHole = false;
      for (let k = 1; k < poly.length; k++) {
        if (pointInRing(lng, lat, poly[k])) { inHole = true; break; }
      }
      if (!inHole) return true;
    }
    return false;
  }

  // Click pe hartă -> deschide formularul de atribute (doar în interiorul României)
  map.on("click", function (e) {
    if (!overlay.classList.contains("hidden")) return; // modal deja deschis
    if (!pointInRomania(e.latlng.lng, e.latlng.lat)) {
      log("err", "Punct ignorat: în afara teritoriului României.");
      flashOutside(e.latlng);
      return;
    }
    openModal(e.latlng);
  });

  // Feedback vizual scurt pentru click în afara graniței
  function flashOutside(latlng) {
    const c = L.circleMarker(latlng, {
      radius: 9, color: "#c62828", weight: 2, fillColor: "#c62828", fillOpacity: 0.3,
    }).addTo(map);
    setTimeout(() => map.removeLayer(c), 900);
  }

  /* ===================================================================
   * 2. MODAL ATRIBUTE
   * =================================================================== */
  function openModal(latlng) {
    pendingLatLng = latlng;

    // marker temporar
    pendingMarker = L.marker(latlng, { opacity: 0.7 }).addTo(map);
    pendingMarker._icon.classList.add("pending");

    modalCoords.textContent =
      "Lat: " + latlng.lat.toFixed(6) + "   Lng: " + latlng.lng.toFixed(6) + "  (WGS84)";

    form.reset();
    updateAllCounters();
    overlay.classList.remove("hidden");
    form.elements["Denumire"].focus();
  }

  function closeModal(keepMarker) {
    if (!keepMarker && pendingMarker) {
      map.removeLayer(pendingMarker);
    }
    pendingMarker = null;
    pendingLatLng = null;
    overlay.classList.add("hidden");
  }

  // Contoare caractere live
  function updateAllCounters() {
    document.querySelectorAll(".count").forEach((c) => {
      const input = form.elements[c.dataset.for];
      if (input) c.textContent = input.value.length + "/" + input.maxLength;
    });
  }
  form.addEventListener("input", updateAllCounters);

  // Anulare punct
  $("#btn-cancel").addEventListener("click", function () {
    closeModal(false);
  });

  // Salvare + pregătire pentru următorul punct
  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    if (!pendingLatLng) return;

    const data = new FormData(form);
    const props = {
      Denumire: (data.get("Denumire") || "").trim(),
      Judet: (data.get("Judet") || "").trim(),
      UAT: (data.get("UAT") || "").trim(),
      Strada: (data.get("Strada") || "").trim(),
      Numar: (data.get("Numar") || "").trim(),
    };

    if (!props.Denumire) {
      form.elements["Denumire"].focus();
      return;
    }

    // Feature GeoJSON (coordonate WGS84: [lng, lat])
    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [pendingLatLng.lng, pendingLatLng.lat],
      },
      properties: props,
    });

    // Markerul temporar devine definitiv
    pendingMarker._icon.classList.remove("pending");
    pendingMarker.setOpacity(1);
    pendingMarker.bindPopup(
      "<b>" + escapeHtml(props.Denumire) + "</b><br>" +
        [props.Strada, props.Numar].filter(Boolean).join(" ") + "<br>" +
        [props.UAT, props.Judet].filter(Boolean).join(", ")
    );

    log(
      "point",
      "Punct #" + features.length + ": " + props.Denumire +
        "  (" + pendingLatLng.lat.toFixed(5) + ", " + pendingLatLng.lng.toFixed(5) + ")"
    );

    pointCountEl.textContent = String(features.length);
    finalizeBtn.disabled = false;

    closeModal(true); // păstrăm markerul; așteptăm următorul click
  });

  // ESC închide modalul (anulează)
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !overlay.classList.contains("hidden")) {
      closeModal(false);
    }
  });

  /* ===================================================================
   * 3. LOG CONSOLĂ
   * =================================================================== */
  function log(kind, msg) {
    const div = document.createElement("div");
    div.className = "log-entry " + kind;
    const ts = new Date().toLocaleTimeString();
    div.innerHTML = '<span class="ts">[' + ts + "]</span> " + escapeHtml(msg);
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  /* ===================================================================
   * 4. INIȚIALIZARE GDAL (gdal3.js, prin WebAssembly)
   * =================================================================== */
  // Loader-ul GDAL (gdal3.js) este găzduit local pentru a respecta CSP-ul
  // serverului (script-src 'self'). Fișierele binare .wasm / .data sunt mari
  // (~39 MB) și rămân pe CDN — sunt aduse prin fetch (fără restricție connect-src);
  // dacă nu sunt accesibile, exportul folosește automat scriitorul SHP intern.
  const GDAL_JS_BASE = "lib";   // gdal3.js (loader + sursa worker-ului, same-origin)
  const GDAL_BIN_BASE = "https://cdn.jsdelivr.net/npm/gdal3.js@2.8.1/dist/package"; // .wasm / .data

  function initGdal() {
    if (GdalPromise) return GdalPromise;
    if (typeof initGdalJs !== "function") {
      return Promise.reject(new Error("Biblioteca GDAL (gdal3.js) nu este disponibilă."));
    }
    // Browserele blochează `new Worker(<URL cross-origin>)`. De aceea aducem
    // scriptul GDAL local ca text și îl rulăm dintr-un Blob (same-origin).
    GdalPromise = fetch(GDAL_JS_BASE + "/gdal3.js")
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status + " la descărcarea gdal3.js");
        return r.text();
      })
      .then((code) => {
        const jsBlobUrl = URL.createObjectURL(
          new Blob([code], { type: "application/javascript" })
        );
        return initGdalJs({
          paths: {
            wasm: GDAL_BIN_BASE + "/gdal3WebAssembly.wasm",
            data: GDAL_BIN_BASE + "/gdal3WebAssembly.data",
            js: jsBlobUrl,
          },
        });
      });
    return GdalPromise;
  }

  // Pre-încărcăm GDAL în fundal și actualizăm starea
  initGdal()
    .then(() => {
      gdalStatus.textContent = "GDAL: pregătit";
      gdalStatus.className = "badge badge-ready";
      log("ok", "GDAL încărcat — export Shapefile disponibil.");
    })
    .catch((err) => {
      gdalStatus.textContent = "GDAL: indisponibil (fallback)";
      gdalStatus.className = "badge badge-error";
      log("err", "GDAL nu a putut fi încărcat. Se folosește scriitorul SHP intern. (" + err.message + ")");
    });

  /* ===================================================================
   * 5. FINALIZARE — export Shapefile (WGS84) într-o arhivă .zip
   * =================================================================== */
  finalizeBtn.addEventListener("click", async function () {
    if (features.length === 0) return;

    finalizeBtn.disabled = true;
    const original = finalizeBtn.textContent;
    finalizeBtn.textContent = "Se generează…";

    const geojson = { type: "FeatureCollection", features };

    try {
      let zipBlob;
      try {
        const Gdal = await initGdal();
        zipBlob = await exportWithGdal(Gdal, geojson);
        log("ok", "Shapefile generat cu GDAL.");
      } catch (gdalErr) {
        log("err", "GDAL indisponibil — folosesc scriitorul SHP intern. (" + gdalErr.message + ")");
        zipBlob = await exportWithFallback(geojson);
      }

      const name = "puncte_wgs84_" + timestamp() + ".zip";
      saveAs(zipBlob, name);
      log("ok", "Arhivă descărcată: " + name + " (" + features.length + " puncte).");
    } catch (err) {
      log("err", "Eroare la export: " + err.message);
      console.error(err);
    } finally {
      finalizeBtn.textContent = original;
      finalizeBtn.disabled = features.length === 0;
    }
  });

  /* ---------- 5a. Export prin GDAL (ogr2ogr GeoJSON -> ESRI Shapefile) ---------- */
  async function exportWithGdal(Gdal, geojson) {
    const inputFile = new File(
      [JSON.stringify(geojson)],
      "puncte.geojson",
      { type: "application/geo+json" }
    );

    const opened = await Gdal.open(inputFile);
    const dataset = opened.datasets[0];

    const options = [
      "-f", "ESRI Shapefile",
      "-t_srs", "EPSG:4326",
      "-nln", "puncte",
      "-lco", "ENCODING=UTF-8",
    ];

    await Gdal.ogr2ogr(dataset, options);

    const outFiles = await Gdal.getOutputFiles();
    if (!outFiles || !outFiles.length) {
      throw new Error("GDAL nu a produs fișiere de ieșire.");
    }

    const zip = new JSZip();
    for (const f of outFiles) {
      const bytes = await Gdal.getFileBytes(f.path);
      const fname = f.path.split("/").pop();
      zip.file(fname, bytes);
    }
    return zip.generateAsync({ type: "blob" });
  }

  /* ---------- 5b. Export fallback (scriitor SHP intern, doar puncte) ---------- */
  async function exportWithFallback(geojson) {
    const fields = [
      { name: "Denumire", len: 50 },
      { name: "Judet", len: 20 },
      { name: "UAT", len: 30 },
      { name: "Strada", len: 50 },
      { name: "Numar", len: 5 },
    ];
    const pts = geojson.features.map((f) => ({
      x: f.geometry.coordinates[0],
      y: f.geometry.coordinates[1],
      props: f.properties,
    }));

    const shp = buildShp(pts);
    const shx = buildShx(pts);
    const dbf = buildDbf(pts, fields);
    const prj = WGS84_WKT;

    const zip = new JSZip();
    zip.file("puncte.shp", shp);
    zip.file("puncte.shx", shx);
    zip.file("puncte.dbf", dbf);
    zip.file("puncte.prj", prj);
    zip.file("puncte.cpg", "UTF-8");
    return zip.generateAsync({ type: "blob" });
  }

  const WGS84_WKT =
    'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",' +
    '6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],' +
    'UNIT["Degree",0.0174532925199433]]';

  function bbox(pts) {
    let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
    for (const p of pts) {
      if (p.x < xmin) xmin = p.x;
      if (p.y < ymin) ymin = p.y;
      if (p.x > xmax) xmax = p.x;
      if (p.y > ymax) ymax = p.y;
    }
    if (!pts.length) { xmin = ymin = xmax = ymax = 0; }
    return { xmin, ymin, xmax, ymax };
  }

  // SHP: header 100 octeți + câte 28 octeți/punct (8 antet rec + 20 conținut)
  function buildShp(pts) {
    const recLen = 28;
    const buf = new ArrayBuffer(100 + pts.length * recLen);
    const dv = new DataView(buf);
    const b = bbox(pts);

    dv.setInt32(0, 9994, false);                       // file code
    dv.setInt32(24, buf.byteLength / 2, false);        // file length (words)
    dv.setInt32(28, 1000, true);                       // version
    dv.setInt32(32, 1, true);                          // shape type = Point
    dv.setFloat64(36, b.xmin, true);
    dv.setFloat64(44, b.ymin, true);
    dv.setFloat64(52, b.xmax, true);
    dv.setFloat64(60, b.ymax, true);
    // Zmin/Zmax/Mmin/Mmax rămân 0

    let off = 100;
    pts.forEach((p, i) => {
      dv.setInt32(off, i + 1, false);                  // record number (1-based)
      dv.setInt32(off + 4, 10, false);                 // content length (words)
      dv.setInt32(off + 8, 1, true);                   // shape type = Point
      dv.setFloat64(off + 12, p.x, true);
      dv.setFloat64(off + 20, p.y, true);
      off += recLen;
    });
    return buf;
  }

  // SHX: header 100 octeți + câte 8 octeți/punct
  function buildShx(pts) {
    const buf = new ArrayBuffer(100 + pts.length * 8);
    const dv = new DataView(buf);
    const b = bbox(pts);

    dv.setInt32(0, 9994, false);
    dv.setInt32(24, buf.byteLength / 2, false);
    dv.setInt32(28, 1000, true);
    dv.setInt32(32, 1, true);
    dv.setFloat64(36, b.xmin, true);
    dv.setFloat64(44, b.ymin, true);
    dv.setFloat64(52, b.xmax, true);
    dv.setFloat64(60, b.ymax, true);

    let off = 100;
    let recOffset = 50; // în words (100 octeți / 2)
    pts.forEach(() => {
      dv.setInt32(off, recOffset, false);              // offset (words)
      dv.setInt32(off + 4, 10, false);                 // content length (words)
      recOffset += 14;                                 // 4 (antet) + 10 (conținut)
      off += 8;
    });
    return buf;
  }

  // DBF: dBASE III, toate câmpurile de tip Character, codare UTF-8
  function buildDbf(pts, fields) {
    const enc = new TextEncoder();
    const headerLen = 32 + fields.length * 32 + 1;
    const recordLen = 1 + fields.reduce((s, f) => s + f.len, 0);
    const total = headerLen + pts.length * recordLen + 1;

    const buf = new ArrayBuffer(total);
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);

    const now = new Date();
    dv.setUint8(0, 0x03);
    dv.setUint8(1, now.getFullYear() - 1900);
    dv.setUint8(2, now.getMonth() + 1);
    dv.setUint8(3, now.getDate());
    dv.setUint32(4, pts.length, true);
    dv.setUint16(8, headerLen, true);
    dv.setUint16(10, recordLen, true);

    // Descriptori câmpuri
    let fo = 32;
    fields.forEach((f) => {
      const nameBytes = enc.encode(f.name).slice(0, 10);
      u8.set(nameBytes, fo);                            // nume (null-padded)
      dv.setUint8(fo + 11, "C".charCodeAt(0));          // tip = Character
      dv.setUint8(fo + 16, f.len);                      // lungime câmp
      dv.setUint8(fo + 17, 0);                          // zecimale
      fo += 32;
    });
    dv.setUint8(headerLen - 1, 0x0d);                   // terminator antet

    // Înregistrări
    let off = headerLen;
    pts.forEach((p) => {
      u8[off++] = 0x20; // flag (nu este șters)
      fields.forEach((f) => {
        const val = (p.props[f.name] || "");
        let bytes = enc.encode(val);
        if (bytes.length > f.len) bytes = bytes.slice(0, f.len); // trunchiere
        u8.set(bytes, off);
        for (let k = bytes.length; k < f.len; k++) u8[off + k] = 0x20; // pad spațiu
        off += f.len;
      });
    });
    u8[off] = 0x1a; // EOF
    return buf;
  }

  /* -------------------- utilitar -------------------- */
  function timestamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return (
      d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
      "_" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
    );
  }
})();
