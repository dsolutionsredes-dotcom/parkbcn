import { NextResponse } from "next/server";
import registry from "../../../data/official-sources.json";

function normalize(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .trim();
}

function stripHtml(html = "") {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&rsquo;/gi, "’")
    .replace(/&aacute;/gi, "á")
    .replace(/&eacute;/gi, "é")
    .replace(/&iacute;/gi, "í")
    .replace(/&oacute;/gi, "ó")
    .replace(/&uacute;/gi, "ú")
    .replace(/&agrave;/gi, "à")
    .replace(/&egrave;/gi, "è")
    .replace(/&ograve;/gi, "ò")
    .replace(/\s+/g, " ")
    .trim();
}

function todayMadrid() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    iso: `${get("year")}-${get("month")}-${get("day")}`
  };
}

function firstDate(text = "") {
  const dmy = text.match(/\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b/);
  if (dmy) return `${String(dmy[1]).padStart(2, "0")}/${String(dmy[2]).padStart(2, "0")}/${dmy[3]}`;
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return null;
}

async function readSource(id) {
  const source = registry.sources[id];
  if (!source) return null;
  try {
    const response = await fetch(source.url, {
      next: { revalidate: 1800 },
      headers: { "User-Agent": "ParkBCN/0.3 (+official-source-check)" }
    });
    if (!response.ok) return null;
    if (/login|signin|oauth|autentic|carpeta.?ciutadana/i.test(response.url || "")) return null;

    const html = await response.text();
    const text = stripHtml(html);
    const normalized = normalize(text);
    const expected = source.mustContainAny || [];
    if (expected.length && !expected.some((phrase) => normalized.includes(normalize(phrase)))) {
      return null;
    }

    return {
      id,
      ...source,
      checkedAt: new Date().toISOString(),
      publishedDate: source.detectPublishedDate ? firstDate(text) : null,
      lastModified: response.headers.get("last-modified") || null,
      text
    };
  } catch {
    return null;
  }
}

function sourceFact(id, title, text, extra = {}) {
  return { id: `${id}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, title, text, sourceId: id, ...extra };
}

function deriveRules(sources, city, zoneType, residentProfile, today) {
  const byId = Object.fromEntries(sources.map((s) => [s.id, s]));
  const facts = [];
  const temporaryRules = [];
  const residentRules = [];
  const type = normalize(zoneType);
  const isGreen = /verd|green/.test(type);
  const isBlue = /blav|azul|blue/.test(type);

  if (byId["hospitalet-august"] && (isGreen || isBlue)) {
    const t = normalize(byId["hospitalet-august"].text);
    if (today.month === 8 && /gratuit|gratu/.test(t)) {
      temporaryRules.push({
        id: "hospitalet-august-free",
        active: true,
        appliesTo: ["zona verde", "zona verda", "zona azul", "zona blava"],
        excludes: ["dum", "amarilla", "groga", "carga", "carrega"],
        free: true,
        sourceId: "hospitalet-august",
        summary: "Durante agosto, la publicación municipal vigente indica gratuidad de las zonas azul y verde; DUM/carga y descarga queda fuera de esta excepción."
      });
      facts.push(sourceFact("hospitalet-august", "Gratuidad de agosto", "La excepción oficial de agosto se aplica a zona azul y verde, no a DUM."));
    }
  }

  if (byId["hospitalet-resident"] && isGreen && residentProfile) {
    residentRules.push({
      id: "hospitalet-resident-green",
      municipality: "L'Hospitalet de Llobregat",
      type: "resident-green",
      freeAssignedGreen: true,
      assignedAreaOnly: true,
      requiresTicket: true,
      sourceId: "hospitalet-resident",
      summary: "La bonificación de residente se aplica a la zona verde asignada y requiere validación/tique cuando corresponda."
    });
  }

  if (byId["barcelona-green"] && isGreen) {
    residentRules.push({
      id: "barcelona-resident-green",
      municipality: "Barcelona",
      type: "resident-green",
      freeAssignedGreen: false,
      residentDailyPrice: "0,20 €/día",
      assignedAreaOnly: true,
      requiresTicket: true,
      sourceId: "barcelona-green",
      summary: "La tarifa de residente solo se aplica en la zona AREA asignada."
    });
  }

  if (byId["barcelona-residents"] && /resident/.test(type)) {
    facts.push(sourceFact("barcelona-residents", "Exclusivas de residentes", "Barcelona publica zonas exclusivas con regulación horaria y otras con exclusividad durante 24 horas; la señal del tramo decide el caso concreto."));
  }

  if (byId["santboi-blue"] && isBlue) {
    const t = normalize(byId["santboi-blue"].text);
    if (today.month === 8 && t.includes("1 al 31") && t.includes("agost")) {
      temporaryRules.push({
        id: "santboi-august-blue-free",
        active: true,
        appliesTo: ["zona azul", "zona blava"],
        excludes: [],
        free: true,
        sourceId: "santboi-blue",
        summary: "Sant Boi publica la zona azul como aparcamiento libre del 1 al 31 de agosto; aun así debe respetarse cualquier reserva o señal específica del tramo."
      });
    }
  }

  if (byId["santjoan-regulated"] && isGreen && residentProfile) {
    residentRules.push({
      id: "santjoan-resident-green",
      municipality: "Sant Joan Despí",
      type: "resident-green",
      freeAssignedGreen: true,
      assignedAreaOnly: true,
      requiresTicket: true,
      sourceId: "santjoan-regulated",
      summary: "Las zonas verdes para residentes requieren vehículo autorizado y validación del tique; las condiciones cambian según el ámbito."
    });
  }

  if (byId["elprat-parking"] && isGreen && residentProfile) {
    residentRules.push({
      id: "elprat-resident-green",
      municipality: "El Prat de Llobregat",
      type: "resident-green",
      freeAssignedGreen: true,
      assignedAreaOnly: false,
      requiresTicket: false,
      sourceId: "elprat-parking",
      summary: "La zona verde publicada para litoral/espacios naturales es gratuita para vehículos con distintivo de residente; comprueba que el tramo pertenece a ese ámbito."
    });
  }

  if (byId["castelldefels-green-2026"] && isGreen && residentProfile) {
    residentRules.push({
      id: "castelldefels-resident-green",
      municipality: "Castelldefels",
      type: "resident-green",
      freeAssignedGreen: true,
      assignedAreaOnly: false,
      requiresTicket: false,
      sourceId: "castelldefels-green-2026",
      summary: "La publicación municipal de 2026 indica zona verde gratuita para residentes que cumplen los requisitos municipales."
    });
  }

  if (byId["esplugues-green"] && isGreen && residentProfile) {
    residentRules.push({
      id: "esplugues-resident-green",
      municipality: "Esplugues de Llobregat",
      type: "resident-green",
      freeAssignedGreen: null,
      assignedAreaOnly: true,
      requiresTicket: true,
      sourceId: "esplugues-green",
      summary: "La autorización permite estacionar en la zona verde territorial correspondiente y exige comprobante; la tarifa concreta debe tomarse del tramo/AMB."
    });
  }

  if (byId["santjust-parking"] && isGreen && residentProfile) {
    residentRules.push({
      id: "santjust-resident-green",
      municipality: "Sant Just Desvern",
      type: "resident-green",
      freeAssignedGreen: null,
      assignedAreaOnly: true,
      requiresTicket: true,
      sourceId: "santjust-parking",
      summary: "Sant Just distingue residentes del perímetro de zona verde; precio y validación dependen de la condición concreta."
    });
  }

  if (byId["montgat-parking"]) {
    facts.push(sourceFact("montgat-parking", "Montgat tiene varias reglas", "Montgat diferencia zona Express, verde exclusiva, verde preferente y azul, con reglas distintas para residentes y no residentes; no se debe decidir solo por el color."));
  }

  if (byId["santacoloma-parking"] && isBlue) {
    facts.push(sourceFact("santacoloma-parking", "Fuera del horario de pago", "Santa Coloma publica que fuera del horario regulado la zona azul no está condicionada al pago; la señalización concreta sigue prevaleciendo."));
  }

  if (byId["badalona-blue"] && isBlue) {
    facts.push(sourceFact("badalona-blue", "Horario oficial de Badalona", "Engestur publica horarios distintos entre zona urbana y zona de playa; ParkBCN usa además el horario del tramo devuelto por AMB."));
  }

  return { facts, temporaryRules, residentRules };
}

function cityKey(input) {
  const n = normalize(input);
  return registry.metropolitanMunicipalities.find((name) => normalize(name) === n) ||
    registry.metropolitanMunicipalities.find((name) => normalize(name).includes(n) || n.includes(normalize(name))) || input;
}

function filterMunicipalSourceIds(city, zoneType, residentProfile) {
  const ids = registry.municipalitySourceMap[city] || [];
  const type = normalize(zoneType);
  return ids.filter((id) => {
    if (id === "barcelona-green") return /verd|green/.test(type);
    if (id === "barcelona-blue") return /blav|azul|blue/.test(type);
    if (id === "barcelona-residents") return /resident/.test(type);
    if (id === "hospitalet-august") return /verd|green|blav|azul|blue/.test(type);
    if (id === "hospitalet-resident") return residentProfile && /verd|green/.test(type);
    if (id === "badalona-blue") return /blav|azul|blue/.test(type);
    if (id === "badalona-green-artigues") return /verd|green/.test(type);
    if (id === "santjoan-blue") return /blav|azul|blue/.test(type);
    if (id === "esplugues-green") return residentProfile && /verd|green/.test(type);
    if (id === "castelldefels-green-2026") return /verd|green/.test(type);
    if (id === "santboi-blue") return /blav|azul|blue/.test(type);
    return true;
  });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const rawCity = searchParams.get("city") || "";
  const zoneType = searchParams.get("type") || "";
  const residentProfile = searchParams.get("resident") === "1";
  const city = cityKey(rawCity);
  const today = todayMadrid();
  const wanted = [];

  if (registry.ambParkingMunicipalities.includes(city)) wanted.push("amb-parking");
  wanted.push(...filterMunicipalSourceIds(city, zoneType, residentProfile));

  const sourceIds = [...new Set(wanted)];
  const loaded = (await Promise.all(sourceIds.map(readSource))).filter(Boolean);
  const derived = deriveRules(loaded, city, zoneType, residentProfile, today);

  const publicSources = loaded.map(({ text, ...source }) => source);

  return NextResponse.json(
    {
      city,
      zoneType,
      localDate: today.iso,
      checkedAt: new Date().toISOString(),
      ambParkingIntegrated: registry.ambParkingMunicipalities.includes(city),
      metropolitanMunicipality: registry.metropolitanMunicipalities.includes(city),
      sources: publicSources,
      ...derived,
      policy: {
        warning: "Solo se muestran enlaces oficiales que respondieron y cuyo contenido coincide con la regla buscada. La señalización física del tramo prevalece.",
        sourcePriority: ["Señalización física", "Ayuntamiento / operador municipal", "AMB", "DGT / BOE"]
      }
    },
    { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" } }
  );
}
