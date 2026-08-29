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
  "Badalona", "Badia del Vallès", "Barberà del Vallès", "Barcelona", "Begues",
  "Castellbisbal", "Castelldefels", "Cerdanyola del Vallès", "Cervelló", "Corbera de Llobregat",
  "Cornellà de Llobregat", "El Papiol", "El Prat de Llobregat", "Esplugues de Llobregat", "Gavà",
  "L'Hospitalet de Llobregat", "La Palma de Cervelló", "Molins de Rei", "Montcada i Reixac", "Montgat",
  "Pallejà", "Ripollet", "Sant Adrià de Besòs", "Sant Andreu de la Barca", "Sant Boi de Llobregat",
  "Sant Climent de Llobregat", "Sant Cugat del Vallès", "Sant Feliu de Llobregat", "Sant Joan Despí",
  "Sant Just Desvern", "Sant Vicenç dels Horts", "Santa Coloma de Cervelló", "Santa Coloma de Gramenet",
  "Tiana", "Torrelles de Llobregat", "Viladecans"
];

function normalize(value = "") {
  return String(value)
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
  if (coords.length >= 2 && typeof coords[0] === "number" && typeof coords[1] === "number") {
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

function municipalityMatches(aValue, bValue) {
  if (!aValue || !bValue) return false;
  const a = normalize(aValue);
  const b = normalize(bValue);
  if (a.includes("hospitalet") && b.includes("hospitalet")) return true;
  return a === b || a.includes(b) || b.includes(a);
}

function activeTemporaryRule(official, feature) {
  if (!official?.temporaryRules?.length || !feature) return null;
  const type = normalize(feature.properties?.TRAM_TIPUS || "");
  return official.temporaryRules.find((rule) => {
    if (!rule.active) return false;
    const applies = (rule.appliesTo || []).some((item) => type.includes(normalize(item).replace("zona ", "")) || type.includes(normalize(item)));
    const excluded = (rule.excludes || []).some((item) => type.includes(normalize(item)));
    return applies && !excluded;
  }) || null;
}

function madridClock() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Madrid",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const days = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { weekday: days[get("weekday")] || 0, minuteOfDay: Number(get("hour")) * 60 + Number(get("minute")) };
}

function scheduleStatus(schedule = "") {
  const text = normalize(schedule);
  if (!text) return { known: false };
  if (/24\s*h|24 horas|24 hores/.test(text)) return { known: true, active: true };

  const hasWeekday = /lunes a viernes|dilluns a divendres/.test(text);
  const hasSatExtra = /sabado|dissabte/.test(text) && hasWeekday;
  if (hasSatExtra) return { known: false };

  let days = null;
  if (/lunes a domingo|dilluns a diumenge|todos los dias|tots els dies/.test(text)) days = [1,2,3,4,5,6,7];
  else if (/lunes a sabado|dilluns a dissabte/.test(text)) days = [1,2,3,4,5,6];
  else if (hasWeekday) days = [1,2,3,4,5];
  else if (/sabado|dissabte/.test(text) && !/lunes|dilluns/.test(text)) days = [6];
  if (!days) return { known: false };

  const ranges = [];
  const re = /(\d{1,2})(?::(\d{2}))?\s*h?\s*(?:a|hasta|\-|–|—)\s*(\d{1,2})(?::(\d{2}))?\s*h?/g;
  let match;
  while ((match = re.exec(text))) {
    const start = Number(match[1]) * 60 + Number(match[2] || 0);
    const end = Number(match[3]) * 60 + Number(match[4] || 0);
    if (start >= 0 && end > start && end <= 24 * 60) ranges.push([start, end]);
  }
  if (!ranges.length) return { known: false };

  const now = madridClock();
  if (!days.includes(now.weekday)) return { known: true, active: false };
  return { known: true, active: ranges.some(([start, end]) => now.minuteOfDay >= start && now.minuteOfDay < end) };
}

function getDecision(feature, official, profile, confirmedResidentTrams = []) {
  if (!feature) {
    return {
      tone: "unknown",
      icon: "?",
      title: "Tramo no identificado",
      detail: official?.metropolitanMunicipality
        ? "Municipio reconocido, pero no hay un tramo regulado oficial de AMB en este punto. Puede ser libre, reservado o estar regulado por otra señal."
        : "No se pudo identificar una regla oficial para este punto. Revisa la señalización.",
      noTimer: true
    };
  }

  const p = feature.properties || {};
  const type = normalize(p.TRAM_TIPUS || "");
  const temporary = activeTemporaryRule(official, feature);
  const residentType = type.includes("resident") || type.includes("acreditat");
  const profileCityMatch = municipalityMatches(profile.residentMunicipality, p.CIUTAT);
  const residentRule = official?.residentRules?.find((rule) => rule.type === "resident-green");
  const tramId = String(p.TRAM_ID || p.OBJECTID || "");
  const confirmedResidentTram = tramId && confirmedResidentTrams.includes(tramId);
  const kind = zoneKind(feature);
  const schedule = scheduleStatus(p.HORARI || "");

  if (temporary) {
    return { tone: "good", icon: "✓", title: "Gratis ahora", detail: temporary.summary, noTimer: true, sourceId: temporary.sourceId };
  }

  if (kind === "green" && profile.residentAuthorized && profileCityMatch && residentRule) {
    const areaConfirmed = residentRule.assignedAreaOnly === false || confirmedResidentTram;
    if (areaConfirmed) {
      if (residentRule.freeAssignedGreen === true) {
        return {
          tone: "good", icon: "✓", title: "Ventaja de residente aplicada",
          detail: residentRule.requiresTicket
            ? "La fuente oficial confirma gratuidad para esta condición de residente, pero debes validar/obtener el tique cuando corresponda."
            : "La fuente oficial confirma gratuidad para esta condición de residente.",
          noTimer: true, sourceId: residentRule.sourceId
        };
      }
      if (residentRule.freeAssignedGreen === false) {
        return {
          tone: "good", icon: "R", title: "Tarifa de residente",
          detail: `Tu condición de residente aplica aquí. ${residentRule.residentDailyPrice ? `Tarifa publicada: ${residentRule.residentDailyPrice}.` : "Consulta la tarifa del tramo."}`,
          noTimer: true, sourceId: residentRule.sourceId
        };
      }
      return {
        tone: "warning", icon: "i", title: "Regla de residente aplicable",
        detail: "La fuente confirma una condición especial de residente, pero no es seguro asumir gratuidad. Usa ⓘ para revisar la fuente y la tarifa del tramo.",
        noTimer: false, sourceId: residentRule.sourceId
      };
    }

    return {
      tone: "warning", icon: "i",
      title: residentRule.freeAssignedGreen === true ? "Puede ser gratis para ti" : "Puede aplicarte condición de residente",
      detail: profile.residentArea
        ? `Tu permiso no se aplica automáticamente a todo el municipio. Confirma que este tramo pertenece a ${profile.residentArea}.`
        : "Tu permiso no se aplica automáticamente a todo el municipio. Indica tu zona y confirma este tramo en ⓘ.",
      noTimer: false, sourceId: residentRule.sourceId
    };
  }

  if (residentType && !profile.residentAuthorized) {
    return { tone: "danger", icon: "!", title: "Zona de residentes", detail: "No aparques aquí como plaza ordinaria sin comprobar que tienes autorización para este ámbito.", noTimer: true };
  }

  if ((kind === "green" || kind === "blue") && schedule.known && !schedule.active) {
    return {
      tone: "good", icon: "◷", title: "Fuera del horario publicado",
      detail: "Según el horario del tramo recibido de AMB, la regulación horaria no está activa ahora. Esto no elimina reservas 24 h, vados, DUM ni otras señales específicas.",
      noTimer: true
    };
  }

  if (kind === "green" || kind === "blue") {
    const minutes = maxMinutes(p);
    return {
      tone: "info", icon: "P",
      title: kind === "green" ? "Zona verde regulada" : "Zona azul regulada",
      detail: minutes
        ? `Regulación activa o no interpretable con total certeza. Máximo publicado por AMB: ${minutes} min.`
        : "Consulta horario, tarifa y señalización del tramo antes de dejar el coche.",
      noTimer: !minutes
    };
  }

  if (kind === "red") {
    return { tone: "danger", icon: "!", title: "Regulación especial", detail: "No la trates como aparcamiento normal sin comprobar la señalización.", noTimer: true };
  }

  return { tone: "warning", icon: "i", title: "Regulación especial", detail: "Comprueba la señal del tramo antes de aparcar.", noTimer: true };
}

function formatCheckedAt(value) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  } catch { return ""; }
}

function MapController({ onViewport, onMapReady, onUserPan }) {
  const map = useMap();
  useEffect(() => {
    onMapReady(map);
    onViewport(boundsToBbox(map.getBounds()));
  }, [map, onMapReady, onViewport]);
  useMapEvents({
    moveend() { onViewport(boundsToBbox(map.getBounds())); },
    zoomend() { onViewport(boundsToBbox(map.getBounds())); },
    dragstart() { onUserPan?.(); }
  });
  return null;
}

export default function ParkingMap() {
  const [mapRef, setMapRef] = useState(null);
  const [zones, setZones] = useState({ type: "FeatureCollection", features: [] });
  const [location, setLocation] = useState(null);
  const [municipality, setMunicipality] = useState(null);
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
  const [followMap, setFollowMap] = useState(true);
  const [wakeActive, setWakeActive] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [sheetMode, setSheetMode] = useState("expanded");

  const recognitionRef = useRef(null);
  const voiceTimerRef = useRef(null);
  const lastBboxRef = useRef("");
  const watchIdRef = useRef(null);
  const wakeLockRef = useRef(null);
  const sheetDragRef = useRef(null);

  useEffect(() => {
    setSavedFree(JSON.parse(localStorage.getItem("parkbcn-free") || "[]"));
    setParked(JSON.parse(localStorage.getItem("parkbcn-active") || "null"));
    const storedProfile = JSON.parse(localStorage.getItem("parkbcn-profile") || "null");
    const storedTrams = JSON.parse(localStorage.getItem("parkbcn-resident-trams") || "[]");
    if (storedProfile) setProfile({ ...DEFAULT_PROFILE, ...storedProfile });
    if (Array.isArray(storedTrams)) setConfirmedResidentTrams(storedTrams);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
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
    } finally { setLoadingZones(false); }
  }, []);

  const applyLocation = useCallback((pos, shouldFollow = false) => {
    const next = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
    setLocation(next);
    setStatus(`GPS ±${Math.round(pos.coords.accuracy)} m`);
    if (driveMode) setSelected(null);
    if (mapRef && shouldFollow && (!driveMode || followMap)) {
      const targetZoom = driveMode ? Math.max(mapRef.getZoom(), 17) : Math.max(mapRef.getZoom(), 16);
      mapRef.panTo([next.lat, next.lng], { animate: true, duration: 0.6 });
      if (mapRef.getZoom() < targetZoom) mapRef.setZoom(targetZoom);
    }
  }, [mapRef, driveMode, followMap]);

  const locate = useCallback(() => {
    if (!navigator.geolocation) return setStatus("Este navegador no ofrece geolocalización.");
    setStatus("Buscando tu ubicación…");
    navigator.geolocation.getCurrentPosition(
      (pos) => applyLocation(pos, true),
      () => setStatus("Activa el permiso de ubicación."),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 3000 }
    );
  }, [applyLocation]);

  useEffect(() => { if (mapRef) locate(); }, [mapRef, locate]);

  const municipalityCell = location ? `${location.lat.toFixed(3)},${location.lng.toFixed(3)}` : "";
  useEffect(() => {
    if (!location || !municipalityCell) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      fetch(`/api/municipality?lat=${location.lat}&lng=${location.lng}`)
        .then((r) => r.json())
        .then((data) => { if (!cancelled && data?.name) setMunicipality(data); })
        .catch(() => {});
    }, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [municipalityCell]);

  const requestWakeLock = useCallback(async () => {
    if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return setWakeActive(false);
    try {
      wakeLockRef.current = await navigator.wakeLock.request("screen");
      setWakeActive(true);
      wakeLockRef.current.addEventListener("release", () => setWakeActive(false));
    } catch { setWakeActive(false); }
  }, []);

  useEffect(() => {
    if (!driveMode) {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (wakeLockRef.current) wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
      setWakeActive(false);
      return;
    }

    requestWakeLock();
    if (navigator.geolocation && watchIdRef.current === null) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => applyLocation(pos, true),
        () => setStatus("No puedo seguir tu GPS. Revisa permisos."),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 1500 }
      );
    }
    const onVisibility = () => { if (document.visibilityState === "visible") requestWakeLock(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [driveMode, requestWakeLock, applyLocation]);

  const toggleDriveMode = useCallback(() => {
    setDriveMode((current) => {
      const next = !current;
      if (next) {
        setFollowMap(true);
        setSelected(null);
        setSheetMode("compact");
      } else if (!parked) {
        setSheetMode("expanded");
      }
      return next;
    });
  }, [parked]);

  const currentNearest = useMemo(() => {
    if (!location) return null;
    return nearestFeature(zones.features, location.lat, location.lng);
  }, [zones, location]);

  const nearestZone = currentNearest && currentNearest.distance <= 55 ? currentNearest.feature : null;
  const activeZone = driveMode ? nearestZone : (selected || nearestZone);
  const p = activeZone?.properties || {};
  const cityForRules = p.CIUTAT || municipality?.name || "";

  useEffect(() => {
    if (!cityForRules) { setOfficial(null); return; }
    let cancelled = false;
    setOfficial(null);
    setOfficialLoading(true);
    fetch(`/api/official?city=${encodeURIComponent(cityForRules)}&type=${encodeURIComponent(p.TRAM_TIPUS || "")}&resident=${profile.residentAuthorized ? "1" : "0"}`)
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setOfficial(data); })
      .catch(() => { if (!cancelled) setOfficial(null); })
      .finally(() => { if (!cancelled) setOfficialLoading(false); });
    return () => { cancelled = true; };
  }, [cityForRules, p.TRAM_TIPUS, profile.residentAuthorized]);

  const decision = useMemo(
    () => getDecision(activeZone, official, profile, confirmedResidentTrams),
    [activeZone, official, profile, confirmedResidentTrams]
  );

  const activeTramId = String(p.TRAM_ID || p.OBJECTID || "");
  const residentRule = official?.residentRules?.find((rule) => rule.type === "resident-green");
  const canConfirmResidentTram = Boolean(
    activeZone && activeTramId && zoneKind(activeZone) === "green" && profile.residentAuthorized &&
    municipalityMatches(profile.residentMunicipality, p.CIUTAT) && residentRule?.assignedAreaOnly
  );
  const isConfirmedResidentTram = canConfirmResidentTram && confirmedResidentTrams.includes(activeTramId);

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
    if (!location) return locate();
    const point = { id: Date.now(), lat: location.lat, lng: location.lng, createdAt: new Date().toISOString(), label: "Parking libre observado" };
    const next = [...savedFree, point];
    setSavedFree(next);
    localStorage.setItem("parkbcn-free", JSON.stringify(next));
    setVoiceText("Referencia personal guardada. Confirma la señal cuando vuelvas.");
  }, [location, locate, savedFree]);

  const startParking = useCallback(() => {
    if (parked) return setVoiceText("Ya tienes un aparcamiento activo.");
    if (!location) return locate();
    const minutes = decision.noTimer ? 0 : maxMinutes(p);
    const active = {
      startedAt: Date.now(), lat: location.lat, lng: location.lng,
      decision: { title: decision.title, detail: decision.detail, tone: decision.tone },
      zone: activeZone ? {
        city: cityForRules, type: p.TRAM_TIPUS || "", street: p.TRAM || "", schedule: p.HORARI || "",
        tariff: p.TARIFA || "", price: p.PREU_FRACCIO || "", maxMinutes: minutes
      } : null,
      endsAt: minutes ? Date.now() + minutes * 60 * 1000 : null
    };
    setParked(active);
    localStorage.setItem("parkbcn-active", JSON.stringify(active));
    setDriveMode(false);
    setSheetMode("peek");
    setVoiceText(minutes ? `Parking registrado. Contador: ${minutes} min.` : "Parking registrado sin contador automático para esta condición.");
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
  }, [parked, location, locate, decision, p, activeZone, cityForRules]);

  const clearParking = useCallback(() => {
    setParked(null);
    localStorage.removeItem("parkbcn-active");
    setSheetMode("expanded");
    setVoiceText("Aparcamiento finalizado.");
  }, []);

  useEffect(() => {
    if (!parked?.endsAt) return;
    const warningAt = parked.endsAt - 15 * 60 * 1000;
    if (now >= warningAt && now < parked.endsAt && !parked.warned) {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("ParkBCN", { body: "Quedan menos de 15 minutos según el tiempo máximo registrado." });
      }
      const next = { ...parked, warned: true };
      setParked(next);
      localStorage.setItem("parkbcn-active", JSON.stringify(next));
    }
  }, [now, parked]);

  const stopListening = useCallback((message = "") => {
    if (voiceTimerRef.current) clearTimeout(voiceTimerRef.current);
    voiceTimerRef.current = null;
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
    }
    setVoiceActive(false);
    if (message) setVoiceText(message);
  }, []);

  useEffect(() => {
    return () => {
      if (voiceTimerRef.current) clearTimeout(voiceTimerRef.current);
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch {}
      }
    };
  }, []);

  const listen = useCallback(() => {
    if (voiceActive) return stopListening("Micrófono apagado.");
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return setVoiceText("Tu navegador no admite reconocimiento de voz web.");

    const recognition = new SpeechRecognition();
    recognition.lang = "es-ES";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;

    const finish = () => {
      if (voiceTimerRef.current) clearTimeout(voiceTimerRef.current);
      voiceTimerRef.current = null;
      recognitionRef.current = null;
      setVoiceActive(false);
    };
    recognition.onstart = () => {
      setVoiceActive(true);
      setVoiceText("Escuchando…");
      voiceTimerRef.current = setTimeout(() => {
        try { recognition.abort(); } catch {}
        setVoiceText("Micrófono apagado.");
      }, 7000);
    };
    recognition.onend = finish;
    recognition.onerror = () => { setVoiceText("Micrófono apagado. No entendí el comando."); finish(); };
    recognition.onresult = (event) => {
      const text = event.results[0][0].transcript.toLowerCase();
      setVoiceText(`“${text}”`);
      if (text.includes("he aparcado") || text.includes("aparqué") || text.includes("aparque")) startParking();
      else if (text.includes("parking libre") || text.includes("aparcamiento libre") || text.includes("zona blanca")) saveFreeHere();
      else if (text.includes("modo conducción") || text.includes("modo conduccion")) { setDriveMode(true); setFollowMap(true); setSheetMode("compact"); }
      else if (text.includes("parar conducción") || text.includes("parar conduccion")) setDriveMode(false);
      else if (text.includes("más información") || text.includes("mas informacion")) setInfoOpen(true);
      else if (text.includes("dónde estoy") || text.includes("donde estoy") || text.includes("mi ubicación") || text.includes("mi ubicacion")) locate();
      else setVoiceText(`Comando no reconocido: “${text}”`);
      try { recognition.stop(); } catch {}
    };
    try { recognition.start(); } catch { finish(); }
  }, [voiceActive, stopListening, startParking, saveFreeHere, locate]);

  const changeSheet = useCallback((direction) => {
    const order = ["peek", "compact", "expanded"];
    setSheetMode((current) => {
      const i = order.indexOf(current);
      return order[Math.max(0, Math.min(order.length - 1, i + direction))];
    });
  }, []);

  const onHandleDown = useCallback((event) => {
    sheetDragRef.current = event.clientY;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);
  const onHandleUp = useCallback((event) => {
    const start = sheetDragRef.current;
    sheetDragRef.current = null;
    if (start === null || start === undefined) return;
    const delta = event.clientY - start;
    if (delta < -28) changeSheet(1);
    else if (delta > 28) changeSheet(-1);
    else changeSheet(sheetMode === "expanded" ? -1 : 1);
  }, [changeSheet, sheetMode]);

  const remaining = parked?.endsAt ? Math.max(0, parked.endsAt - now) : null;
  const remainingText = remaining === null ? "" : `${String(Math.floor(remaining / 3600000)).padStart(2, "0")}:${String(Math.floor((remaining % 3600000) / 60000)).padStart(2, "0")}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0")}`;
  const distance = currentNearest?.feature === activeZone ? Math.round(currentNearest.distance) : null;
  const showFull = sheetMode === "expanded";
  const showBody = sheetMode !== "peek";

  return (
    <main className="appShell">
      <MapContainer center={FALLBACK_CENTER} zoom={13} zoomControl={false} className="map">
        <MapController
          onViewport={fetchZones}
          onMapReady={setMapRef}
          onUserPan={() => { if (driveMode) setFollowMap(false); }}
        />
        <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <GeoJSON
          key={JSON.stringify(zones.features.map((f) => f.properties?.OBJECTID))}
          data={zones}
          style={(feature) => ({ color: colorFor(feature), weight: 7, opacity: 0.88 })}
          onEachFeature={(feature, layer) => layer.on("click", () => { if (!driveMode) { setSelected(feature); setSheetMode("expanded"); } })}
        />
        {location && <CircleMarker center={[location.lat, location.lng]} radius={8} pathOptions={{ color: "#fff", fillColor: "#0b1320", fillOpacity: 1, weight: 3 }}><Popup>Tu ubicación</Popup></CircleMarker>}
        {parked && <CircleMarker center={[parked.lat, parked.lng]} radius={8} pathOptions={{ color: "#0b1320", fillColor: "#fff", fillOpacity: 1, weight: 3 }}><Popup>Coche aparcado</Popup></CircleMarker>}
        {savedFree.map((point) => <CircleMarker key={point.id} center={[point.lat, point.lng]} radius={6} pathOptions={{ color: "#263238", fillColor: "#fff", fillOpacity: 1, weight: 3 }}><Popup>{point.label}</Popup></CircleMarker>)}
      </MapContainer>

      <header className="topBar">
        <div>
          <div className="brand">ParkBCN <span>V3</span></div>
          <div className="status">{loadingZones ? "Actualizando zonas…" : municipality?.name ? `${municipality.name} · ${status}` : status}</div>
        </div>
        <div className="topActions">
          <button className={`roundButton ${driveMode ? "active" : ""}`} onClick={toggleDriveMode} aria-label="Modo conducción">🚘</button>
          <button className="roundButton" onClick={() => { setFollowMap(true); locate(); }} aria-label="Mi ubicación">◎</button>
        </div>
      </header>

      {driveMode && (
        <div className="drivePill">
          <span>● Conducción · {followMap ? "siguiendo" : "mapa libre"}</span>
          <small>{wakeActive ? "pantalla activa" : "GPS activo"}</small>
        </div>
      )}
      {driveMode && !followMap && (
        <button className="recenterButton" onClick={() => { setFollowMap(true); locate(); }}>◎ Volver a seguirme</button>
      )}

      <div className="legend">
        <span><i className="dot green" /> Verde</span>
        <span><i className="dot blue" /> Azul</span>
        <button className="legendInfo" onClick={() => setGuideOpen(true)} aria-label="Guía de líneas">ⓘ</button>
      </div>

      <section className={`bottomSheet ${sheetMode}`}>
        <button className="sheetHandle" onPointerDown={onHandleDown} onPointerUp={onHandleUp} aria-label="Expandir o contraer panel">
          <i />
        </button>

        {parked && (
          <button className="activeParking" onClick={() => changeSheet(1)}>
            <div>
              <small>APARCAMIENTO ACTIVO</small>
              <strong>{remaining !== null ? remainingText : "Sin contador"}</strong>
              <span>{parked.decision?.title || parked.zone?.type || "Ubicación guardada"}</span>
            </div>
            <span className="parkingChevron">⌃</span>
          </button>
        )}

        {showBody && (
          <div className="sheetBody">
            <div className={`decisionCard ${decision.tone}`}>
              <div className="decisionIcon">{decision.icon}</div>
              <div className="decisionCopy">
                <small>{officialLoading ? "COMPROBANDO FUENTES…" : "RESULTADO ORIENTATIVO"}</small>
                <strong>{decision.title}</strong>
                <p>{decision.detail}</p>
              </div>
              <button className="infoButton" onClick={() => setInfoOpen(true)} aria-label="Más información">ⓘ</button>
            </div>

            {showFull && (
              <div className="zoneCard">
                {activeZone ? (
                  <>
                    <div className="zoneHeader">
                      <span className="zoneBadge" style={{ background: colorFor(activeZone) }}>{p.TRAM_TIPUS || "Zona regulada"}</span>
                      {distance !== null && <span className="distance">≈ {distance} m</span>}
                    </div>
                    <h2>{p.TRAM || "Tramo de estacionamiento"}</h2>
                    <p className="city">{cityForRules || "Área metropolitana de Barcelona"}</p>
                    <div className="facts">
                      <div><small>Horario</small><b>{p.HORARI || "Consultar señal"}</b></div>
                      <div><small>Máximo</small><b>{maxMinutes(p) ? `${maxMinutes(p)} min` : "Consultar"}</b></div>
                      <div><small>Tarifa</small><b>{p.TARIFA || p.PREU_FRACCIO || "Consultar"}</b></div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="zoneHeader"><span className="zoneBadge neutral">SIN TRAMO AMB</span></div>
                    <h2>{municipality?.name || "Zona sin identificar"}</h2>
                    <p className="city">El municipio puede estar reconocido aunque no exista un tramo regulado en el feed metropolitano.</p>
                  </>
                )}
              </div>
            )}

            {voiceText && <div className="voiceText">{voiceText}</div>}

            {!parked ? (
              <div className="actions">
                <button className="primaryAction" onClick={startParking}>🚗 He aparcado aquí</button>
                <button className={`micAction ${voiceActive ? "listening" : ""}`} onClick={listen} aria-label={voiceActive ? "Detener micrófono" : "Comando de voz"}>{voiceActive ? "■" : "🎤"}</button>
              </div>
            ) : (
              <div className="actions">
                <button className="secondaryAction" onClick={clearParking}>Finalizar aparcamiento</button>
                <button className={`micAction ${voiceActive ? "listening" : ""}`} onClick={listen}>{voiceActive ? "■" : "🎤"}</button>
              </div>
            )}

            {showFull && (
              <>
                <div className="secondaryRow">
                  <button onClick={saveFreeHere}>＋ Guardar parking libre</button>
                  <button onClick={() => setProfileOpen(true)}>👤 Mi perfil</button>
                </div>
                <p className="legalNote">La señal física prevalece. ParkBCN resume únicamente información oficial que pudo verificar y referencias que guardaste tú.</p>
              </>
            )}
          </div>
        )}
      </section>

      {profileOpen && (
        <div className="modalBackdrop" onMouseDown={() => setProfileOpen(false)}>
          <div className="modalCard" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalHeader"><div><small>MI PERFIL</small><h3>Residencia y vehículo</h3></div><button onClick={() => setProfileOpen(false)}>×</button></div>
            <p className="profileIntro">Solo existe un perfil activo en este dispositivo. Guardar cambios reemplaza el perfil actual.</p>
            <form onSubmit={saveProfile} className="profileForm">
              <label className="switchRow"><input type="checkbox" name="residentAuthorized" defaultChecked={profile.residentAuthorized} /><span>Tengo autorización municipal de residente</span></label>
              <label><span>Municipio de mi autorización</span><select name="residentMunicipality" defaultValue={profile.residentMunicipality}><option value="">Seleccionar…</option>{MUNICIPALITIES.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
              <label><span>Zona / barrio autorizado</span><input name="residentArea" defaultValue={profile.residentArea} placeholder="Ej. Collblanc-La Torrassa" /><small>No se asumirá que tu permiso vale en todo el municipio.</small></label>
              <label><span>Matrícula (opcional)</span><input name="plate" defaultValue={profile.plate} placeholder="1234ABC" autoCapitalize="characters" /></label>
              <button className="saveButton" type="submit">Guardar mi perfil</button>
            </form>
          </div>
        </div>
      )}

      {infoOpen && (
        <div className="modalBackdrop" onMouseDown={() => setInfoOpen(false)}>
          <div className="modalCard infoModal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalHeader"><div><small>MÁS INFO</small><h3>{p.TRAM_TIPUS || cityForRules || "Regla de estacionamiento"}</h3></div><button onClick={() => setInfoOpen(false)}>×</button></div>
            <div className={`modalDecision ${decision.tone}`}><strong>{decision.title}</strong><p>{decision.detail}</p></div>

            {profile.residentAuthorized && <div className="profileHint"><b>Tu perfil:</b> {profile.residentMunicipality || "sin municipio"}{profile.residentArea ? ` · ${profile.residentArea}` : ""}</div>}
            {canConfirmResidentTram && <button type="button" className={`residentConfirm ${isConfirmedResidentTram ? "confirmed" : ""}`} onClick={toggleResidentTram}>{isConfirmedResidentTram ? "✓ Este tramo pertenece a mi zona autorizada" : "Confirmar que este tramo pertenece a mi zona autorizada"}</button>}

            {official?.sources?.length > 0 && (
              <div className="sourceSection">
                <div className="sourceTitle"><h4>Fuentes oficiales usadas</h4><span>{formatCheckedAt(official.checkedAt) ? `Comprobado ${formatCheckedAt(official.checkedAt)}` : ""}</span></div>
                {official.sources.map((source) => (
                  <a key={source.id} className="sourceLink" href={source.url} target="_blank" rel="noreferrer">
                    <div><strong>{source.name}</strong><small>{source.role || source.authority}</small>{source.publishedDate && <em>Publicado: {source.publishedDate}</em>}</div><span className="sourceOk">Abrir ↗</span>
                  </a>
                ))}
              </div>
            )}

            {official?.facts?.length > 0 && <div className="factList">{official.facts.map((fact) => { const src = official.sources?.find((s) => s.id === fact.sourceId); return <div key={fact.id}><strong>{fact.title}</strong><p>{fact.text}</p>{src && <div className="factMeta"><a href={src.url} target="_blank" rel="noreferrer">Ver fuente oficial ↗</a></div>}</div>; })}</div>}
            <div className="priorityNote"><b>Orden:</b> señal del tramo → ayuntamiento/operador → AMB → DGT/BOE. Si no existe fuente específica verificada, ParkBCN no crea un enlace ni inventa una norma.</div>
          </div>
        </div>
      )}

      {guideOpen && (
        <div className="modalBackdrop" onMouseDown={() => setGuideOpen(false)}>
          <div className="modalCard guideModal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalHeader"><div><small>GUÍA RÁPIDA</small><h3>Colores y marcas</h3></div><button onClick={() => setGuideOpen(false)}>×</button></div>
            <div className="markGuide">
              <div><i className="lineSample blueLine" /><span><b>Azul</b><small>Normalmente estacionamiento regulado/limitado. Horario y tarifa dependen del municipio y tramo.</small></span></div>
              <div><i className="lineSample greenLine" /><span><b>Verde</b><small>No tiene una única regla metropolitana: puede priorizar residentes, ser exclusiva o admitir no residentes con tarifa.</small></span></div>
              <div><i className="lineSample whiteLine" /><span><b>Blanca</b><small>No equivale siempre a gratis. Texto, pictograma o señal vertical pueden limitar el uso.</small></span></div>
              <div><i className="lineSample yellowLine" /><span><b>Amarilla</b><small>Puede marcar prohibición o reserva. Comprueba siempre señal vertical.</small></span></div>
              <div><i className="zigzagSample" /><span><b>Zigzag / especial</b><small>Uso reservado o condición específica; no se trata como parking ordinario.</small></span></div>
            </div>
            <a className="guideSource" href="https://www.boe.es/buscar/act.php?id=BOE-A-2003-23514" target="_blank" rel="noreferrer">BOE · Reglamento General de Circulación ↗</a>
          </div>
        </div>
      )}
    </main>
  );
}
