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
const DEFAULT_PROFILE = {
  residentAuthorized: false,
  residentMunicipality: "",
  residentArea: "",
  plate: ""
};

const MUNICIPALITIES = [
  "L'Hospitalet de Llobregat",
  "Barcelona",
  "Badalona",
  "Esplugues de Llobregat",
  "Santa Coloma de Gramenet",
  "El Prat de Llobregat",
  "Sant Joan Despí",
  "Sant Just Desvern",
  "Sant Boi de Llobregat",
  "Castelldefels",
  "Montgat"
];

function normalize(value = "") {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .trim();
}

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

function zoneKind(feature) {
  const t = normalize(feature?.properties?.TRAM_TIPUS || "");
  if (t.includes("verda") || t.includes("verde")) return "green";
  if (t.includes("blava") || t.includes("azul")) return "blue";
  if (t.includes("taronja") || t.includes("naranja")) return "orange";
  if (t.includes("vermella") || t.includes("roja")) return "red";
  return "other";
}

function colorFor(feature) {
  const kind = zoneKind(feature);
  if (kind === "green") return "#1f9d55";
  if (kind === "blue") return "#1677ff";
  if (kind === "orange") return "#ef8b17";
  if (kind === "red") return "#d92d20";
  return "#7b8494";
}

function municipalityMatches(profileMunicipality, city) {
  if (!profileMunicipality || !city) return false;
  const a = normalize(profileMunicipality);
  const b = normalize(city);
  if (a.includes("hospitalet") && b.includes("hospitalet")) return true;
  return a === b || a.includes(b) || b.includes(a);
}

function activeTemporaryRule(official, feature) {
  if (!official?.temporaryRules?.length || !feature) return null;
  const type = normalize(feature.properties?.TRAM_TIPUS || "");

  return (
    official.temporaryRules.find((rule) => {
      if (!rule.active) return false;
      const applies = (rule.appliesTo || []).some((item) =>
        type.includes(normalize(item).replace("zona ", "")) ||
        type.includes(normalize(item))
      );
      const excluded = (rule.excludes || []).some((item) =>
        type.includes(normalize(item))
      );
      return applies && !excluded;
    }) || null
  );
}

function getDecision(feature, official, profile, confirmedResidentTrams = []) {
  if (!feature) {
    return {
      tone: "unknown",
      icon: "?",
      title: "Zona no identificada",
      detail: "Puede ser libre, DUM, residentes u otra regulación. Revisa la señal del tramo.",
      noTimer: true
    };
  }

  const p = feature.properties || {};
  const type = normalize(p.TRAM_TIPUS || "");
  const temporary = activeTemporaryRule(official, feature);
  const residentType = type.includes("resident") || type.includes("acreditat");
  const profileCityMatch = municipalityMatches(profile.residentMunicipality, p.CIUTAT);
  const residentRule = official?.residentRules?.find((rule) => rule.freeAssignedGreen);
  const tramId = String(p.TRAM_ID || p.OBJECTID || "");
  const confirmedResidentTram = tramId && confirmedResidentTrams.includes(tramId);

  if (temporary) {
    return {
      tone: "good",
      icon: "✓",
      title: "Gratis ahora",
      detail: temporary.summary,
      noTimer: true,
      sourceId: temporary.sourceId
    };
  }

  if (
    zoneKind(feature) === "green" &&
    profile.residentAuthorized &&
    profileCityMatch &&
    residentRule
  ) {
    if (confirmedResidentTram) {
      return {
        tone: "good",
        icon: "✓",
        title: "Gratis como residente",
        detail: residentRule.requiresTicket
          ? "Este tramo lo confirmaste como parte de tu zona asignada. La bonificación es del 100 %, pero debes obtener/activar el tique de residente cuando corresponda."
          : "Este tramo lo confirmaste como parte de tu zona asignada y la fuente oficial publica bonificación del 100 %.",
        noTimer: true,
        sourceId: residentRule.sourceId
      };
    }

    return {
      tone: "warning",
      icon: "i",
      title: "Puede ser gratis para ti",
      detail: profile.residentArea
        ? `En L’Hospitalet la zona verde de tu barrio asignado tiene bonificación del 100 %. Confirma en ⓘ si este tramo pertenece a ${profile.residentArea}.`
        : "En L’Hospitalet la zona verde asignada al residente tiene bonificación del 100 %. Indica tu zona en el perfil y confirma este tramo en ⓘ.",
      noTimer: false,
      sourceId: residentRule.sourceId
    };
  }

  if (residentType && !profile.residentAuthorized) {
    return {
      tone: "danger",
      icon: "!",
      title: "Zona de residentes",
      detail: "No asumas que puedes aparcar aquí sin autorización. Comprueba la señal y tu permiso.",
      noTimer: true
    };
  }

  if (residentType && profile.residentAuthorized && profileCityMatch) {
    return {
      tone: "warning",
      icon: "i",
      title: "Tu perfil residente coincide",
      detail: profile.residentArea
        ? `Confirma que este tramo pertenece a tu zona autorizada (${profile.residentArea}).`
        : "Confirma que este tramo pertenece exactamente a tu zona de residente autorizada.",
      noTimer: true
    };
  }

  const kind = zoneKind(feature);
  if (kind === "green" || kind === "blue") {
    const minutes = maxMinutes(p);
    return {
      tone: "info",
      icon: "P",
      title: kind === "green" ? "Zona verde regulada" : "Zona azul regulada",
      detail: minutes
        ? `Puedes usarla si cumples la regulación del tramo. Máximo publicado por AMB: ${minutes} min.`
        : "Puedes usarla si cumples la regulación del tramo. Consulta horario, tarifa y señal.",
      noTimer: !minutes
    };
  }

  if (kind === "red") {
    return {
      tone: "danger",
      icon: "!",
      title: "Zona con regulación especial",
      detail: "No la trates como aparcamiento normal hasta comprobar la señalización.",
      noTimer: true
    };
  }

  return {
    tone: "warning",
    icon: "i",
    title: "Regulación especial",
    detail: "Comprueba la señal del tramo antes de aparcar.",
    noTimer: true
  };
}

function formatCheckedAt(value) {
  if (!value) return "Sin comprobar";
  try {
    return new Intl.DateTimeFormat("es-ES", {
      dateStyle: "short",
      timeStyle: "short"
    }).format(new Date(value));
  } catch {
    return value;
  }
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
  const [official, setOfficial] = useState(null);
  const [officialLoading, setOfficialLoading] = useState(false);
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [confirmedResidentTrams, setConfirmedResidentTrams] = useState([]);
  const [profileOpen, setProfileOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [driveMode, setDriveMode] = useState(false);
  const [wakeActive, setWakeActive] = useState(false);
  const recognitionRef = useRef(null);
  const lastBboxRef = useRef("");
  const watchIdRef = useRef(null);
  const wakeLockRef = useRef(null);

  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem("parkbcn-free") || "[]");
    const p = JSON.parse(localStorage.getItem("parkbcn-active") || "null");
    const userProfile = JSON.parse(localStorage.getItem("parkbcn-profile") || "null");
    const confirmedTrams = JSON.parse(localStorage.getItem("parkbcn-resident-trams") || "[]");
    setSavedFree(saved);
    setParked(p);
    setConfirmedResidentTrams(Array.isArray(confirmedTrams) ? confirmedTrams : []);
    if (userProfile) setProfile({ ...DEFAULT_PROFILE, ...userProfile });

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

  const applyLocation = useCallback(
    (pos, follow = false) => {
      const next = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy
      };
      setLocation(next);
      setStatus(`GPS ±${Math.round(pos.coords.accuracy)} m`);
      if (mapRef && follow) {
        mapRef.setView([next.lat, next.lng], Math.max(mapRef.getZoom(), 16), {
          animate: true
        });
      }
    },
    [mapRef]
  );

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setStatus("Este navegador no ofrece geolocalización.");
      return;
    }

    setStatus("Buscando tu ubicación…");
    navigator.geolocation.getCurrentPosition(
      (pos) => applyLocation(pos, true),
      () => setStatus("Activa el permiso de ubicación."),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 }
    );
  }, [applyLocation]);

  useEffect(() => {
    if (mapRef) locate();
  }, [mapRef, locate]);

  const requestWakeLock = useCallback(async () => {
    if (!("wakeLock" in navigator) || document.visibilityState !== "visible") {
      setWakeActive(false);
      return;
    }
    try {
      wakeLockRef.current = await navigator.wakeLock.request("screen");
      setWakeActive(true);
      wakeLockRef.current.addEventListener("release", () => setWakeActive(false));
    } catch {
      setWakeActive(false);
    }
  }, []);

  useEffect(() => {
    if (!driveMode) {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
      setWakeActive(false);
      return;
    }

    requestWakeLock();
    if (navigator.geolocation && watchIdRef.current === null) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => applyLocation(pos, true),
        () => setStatus("No puedo seguir tu GPS. Revisa permisos."),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 2500 }
      );
    }

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && driveMode) requestWakeLock();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [driveMode, requestWakeLock, applyLocation]);

  const currentNearest = useMemo(() => {
    if (!location) return null;
    return nearestFeature(zones.features, location.lat, location.lng);
  }, [zones, location]);

  const activeZone =
    selected ||
    (currentNearest && currentNearest.distance <= 55
      ? currentNearest.feature
      : null);

  const p = activeZone?.properties || {};

  useEffect(() => {
    const city = p.CIUTAT;
    if (!city) {
      setOfficial(null);
      return;
    }

    let cancelled = false;
    setOfficialLoading(true);
    fetch(`/api/official?city=${encodeURIComponent(city)}`)
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) setOfficial(data);
      })
      .catch(() => {
        if (!cancelled) setOfficial(null);
      })
      .finally(() => {
        if (!cancelled) setOfficialLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [p.CIUTAT]);

  const decision = useMemo(
    () => getDecision(activeZone, official, profile, confirmedResidentTrams),
    [activeZone, official, profile, confirmedResidentTrams]
  );

  const activeTramId = String(p.TRAM_ID || p.OBJECTID || "");
  const residentRule = official?.residentRules?.find((rule) => rule.freeAssignedGreen);
  const canConfirmResidentTram = Boolean(
    activeZone &&
    activeTramId &&
    zoneKind(activeZone) === "green" &&
    profile.residentAuthorized &&
    municipalityMatches(profile.residentMunicipality, p.CIUTAT) &&
    residentRule
  );
  const isConfirmedResidentTram =
    canConfirmResidentTram && confirmedResidentTrams.includes(activeTramId);

  const toggleResidentTram = useCallback(() => {
    if (!activeTramId) return;
    const next = confirmedResidentTrams.includes(activeTramId)
      ? confirmedResidentTrams.filter((id) => id !== activeTramId)
      : [...confirmedResidentTrams, activeTramId];
    setConfirmedResidentTrams(next);
    localStorage.setItem("parkbcn-resident-trams", JSON.stringify(next));
  }, [activeTramId, confirmedResidentTrams]);

  const saveProfile = useCallback((event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = {
      residentAuthorized: form.get("residentAuthorized") === "on",
      residentMunicipality: String(form.get("residentMunicipality") || ""),
      residentArea: String(form.get("residentArea") || "").trim(),
      plate: String(form.get("plate") || "").trim().toUpperCase()
    };
    setProfile(next);
    localStorage.setItem("parkbcn-profile", JSON.stringify(next));
    setProfileOpen(false);
  }, []);

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
    setVoiceText("Parking libre guardado. Sirve como referencia personal; confirma siempre la señal al volver.");
  }, [location, locate, savedFree]);

  const startParking = useCallback(() => {
    if (parked) {
      setVoiceText("Ya tienes un aparcamiento activo.");
      return;
    }
    if (!location) {
      locate();
      return;
    }

    const minutes = decision.noTimer ? 0 : maxMinutes(p);
    const active = {
      startedAt: Date.now(),
      lat: location.lat,
      lng: location.lng,
      decision: {
        title: decision.title,
        detail: decision.detail,
        tone: decision.tone
      },
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
    setDriveMode(false);
    setVoiceText(
      minutes
        ? `Aparcamiento registrado. Contador según el máximo publicado: ${minutes} min.`
        : "Aparcamiento registrado sin contador automático para esta condición."
    );

    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, [parked, location, locate, decision, p, activeZone]);

  const clearParking = useCallback(() => {
    setParked(null);
    localStorage.removeItem("parkbcn-active");
    setVoiceText("Aparcamiento finalizado.");
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

      if (text.includes("he aparcado") || text.includes("aparqué") || text.includes("aparque")) {
        startParking();
      } else if (
        text.includes("parking libre") ||
        text.includes("aparcamiento libre") ||
        text.includes("zona blanca")
      ) {
        saveFreeHere();
      } else if (text.includes("modo conducción") || text.includes("modo conduccion")) {
        setDriveMode(true);
      } else if (text.includes("parar conducción") || text.includes("parar conduccion")) {
        setDriveMode(false);
      } else if (text.includes("más información") || text.includes("mas informacion")) {
        setInfoOpen(true);
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

  const remaining = parked?.endsAt ? Math.max(0, parked.endsAt - now) : null;
  const remainingText =
    remaining === null
      ? ""
      : `${String(Math.floor(remaining / 3600000)).padStart(2, "0")}:${String(
          Math.floor((remaining % 3600000) / 60000)
        ).padStart(2, "0")}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0")}`;

  const distance =
    currentNearest?.feature === activeZone ? Math.round(currentNearest.distance) : null;

  return (
    <main className="appShell">
      <MapContainer center={FALLBACK_CENTER} zoom={13} zoomControl={false} className="map">
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
          <div className="brand">ParkBCN <span>V2</span></div>
          <div className="status">
            {loadingZones ? "Actualizando zonas…" : status}
          </div>
        </div>
        <div className="topActions">
          <button
            className={`roundButton ${driveMode ? "active" : ""}`}
            onClick={() => setDriveMode((value) => !value)}
            aria-label="Modo conducción"
            title="Modo conducción"
          >
            🚘
          </button>
          <button className="roundButton" onClick={locate} aria-label="Mi ubicación">
            ◎
          </button>
        </div>
      </header>

      {driveMode && (
        <div className="drivePill">
          <span>● Modo conducción</span>
          <small>{wakeActive ? "pantalla activa" : "seguimiento GPS"}</small>
        </div>
      )}

      <div className="legend">
        <span><i className="dot green" /> Verde</span>
        <span><i className="dot blue" /> Azul</span>
        <button className="legendInfo" onClick={() => setGuideOpen(true)} aria-label="Guía de líneas">
          ⓘ
        </button>
      </div>

      <section className="bottomSheet">
        {parked && (
          <div className="activeParking">
            <div>
              <small>APARCAMIENTO ACTIVO</small>
              <strong>{remaining !== null ? remainingText : "Sin contador"}</strong>
              <span>{parked.decision?.title || parked.zone?.type || "Ubicación guardada"}</span>
            </div>
            <button onClick={clearParking}>Finalizar</button>
          </div>
        )}

        <div className={`decisionCard ${decision.tone}`}>
          <div className="decisionIcon">{decision.icon}</div>
          <div className="decisionCopy">
            <small>RESULTADO ORIENTATIVO</small>
            <strong>{decision.title}</strong>
            <p>{decision.detail}</p>
          </div>
          <button className="infoButton" onClick={() => setInfoOpen(true)} aria-label="Más información">
            ⓘ
          </button>
        </div>

        <div className="zoneCard">
          {activeZone ? (
            <>
              <div className="zoneHeader">
                <span className="zoneBadge" style={{ background: colorFor(activeZone) }}>
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
                AMB puede no incluir parking libre, DUM, residentes exclusivos u otras restricciones.
              </p>
            </>
          )}
        </div>

        {voiceText && <div className="voiceText">{voiceText}</div>}

        {!parked ? (
          <div className="actions">
            <button className="primaryAction" onClick={startParking}>
              🚗 He aparcado aquí
            </button>
            <button className="micAction" onClick={listen} aria-label="Comando de voz">
              🎤
            </button>
          </div>
        ) : (
          <div className="actions parkedActions">
            <button className="secondaryAction" onClick={() => setInfoOpen(true)}>
              ⓘ Ver regla actual
            </button>
            <button className="micAction" onClick={listen} aria-label="Comando de voz">
              🎤
            </button>
          </div>
        )}

        <div className="secondaryRow">
          <button onClick={saveFreeHere}>＋ Guardar parking libre</button>
          <button onClick={() => setProfileOpen(true)}>👤 Perfil</button>
        </div>

        <p className="legalNote">
          Señalización física y normativa vigente prevalecen. ParkBCN resume datos oficiales y tus referencias personales.
        </p>
      </section>

      {profileOpen && (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => setProfileOpen(false)}>
          <div className="modalCard" role="dialog" aria-modal="true" aria-label="Perfil de residente" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <div>
                <small>PERFIL</small>
                <h3>Residencia y vehículo</h3>
              </div>
              <button onClick={() => setProfileOpen(false)} aria-label="Cerrar">×</button>
            </div>

            <form onSubmit={saveProfile} className="profileForm">
              <label className="switchRow">
                <input type="checkbox" name="residentAuthorized" defaultChecked={profile.residentAuthorized} />
                <span>Tengo autorización municipal de residente</span>
              </label>

              <label>
                <span>Municipio de mi autorización</span>
                <select name="residentMunicipality" defaultValue={profile.residentMunicipality}>
                  <option value="">Seleccionar…</option>
                  {MUNICIPALITIES.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>

              <label>
                <span>Zona / barrio autorizado</span>
                <input
                  name="residentArea"
                  defaultValue={profile.residentArea}
                  placeholder="Ej. Collblanc-La Torrassa"
                />
                <small>La app no asumirá que tu permiso sirve para todo el municipio.</small>
              </label>

              <label>
                <span>Matrícula (opcional)</span>
                <input name="plate" defaultValue={profile.plate} placeholder="1234ABC" autoCapitalize="characters" />
              </label>

              <button className="saveButton" type="submit">Guardar perfil</button>
            </form>
          </div>
        </div>
      )}

      {infoOpen && (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => setInfoOpen(false)}>
          <div className="modalCard infoModal" role="dialog" aria-modal="true" aria-label="Información oficial" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <div>
                <small>MÁS INFO</small>
                <h3>{p.TRAM_TIPUS || "Regla de estacionamiento"}</h3>
              </div>
              <button onClick={() => setInfoOpen(false)} aria-label="Cerrar">×</button>
            </div>

            <div className={`modalDecision ${decision.tone}`}>
              <strong>{decision.title}</strong>
              <p>{decision.detail}</p>
            </div>

            {profile.residentAuthorized && (
              <div className="profileHint">
                <b>Tu perfil:</b> {profile.residentMunicipality || "municipio sin definir"}
                {profile.residentArea ? ` · ${profile.residentArea}` : ""}
              </div>
            )}

            {canConfirmResidentTram && (
              <button
                type="button"
                className={`residentConfirm ${isConfirmedResidentTram ? "confirmed" : ""}`}
                onClick={toggleResidentTram}
              >
                {isConfirmedResidentTram
                  ? "✓ Este tramo está confirmado como mi zona residente"
                  : "Confirmar que este tramo pertenece a mi zona residente"}
              </button>
            )}

            <div className="sourceSection">
              <div className="sourceTitle">
                <h4>Fuentes oficiales</h4>
                <span>{officialLoading ? "Comprobando…" : `Revisado ${formatCheckedAt(official?.checkedAt)}`}</span>
              </div>

              {official?.sources?.length ? (
                official.sources.map((source) => (
                  <a key={source.id} className="sourceLink" href={source.url} target="_blank" rel="noreferrer">
                    <div>
                      <strong>{source.name}</strong>
                      <small>{source.authority}</small>
                    </div>
                    <span className={source.available ? "sourceOk" : "sourceOff"}>
                      {source.available ? "Oficial ✓" : "No disponible"}
                    </span>
                  </a>
                ))
              ) : (
                <p className="mutedText">No se pudo comprobar una fuente adicional ahora mismo.</p>
              )}
            </div>

            {official?.facts?.length > 0 && (
              <div className="factList">
                {official.facts.map((fact) => (
                  <div key={fact.id}>
                    <strong>{fact.title}</strong>
                    <p>{fact.text}</p>
                    {fact.publishedDate && <small>Publicado: {fact.publishedDate}</small>}
                  </div>
                ))}
              </div>
            )}

            <div className="priorityNote">
              <b>Orden de seguridad:</b> señal del tramo → ayuntamiento/operador → AMB → DGT/BOE.
            </div>
          </div>
        </div>
      )}

      {guideOpen && (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => setGuideOpen(false)}>
          <div className="modalCard guideModal" role="dialog" aria-modal="true" aria-label="Guía de marcas" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <div>
                <small>GUÍA RÁPIDA</small>
                <h3>Colores y marcas</h3>
              </div>
              <button onClick={() => setGuideOpen(false)} aria-label="Cerrar">×</button>
            </div>

            <div className="markGuide">
              <div><i className="lineSample blueLine" /><span><b>Azul</b><small>Normalmente regulada/limitada. Mira horario y tarifa.</small></span></div>
              <div><i className="lineSample greenLine" /><span><b>Verde</b><small>Regla municipal; suele distinguir residentes/no residentes.</small></span></div>
              <div><i className="lineSample whiteLine" /><span><b>Blanca</b><small>No significa siempre “gratis”: texto, pictograma o señal pueden restringirla.</small></span></div>
              <div><i className="lineSample yellowLine" /><span><b>Amarilla</b><small>Puede indicar prohibición o reserva. No aparques sin comprobar la señal.</small></span></div>
              <div><i className="zigzagSample" /><span><b>Zigzag / marcas especiales</b><small>Reserva de uso específico. Consulta señal vertical.</small></span></div>
            </div>

            <button className="saveButton" type="button" onClick={() => { setGuideOpen(false); setInfoOpen(true); }}>
              Ver fuentes oficiales
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
