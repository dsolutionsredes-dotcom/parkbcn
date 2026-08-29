"use client";

import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  Popup,
  TileLayer,
  useMap,
  useMapEvents
} from "react-leaflet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const FALLBACK_CENTER = [41.3874, 2.1686];

function boundsToBbox(bounds) {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  return [sw.lng, sw.lat, ne.lng, ne.lat].join(",");
}

function parseNumber(value) {
  if (value === null || value === undefined) return 0;
  const cleaned = String(value).replace(",", ".").match(/\d+(\.\d+)?/);
  return cleaned ? Number(cleaned[0]) : 0;
}

function maxMinutes(properties = {}) {
  const mins = parseNumber(properties.TEMPS_MAX_MINUTS);
  const hours = parseNumber(properties.TEMPS_MAX_HORES);
  if (mins > 0) return Math.round(mins);
  if (hours > 0) return Math.round(hours * 60);
  return 0;
}

function haversineMeters(aLat, aLng, bLat, bLng) {
  const R = 6371000;
  const rad = (n) => (n * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function walkCoordinates(coords, callback) {
  if (!Array.isArray(coords)) return;
  if (
    coords.length >= 2 &&
    typeof coords[0] === "number" &&
    typeof coords[1] === "number"
  ) {
    callback(coords[1], coords[0]);
    return;
  }
  coords.forEach((c) => walkCoordinates(c, callback));
}

function nearestFeature(features, lat, lng) {
  let best = null;
  let bestDistance = Infinity;

  for (const feature of features || []) {
    walkCoordinates(feature.geometry?.coordinates, (fLat, fLng) => {
      const d = haversineMeters(lat, lng, fLat, fLng);
      if (d < bestDistance) {
        bestDistance = d;
        best = feature;
      }
    });
  }

  return { feature: best, distance: bestDistance };
}

function colorFor(feature) {
  const t = (feature?.properties?.TRAM_TIPUS || "").toLowerCase();
  if (t.includes("verda") || t.includes("verde")) return "#1f9d55";
  if (t.includes("blava") || t.includes("azul")) return "#1677ff";
  return "#7b8494";
}

function MapController({ onViewport, onMapReady }) {
  const map = useMap();

  useEffect(() => {
    onMapReady(map);
    onViewport(boundsToBbox(map.getBounds()));
  }, [map, onMapReady, onViewport]);

  useMapEvents({
    moveend() {
      onViewport(boundsToBbox(map.getBounds()));
    },
    zoomend() {
      onViewport(boundsToBbox(map.getBounds()));
    }
  });

  return null;
}

export default function ParkingMap() {
  const [mapRef, setMapRef] = useState(null);
  const [zones, setZones] = useState({ type: "FeatureCollection", features: [] });
  const [location, setLocation] = useState(null);
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState("Ubicando…");
  const [loadingZones, setLoadingZones] = useState(false);
  const [voiceText, setVoiceText] = useState("");
  const [savedFree, setSavedFree] = useState([]);
  const [parked, setParked] = useState(null);
  const [now, setNow] = useState(Date.now());
  const recognitionRef = useRef(null);
  const lastBboxRef = useRef("");

  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem("parkbcn-free") || "[]");
    const p = JSON.parse(localStorage.getItem("parkbcn-active") || "null");
    setSavedFree(saved);
    setParked(p);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchZones = useCallback(async (bbox) => {
    if (!bbox || bbox === lastBboxRef.current) return;
    lastBboxRef.current = bbox;
    setLoadingZones(true);
    try {
      const response = await fetch(`/api/parking?bbox=${encodeURIComponent(bbox)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Error");
      setZones(data);
    } catch {
      setStatus("No se pudieron cargar las zonas AMB");
    } finally {
      setLoadingZones(false);
    }
  }, []);

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setStatus("Este navegador no ofrece geolocalización.");
      return;
    }

    setStatus("Buscando tu ubicación…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        };
        setLocation(next);
        setStatus(`GPS ±${Math.round(pos.coords.accuracy)} m`);
        if (mapRef) mapRef.flyTo([next.lat, next.lng], 17, { duration: 0.8 });
      },
      () => setStatus("Activa el permiso de ubicación."),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 }
    );
  }, [mapRef]);

  useEffect(() => {
    if (mapRef) locate();
  }, [mapRef, locate]);

  const currentNearest = useMemo(() => {
    if (!location) return null;
    return nearestFeature(zones.features, location.lat, location.lng);
  }, [zones, location]);

  const activeZone =
    selected ||
    (currentNearest && currentNearest.distance <= 55
      ? currentNearest.feature
      : null);

  const saveFreeHere = useCallback(() => {
    if (!location) {
      locate();
      return;
    }
    const point = {
      id: Date.now(),
      lat: location.lat,
      lng: location.lng,
      createdAt: new Date().toISOString(),
      label: "Parking libre observado"
    };
    const next = [...savedFree, point];
    setSavedFree(next);
    localStorage.setItem("parkbcn-free", JSON.stringify(next));
    setVoiceText("Parking libre guardado en tu mapa.");
  }, [location, locate, savedFree]);

  const startParking = useCallback(() => {
    if (!location) {
      locate();
      return;
    }

    const p = activeZone?.properties || {};
    const minutes = maxMinutes(p);
    const active = {
      startedAt: Date.now(),
      lat: location.lat,
      lng: location.lng,
      zone: activeZone
        ? {
            city: p.CIUTAT || "",
            type: p.TRAM_TIPUS || "",
            street: p.TRAM || "",
            schedule: p.HORARI || "",
            tariff: p.TARIFA || "",
            price: p.PREU_FRACCIO || "",
            maxMinutes: minutes
          }
        : null,
      endsAt: minutes ? Date.now() + minutes * 60 * 1000 : null
    };

    setParked(active);
    localStorage.setItem("parkbcn-active", JSON.stringify(active));
    setVoiceText(
      activeZone
        ? "Aparcamiento registrado. Comprueba la señal física antes de dejar el coche."
        : "Ubicación guardada. No detecto una zona regulada AMB a menos de 55 metros."
    );

    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, [location, activeZone, locate]);

  const clearParking = useCallback(() => {
    setParked(null);
    localStorage.removeItem("parkbcn-active");
  }, []);

  useEffect(() => {
    if (!parked?.endsAt) return;
    const warningAt = parked.endsAt - 15 * 60 * 1000;
    if (now >= warningAt && now < parked.endsAt && !parked.warned) {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("ParkBCN", {
          body: "Quedan menos de 15 minutos según el tiempo máximo registrado."
        });
      }
      const next = { ...parked, warned: true };
      setParked(next);
      localStorage.setItem("parkbcn-active", JSON.stringify(next));
    }
  }, [now, parked]);

  const listen = useCallback(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceText("Tu navegador no admite reconocimiento de voz web.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "es-ES";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognitionRef.current = recognition;

    recognition.onstart = () => setVoiceText("Escuchando…");
    recognition.onerror = () => setVoiceText("No pude entender el comando.");
    recognition.onresult = (event) => {
      const text = event.results[0][0].transcript.toLowerCase();
      setVoiceText(`“${text}”`);

      if (
        text.includes("he aparcado") ||
        text.includes("estacioné") ||
        text.includes("estacione") ||
        text.includes("aparqué") ||
        text.includes("aparque")
      ) {
        startParking();
      } else if (
        text.includes("parking libre") ||
        text.includes("aparcamiento libre") ||
        text.includes("zona blanca")
      ) {
        saveFreeHere();
      } else if (
        text.includes("mi ubicación") ||
        text.includes("mi ubicacion") ||
        text.includes("dónde estoy") ||
        text.includes("donde estoy")
      ) {
        locate();
      } else {
        setVoiceText(`Comando no reconocido: “${text}”`);
      }
    };

    recognition.start();
  }, [locate, saveFreeHere, startParking]);

  const remaining = parked?.endsAt
    ? Math.max(0, parked.endsAt - now)
    : null;

  const remainingText =
    remaining === null
      ? ""
      : `${String(Math.floor(remaining / 3600000)).padStart(2, "0")}:${String(
          Math.floor((remaining % 3600000) / 60000)
        ).padStart(2, "0")}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0")}`;

  const p = activeZone?.properties || {};
  const distance =
    currentNearest?.feature === activeZone ? Math.round(currentNearest.distance) : null;

  return (
    <main className="appShell">
      <MapContainer
        center={FALLBACK_CENTER}
        zoom={13}
        zoomControl={false}
        className="map"
      >
        <MapController onViewport={fetchZones} onMapReady={setMapRef} />

        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <GeoJSON
          key={JSON.stringify(zones.features.map((f) => f.properties?.OBJECTID))}
          data={zones}
          style={(feature) => ({
            color: colorFor(feature),
            weight: 7,
            opacity: 0.88
          })}
          onEachFeature={(feature, layer) => {
            layer.on("click", () => setSelected(feature));
          }}
        />

        {location && (
          <CircleMarker
            center={[location.lat, location.lng]}
            radius={8}
            pathOptions={{
              color: "#ffffff",
              fillColor: "#0b1320",
              fillOpacity: 1,
              weight: 3
            }}
          >
            <Popup>Tu ubicación</Popup>
          </CircleMarker>
        )}

        {savedFree.map((point) => (
          <CircleMarker
            key={point.id}
            center={[point.lat, point.lng]}
            radius={6}
            pathOptions={{
              color: "#263238",
              fillColor: "#ffffff",
              fillOpacity: 1,
              weight: 3
            }}
          >
            <Popup>{point.label}</Popup>
          </CircleMarker>
        ))}
      </MapContainer>

      <header className="topBar">
        <div>
          <div className="brand">ParkBCN <span>V1</span></div>
          <div className="status">
            {loadingZones ? "Actualizando zonas…" : status}
          </div>
        </div>
        <button className="roundButton" onClick={locate} aria-label="Mi ubicación">
          ◎
        </button>
      </header>

      <div className="legend">
        <span><i className="dot green" /> Verde</span>
        <span><i className="dot blue" /> Azul</span>
        <span><i className="dot white" /> Libre guardado</span>
      </div>

      <section className="bottomSheet">
        {parked && (
          <div className="activeParking">
            <div>
              <small>APARCAMIENTO ACTIVO</small>
              <strong>{remaining !== null ? remainingText : "Ubicación guardada"}</strong>
            </div>
            <button onClick={clearParking}>Finalizar</button>
          </div>
        )}

        <div className="zoneCard">
          {activeZone ? (
            <>
              <div className="zoneHeader">
                <span
                  className="zoneBadge"
                  style={{ background: colorFor(activeZone) }}
                >
                  {p.TRAM_TIPUS || "Zona regulada"}
                </span>
                {distance !== null && <span className="distance">≈ {distance} m</span>}
              </div>
              <h2>{p.TRAM || "Tramo de estacionamiento"}</h2>
              <p className="city">{p.CIUTAT || "Área metropolitana de Barcelona"}</p>

              <div className="facts">
                <div><small>Horario</small><b>{p.HORARI || "Consultar señal"}</b></div>
                <div><small>Máximo</small><b>{maxMinutes(p) ? `${maxMinutes(p)} min` : "Consultar"}</b></div>
                <div><small>Tarifa</small><b>{p.TARIFA || p.PREU_FRACCIO || "Consultar"}</b></div>
              </div>
            </>
          ) : (
            <>
              <div className="zoneHeader">
                <span className="zoneBadge neutral">SIN ZONA AMB DETECTADA</span>
              </div>
              <h2>Comprueba la señalización</h2>
              <p className="city">
                Puede ser aparcamiento libre, residentes, DUM u otra regulación no incluida en esta capa.
              </p>
            </>
          )}
        </div>

        {voiceText && <div className="voiceText">{voiceText}</div>}

        <div className="actions">
          <button className="primaryAction" onClick={startParking}>
            🚗 He aparcado aquí
          </button>
          <button className="micAction" onClick={listen} aria-label="Comando de voz">
            🎤
          </button>
        </div>

        <button className="freeAction" onClick={saveFreeHere}>
          + Marcar parking libre aquí
        </button>

        <p className="legalNote">
          V1 orientativa. Los datos AMB ayudan a identificar zonas reguladas; la señalización física prevalece.
        </p>
      </section>
    </main>
  );
}
