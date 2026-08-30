import { NextResponse } from "next/server";
import registry from "../../../data/official-sources.json";

function normalize(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(html = "") {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&rsquo;/gi, "’")
    .replace(/&aacute;/gi, "á").replace(/&eacute;/gi, "é").replace(/&iacute;/gi, "í")
    .replace(/&oacute;/gi, "ó").replace(/&uacute;/gi, "ú").replace(/&agrave;/gi, "à")
    .replace(/&egrave;/gi, "è").replace(/&ograve;/gi, "ò").replace(/\s+/g, " ")
    .trim();
}

function madridNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    weekday: "short"
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return {
    year: Number(get("year")), month: Number(get("month")), day: Number(get("day")),
    hour: Number(get("hour")), minute: Number(get("minute")), weekday: get("weekday"),
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
      next: { revalidate: 21600 },
      headers: { "User-Agent": "ParkBCN/0.3.1 (+official-source-check)" }
    });
    if (!response.ok) return null;
    if (/login|signin|oauth|autentic|carpeta.?ciutadana/i.test(response.url || "")) return null;
    const html = await response.text();
    const text = stripHtml(html);
    const normalized = normalize(text);
    const expected = source.mustContainAny || [];
    if (expected.length && !expected.some((phrase) => normalized.includes(normalize(phrase)))) return null;
    return {
      id, ...source,
      checkedAt: new Date().toISOString(),
      publishedDate: source.detectPublishedDate ? firstDate(text) : null,
      lastModified: response.headers.get("last-modified") || null,
      text
    };
  } catch {
    return null;
  }
}

function cityKey(input) {
  const n = normalize(input);
  return registry.metropolitanMunicipalities.find((name) => normalize(name) === n) ||
    registry.metropolitanMunicipalities.find((name) => normalize(name).includes(n) || n.includes(normalize(name))) || input;
}

function typeFlags(zoneType = "") {
  const t = normalize(zoneType);
  return {
    t,
    blue: /blav|azul|blue/.test(t),
    green: /verd|green/.test(t),
    orange: /taronja|naranja|orange/.test(t),
    red: /vermell|roja|red/.test(t),
    resident: /resident|acredit/.test(t),
    dum: /dum|amarill|groga|carga|carrega/.test(t)
  };
}

function sourceFact(sourceId, title, text) {
  return { id: `${sourceId}-${normalize(title).replace(/[^a-z0-9]+/g, "-")}`, sourceId, title, text };
}

function labelKey(value = "") {
  const v = normalize(value);
  if (/^0|zero/.test(v)) return "0";
  if (v === "eco") return "ECO";
  if (v === "c") return "C";
  if (v === "b") return "B";
  if (/sin|sense|none/.test(v)) return "NONE";
  return "UNKNOWN";
}

function barcelonaPrice(kind, tariff, label) {
  const key = labelKey(label);
  if (key === "UNKNOWN") return null;
  const raw = normalize(tariff).replace(/tarifa/g, "").trim();
  let band = null;
  if (/gremi/.test(raw)) band = "G";
  else if (/^a\b|\ba\b/.test(raw)) band = "A";
  else if (/^b\b|\bb\b/.test(raw)) band = "B";
  if (!band) return null;
  const blue = {
    A: { "0": 1.25, ECO: 2.50, C: 3.25, B: 3.50, NONE: 3.75 },
    B: { "0": 1.15, ECO: 2.25, C: 3.00, B: 3.25, NONE: 3.50 }
  };
  const green = {
    A: { "0": 1.50, ECO: 3.00, C: 3.75, B: 4.00, NONE: 4.25 },
    B: { "0": 1.40, ECO: 2.75, C: 3.50, B: 3.75, NONE: 4.00 },
    G: { "0": 1.25, ECO: 2.50, C: 2.50, B: 2.50, NONE: 2.50 }
  };
  const table = kind === "blue" ? blue : kind === "green" ? green : null;
  const amount = table?.[band]?.[key];
  return amount == null ? null : `${amount.toFixed(2).replace(".", ",")} €/h`;
}

function deriveRules(loaded, { city, zoneType, tram, tariff, environmentalLabel, today }) {
  const byId = Object.fromEntries(loaded.map((s) => [s.id, s]));
  const f = typeFlags(zoneType);
  const facts = [];
  const temporaryRules = [];
  const residentRules = [];
  const zonePolicy = {
    outsideScheduleFree: null,
    requiresTicketWhenFree: false,
    priceText: null,
    priceSourceId: null,
    scheduleSourceId: null,
    sourceConfidence: "official-verified"
  };

  // Barcelona
  if (city === "Barcelona") {
    if (f.green && byId["barcelona-green"]) {
      zonePolicy.outsideScheduleFree = true;
      zonePolicy.scheduleSourceId = "barcelona-green";
      zonePolicy.priceText = barcelonaPrice("green", tariff, environmentalLabel);
      zonePolicy.priceSourceId = zonePolicy.priceText ? "barcelona-green" : null;
      residentRules.push({
        id: "barcelona-green-resident", type: "resident-green", assignedAreaOnly: true,
        freeAssignedGreen: false, residentDailyPrice: "0,20 €/día", requiresTicket: true,
        sourceId: "barcelona-green",
        summary: "La tarifa de residente solo se aplica dentro de la zona AREA asignada."
      });
    }
    if (f.blue && byId["barcelona-blue"]) {
      zonePolicy.scheduleSourceId = "barcelona-blue";
      zonePolicy.priceText = barcelonaPrice("blue", tariff, environmentalLabel);
      zonePolicy.priceSourceId = zonePolicy.priceText ? "barcelona-blue" : null;
    }
    if (f.resident && byId["barcelona-residents"]) {
      facts.push(sourceFact("barcelona-residents", "Exclusividad variable", "Hay plazas exclusivas 8–20 y otras con exclusividad 24 h. La señal vertical del tramo decide cuál aplica."));
    }
  }

  // L'Hospitalet
  if (city === "L'Hospitalet de Llobregat") {
    if (byId["hospitalet-aire"]) zonePolicy.scheduleSourceId = "hospitalet-aire";
    if (f.green && byId["hospitalet-august-2026"]) {
      residentRules.push({
        id: "hospitalet-green-resident", type: "resident-green", assignedAreaOnly: true,
        freeAssignedGreen: true, requiresTicket: true, sourceId: "hospitalet-august-2026",
        summary: "La publicación oficial de 2026 confirma que la zona verde es de uso preferente y 100% bonificado para residentes; tu autorización no se extiende automáticamente a todas las áreas."
      });
    }
    if (today.year === 2026 && today.month === 8 && (f.green || f.blue) && byId["hospitalet-august-2026"]) {
      temporaryRules.push({
        id: "hospitalet-august-2026", active: true, free: true, requiresTicket: false,
        sourceId: "hospitalet-august-2026",
        summary: "Del 1 al 31 de agosto de 2026, las zonas azul y verde son gratuitas. La zona DUM/amarilla mantiene su regulación."
      });
    }
  }

  // Badalona
  if (city === "Badalona" && f.blue && byId["badalona-blue"]) {
    zonePolicy.priceText = "1,75 €/h";
    zonePolicy.priceSourceId = "badalona-blue";
    zonePolicy.scheduleSourceId = "badalona-blue";
    if (today.month === 8 && normalize(tram).includes("torner")) {
      facts.push(sourceFact("badalona-blue", "Torner en agosto", "ENGESTUR publica que la zona Torner permanece cerrada en agosto. No se interpreta automáticamente como permiso para cualquier estacionamiento: revisa la señal."));
    }
  }

  // Castelldefels
  if (city === "Castelldefels") {
    if (f.blue && byId["castelldefels-blue"]) {
      zonePolicy.scheduleSourceId = "castelldefels-blue";
      facts.push(sourceFact("castelldefels-blue", "Centro y playa tienen calendarios distintos", "La zona azul urbana y las zonas de playa A/B tienen horarios y temporadas diferentes. ParkBCN prioriza el horario del tramo AMB."));
    }
    if (f.green && byId["castelldefels-green"]) zonePolicy.scheduleSourceId = "castelldefels-green";
    if (f.green && byId["castelldefels-authorizations"]) {
      residentRules.push({
        id: "castelldefels-green-resident", type: "resident-green", assignedAreaOnly: false,
        freeAssignedGreen: true, requiresTicket: false, sourceId: "castelldefels-authorizations",
        summary: "Los vehículos autorizados que cumplen los requisitos municipales disponen de condiciones específicas en zona verde."
      });
    }
  }

  // Cornellà
  if (city === "Cornellà de Llobregat" && byId["cornella-parking"]) {
    if (f.blue) zonePolicy.scheduleSourceId = "cornella-parking";
    if (f.green) facts.push(sourceFact("cornella-parking", "Zona verde exclusiva", "Cornellà publica zonas verdes exclusivas para vehículos del vecindario acreditado durante el horario indicado."));
    if (f.red) facts.push(sourceFact("cornella-parking", "Zona roja", "Cornellà usa tramos rojos como aparcamiento nocturno/fines de semana; fuera de esos periodos vuelven a ser carriles de circulación."));
  }

  // El Prat
  if (city === "El Prat de Llobregat") {
    if (byId["elprat-parking"]) zonePolicy.scheduleSourceId = "elprat-parking";
    const beachLike = /platja|playa|litoral|vela/.test(normalize(tram));
    if (f.green && beachLike && byId["elprat-beach"]) {
      zonePolicy.outsideScheduleFree = true;
      zonePolicy.scheduleSourceId = "elprat-beach";
      facts.push(sourceFact("elprat-beach", "Zona verde de playa", "Para vehículos sin distintivo de residente, la página oficial indica pago de 9 a 21 h y gratuidad de 21 a 9 h en la zona descrita de playa."));
    }
  }

  // Esplugues
  if (city === "Esplugues de Llobregat" && (f.blue || f.green) && byId["esplugues-regulated"]) {
    zonePolicy.scheduleSourceId = "esplugues-regulated";
    if (today.month === 8) temporaryRules.push({
      id: "esplugues-august", active: true, free: true, requiresTicket: false,
      sourceId: "esplugues-regulated",
      summary: "La página oficial de PROGESER indica que zonas azul y verde quedan fuera de servicio durante agosto."
    });
  }

  // Gavà
  if (city === "Gavà") {
    if (f.blue && byId["gava-blue"]) {
      const key = labelKey(environmentalLabel);
      const rate = key === "0" ? 0.01 : key === "ECO" ? 0.015 : 0.02;
      zonePolicy.priceText = `${rate.toFixed(3).replace(/0+$/, "").replace(/\.$/, "").replace(".", ",")} €/min`;
      zonePolicy.priceSourceId = "gava-blue";
    }
    if (f.green && byId["gava-green"]) zonePolicy.scheduleSourceId = "gava-green";
  }

  // Montgat
  if (city === "Montgat" && byId["montgat-parking"]) {
    zonePolicy.scheduleSourceId = "montgat-parking";
    const t = f.t;
    if (/express/.test(t)) {
      zonePolicy.priceText = "0 € · máximo 30 min";
      zonePolicy.priceSourceId = "montgat-parking";
      zonePolicy.requiresTicketWhenFree = true;
    }
    if (f.green) facts.push(sourceFact("montgat-parking", "Verde no significa una sola cosa", "Montgat diferencia verde exclusiva de residentes y verde preferente. En la exclusiva los no residentes no pueden estacionar; en la preferente pueden pagar 24 h."));
    if (f.blue) facts.push(sourceFact("montgat-parking", "Azul y temporada litoral", "La regulación azul cambia en las zonas próximas al litoral entre verano y el resto del año."));
  }

  // Sant Adrià
  if (city === "Sant Adrià de Besòs") {
    if (f.blue && byId["santadria-blue"]) {
      zonePolicy.scheduleSourceId = "santadria-blue";
      facts.push(sourceFact("santadria-blue", "Máximo zona azul", "EUSAB publica un máximo de 120 minutos para la zona azul principal y gratuidad sábados, domingos y festivos."));
    }
    if ((f.resident || /mixt/.test(f.t)) && byId["santadria-mixed"]) facts.push(sourceFact("santadria-mixed", "Zona mixta", "Pollancreda diferencia plazas preferentes de residentes y plazas de zona azul; el máximo de no residentes publicado es 180 minutos."));
  }

  // Sant Andreu de la Barca
  if (city === "Sant Andreu de la Barca" && f.blue && byId["santandreu-blue"]) {
    zonePolicy.scheduleSourceId = "santandreu-blue";
    zonePolicy.priceText = "No residente: 0,25 €/15 min → 2,65 €/120 min";
    zonePolicy.priceSourceId = "santandreu-blue";
    if (today.month === 8) temporaryRules.push({
      id: "santandreu-august", active: true, free: true, requiresTicket: false,
      sourceId: "santandreu-blue", summary: "La zona azul no presta servicio durante agosto."
    });
  }

  // Sant Boi
  if (city === "Sant Boi de Llobregat" && f.blue && byId["santboi-blue"]) {
    zonePolicy.scheduleSourceId = "santboi-blue";
    zonePolicy.priceText = "0,05 € / 10 min → 2,15 € / 160 min";
    zonePolicy.priceSourceId = "santboi-blue";
    if (today.month === 8) temporaryRules.push({
      id: "santboi-august", active: true, free: true, requiresTicket: true,
      sourceId: "santboi-blue", summary: "Del 1 al 31 de agosto la zona azul es de aparcamiento libre, pero el Ayuntamiento indica que debe obtenerse tique incluso con tarifa gratuita."
    });
  }

  // Sant Joan Despí
  if (city === "Sant Joan Despí" && byId["santjoan-regulated"]) {
    zonePolicy.scheduleSourceId = "santjoan-regulated";
    if (f.green) residentRules.push({
      id: "santjoan-green-resident", type: "resident-green", assignedAreaOnly: true,
      freeAssignedGreen: true, requiresTicket: true, sourceId: "santjoan-regulated",
      summary: "La zona verde para residentes requiere vehículo autorizado y validación."
    });
  }

  // Sant Just
  if (city === "Sant Just Desvern" && byId["santjust-parking"]) {
    zonePolicy.scheduleSourceId = "santjust-parking";
    if (f.blue) facts.push(sourceFact("santjust-parking", "Máximo azul", "Sant Just publica un máximo de 2 horas para zona azul."));
    if (f.green || f.orange) facts.push(sourceFact("santjust-parking", "Máximo extendido", "Sant Just publica hasta 9 horas para determinados usos verde no residente/naranja; el tramo concreto manda."));
  }

  // Sant Vicenç dels Horts
  if (city === "Sant Vicenç dels Horts" && f.blue && byId["santvicenc-blue"]) {
    zonePolicy.scheduleSourceId = "santvicenc-blue";
    if (today.month === 8) temporaryRules.push({
      id: "santvicenc-august", active: true, free: true, requiresTicket: false,
      sourceId: "santvicenc-blue", summary: "La página municipal indica que durante agosto no hay servicio de zona azul."
    });
  }

  // Santa Coloma
  if (city === "Santa Coloma de Gramenet" && f.blue && byId["santacoloma-parking"]) {
    zonePolicy.outsideScheduleFree = true;
    zonePolicy.scheduleSourceId = "santacoloma-parking";
    const key = labelKey(environmentalLabel);
    const amount = key === "0" ? 0 : key === "ECO" ? 0.675 : 1.35;
    zonePolicy.priceText = amount === 0 ? "0 €/h (0 emisiones; tique obligatorio)" : `${amount.toFixed(2).replace(".", ",")} €/h`;
    zonePolicy.priceSourceId = "santacoloma-parking";
    if (key === "0") zonePolicy.requiresTicketWhenFree = true;
  }

  // Viladecans
  if (city === "Viladecans" && byId["viladecans-zer"]) zonePolicy.scheduleSourceId = "viladecans-zer";
  if (city === "Viladecans" && today.year === 2026 && today.month === 8 && (f.blue || f.green || f.orange) && byId["viladecans-august-2026"]) {
    const beachLike = /platja|playa|litoral/.test(normalize(tram));
    if (!beachLike) temporaryRules.push({
      id: "viladecans-august-2026", active: true, free: true, requiresTicket: false,
      sourceId: "viladecans-august-2026",
      summary: "La publicación municipal de agosto de 2026 establece gratuidad en zonas urbanas azul, verde y naranja. La zona de playa queda fuera de esta excepción."
    });
    else facts.push(sourceFact("viladecans-august-2026", "Playa excluida", "La gratuidad urbana de agosto de 2026 no se aplica a la zona regulada de playa."));
  }

  return { facts, temporaryRules, residentRules, zonePolicy };
}

function filterSourceIds(city, zoneType) {
  const ids = registry.municipalitySourceMap[city] || [];
  const f = typeFlags(zoneType);
  return ids.filter((id) => {
    if (id === "barcelona-green") return f.green;
    if (id === "barcelona-blue") return f.blue;
    if (id === "barcelona-residents") return f.resident;
    if (id === "hospitalet-august-2026") return f.blue || f.green || f.dum;
    if (id === "badalona-blue") return f.blue;
    if (id === "badalona-artigues") return f.green;
    if (id === "castelldefels-blue") return f.blue;
    if (id === "castelldefels-green" || id === "castelldefels-authorizations") return f.green;
    if (id === "gava-green") return f.green;
    if (id === "gava-blue") return f.blue;
    if (id === "santadria-blue") return f.blue;
    if (id === "santadria-mixed") return f.resident || /mixt/.test(f.t);
    if (id === "santandreu-blue" || id === "santboi-blue" || id === "santvicenc-blue" || id === "santacoloma-parking") return f.blue;
    if (id === "viladecans-august-2026") return f.blue || f.green || f.orange;
    return true;
  });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const rawCity = searchParams.get("city") || "";
  const zoneType = searchParams.get("type") || "";
  const tram = searchParams.get("tram") || "";
  const tariff = searchParams.get("tariff") || "";
  const environmentalLabel = searchParams.get("label") || "UNKNOWN";
  const city = cityKey(rawCity);
  const today = madridNow();

  const wanted = [];
  if (registry.ambParkingMunicipalities.includes(city)) wanted.push("amb-parking");
  wanted.push(...filterSourceIds(city, zoneType));
  const sourceIds = [...new Set(wanted)];
  const loaded = (await Promise.all(sourceIds.map(readSource))).filter(Boolean);
  const derived = deriveRules(loaded, { city, zoneType, tram, tariff, environmentalLabel, today });
  const publicSources = loaded.map(({ text, ...source }) => source);

  return NextResponse.json({
    city, zoneType, localDate: today.iso, checkedAt: new Date().toISOString(),
    environmentalLabel,
    ambParkingIntegrated: registry.ambParkingMunicipalities.includes(city),
    metropolitanMunicipality: registry.metropolitanMunicipalities.includes(city),
    sources: publicSources,
    ...derived,
    policy: {
      warning: "Solo se aplican reglas cuya fuente oficial exacta respondió y superó la comprobación de contenido. La señalización física del tramo prevalece.",
      sourcePriority: ["Señalización física", "Ayuntamiento / operador municipal", "AMB", "DGT / BOE"]
    }
  }, { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" } });
}
