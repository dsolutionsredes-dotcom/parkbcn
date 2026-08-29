import { NextResponse } from "next/server";

const SOURCES = {
  ambParking: {
    id: "amb-parking",
    name: "AMB Aparcament Metropolità",
    authority: "Àrea Metropolitana de Barcelona",
    url: "https://www.amb.cat/es/web/mobilitat/mobilitat-sostenible/zones-d-estacionament/aparcament/informacio-de-servei"
  },
  ambResidents: {
    id: "amb-residents",
    name: "AMB Aparcament Residents",
    authority: "Àrea Metropolitana de Barcelona",
    url: "https://www.amb.cat/es/web/mobilitat/mobilitat-sostenible/zones-d-estacionament/residents/informacio-del-servei"
  },
  hospitalet: {
    id: "hospitalet",
    name: "Ajuntament de L’Hospitalet",
    authority: "Ajuntament de L’Hospitalet de Llobregat",
    url: "https://www.l-h.cat/"
  },
  hospitaletGreen: {
    id: "hospitalet-green",
    name: "Zona Verda per a Residents",
    authority: "Ajuntament de L’Hospitalet de Llobregat",
    url: "https://seuelectronica.l-h.cat/utils/obreFitxerNG19.aspx?2v1zBvnUIsqlyCT3w9kYzZqazCqHXZgdLnZt8OCkwl5otwqazB="
  },
  barcelonaResidents: {
    id: "barcelona-residents",
    name: "AREA Barcelona · Exclusivas residentes",
    authority: "Ajuntament de Barcelona / B:SM",
    url: "https://areaverda.cat/es/tipo-de-plazas/exclusivas-para-residentes"
  },
  barcelonaGeneral: {
    id: "barcelona-area",
    name: "AREA Barcelona",
    authority: "Ajuntament de Barcelona / B:SM",
    url: "https://areaverda.cat/es/informacion"
  },
  boe: {
    id: "boe",
    name: "Reglamento General de Circulación",
    authority: "BOE · Estado",
    url: "https://www.boe.es/buscar/act.php?id=BOE-A-2003-23514"
  }
};

function normalize(value = "") {
  return value
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
    .replace(/&iuml;/gi, "ï")
    .replace(/\s+/g, " ")
    .trim();
}

function madridDateParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value;

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    iso: `${get("year")}-${get("month")}-${get("day")}`
  };
}

function nearestPublishedDate(text, marker) {
  const normalized = normalize(text);
  const markerIndex = normalized.indexOf(normalize(marker));
  if (markerIndex < 0) return null;

  const start = Math.max(0, markerIndex - 1400);
  const end = Math.min(text.length, markerIndex + 400);
  const sample = text.slice(start, end);
  const matches = [...sample.matchAll(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g)];
  return matches.length ? matches[matches.length - 1][0] : null;
}

async function readSource(source) {
  try {
    const response = await fetch(source.url, {
      next: { revalidate: 1800 },
      headers: { "User-Agent": "ParkBCN/0.2 (+official-rules-check)" }
    });

    if (!response.ok) {
      return { ...source, available: false, status: response.status, text: "" };
    }

    const html = await response.text();
    return {
      ...source,
      available: true,
      status: response.status,
      text: stripHtml(html)
    };
  } catch (error) {
    return {
      ...source,
      available: false,
      status: 0,
      error: error.message,
      text: ""
    };
  }
}

function hospitaletFacts(source, today) {
  if (!source?.available) return { temporaryRules: [], facts: [] };

  const text = normalize(source.text);
  const mentionsAugustFree =
    text.includes("zones d'aparcament blava i verda") &&
    text.includes("agost") &&
    (text.includes("gratuites") || text.includes("gratuïtes"));

  const publishedDate = nearestPublishedDate(
    source.text,
    "zones d’aparcament blava i verda"
  );
  const publishedYear = publishedDate
    ? Number(publishedDate.split("/")[2])
    : today.year;

  const active =
    mentionsAugustFree &&
    publishedYear === today.year &&
    today.month === 8 &&
    today.day >= 1 &&
    today.day <= 31;

  const temporaryRules = mentionsAugustFree
    ? [
        {
          id: `hospitalet-august-free-${publishedYear}`,
          title: "Gratuidad especial de agosto",
          appliesTo: ["zona blava", "zona verda", "zona azul", "zona verde"],
          excludes: ["carga y descarga", "carrega i descarrega", "dum"],
          free: true,
          start: `${publishedYear}-08-01`,
          end: `${publishedYear}-08-31`,
          active,
          publishedDate,
          sourceId: source.id,
          summary:
            "La fuente municipal publica gratuidad de las zonas azul y verde durante agosto; no se aplica a carga y descarga."
        }
      ]
    : [];

  return {
    temporaryRules,
    facts: mentionsAugustFree
      ? [
          {
            id: "hospitalet-august",
            title: "Excepción temporal detectada",
            text: "La fuente oficial municipal contiene una gratuidad de agosto para zonas azul y verde.",
            publishedDate,
            sourceId: source.id
          }
        ]
      : []
  };
}

function hospitaletResidentFacts(source) {
  if (!source?.available) return { residentRules: [], facts: [] };
  const text = normalize(source.text);
  const greenFree =
    text.includes("zona verda") &&
    (text.includes("100% bonificada") || text.includes("100 % bonificada"));
  const assignedOnly =
    text.includes("altre barri") ||
    text.includes("otro barrio") ||
    text.includes("barri que tens assignat") ||
    text.includes("barrio que tienes asignado");
  const blueNoBonus =
    text.includes("zona blava") &&
    (text.includes("no. la bonificacio") || text.includes("no hi ha bonificacio") || text.includes("bonificacio nomes"));
  const requiresTicket =
    text.includes("tiquet") || text.includes("ticket") || text.includes("parquimetre");

  const residentRules = greenFree
    ? [{
        id: "hospitalet-resident-green",
        type: "resident-green",
        freeAssignedGreen: true,
        assignedAreaOnly: assignedOnly,
        blueBonus: !blueNoBonus,
        requiresTicket,
        sourceId: source.id,
        summary: "Residentes autorizados tienen bonificación del 100 % en la zona verde que les corresponde; fuera de su zona deben pagar la tarifa aplicable."
      }]
    : [];

  return {
    residentRules,
    facts: greenFree
      ? [{
          id: "hospitalet-resident-green-fact",
          title: "Residente de L’Hospitalet",
          text: "La fuente municipal indica bonificación del 100 % en la zona verde asignada al barrio del residente. No se extiende automáticamente a otras zonas y la zona azul no tiene esa bonificación.",
          sourceId: source.id,
          publishedDate: "20/03/2026"
        }]
      : []
  };
}

function barcelonaFacts(source) {
  if (!source?.available) return [];
  const text = normalize(source.text);
  const facts = [];

  if (text.includes("20:00 a 8:00") || text.includes("20:00 a 08:00")) {
    facts.push({
      id: "bcn-resident-night",
      title: "Exclusivas residentes con horario 8–20",
      text:
        "AREA indica que, en zonas exclusivas de residentes reguladas de 8:00 a 20:00, los no residentes pueden estacionar libremente de 20:00 a 8:00, salvo condiciones específicas del tramo.",
      sourceId: source.id
    });
  }

  if (
    text.includes("24 horas") &&
    (text.includes("barceloneta") || text.includes("born"))
  ) {
    facts.push({
      id: "bcn-resident-24h",
      title: "Exclusividad 24 horas",
      text:
        "AREA advierte de zonas de exclusividad para residentes durante 24 horas en ámbitos de Ciutat Vella como Barceloneta y Born.",
      sourceId: source.id
    });
  }

  return facts;
}

function publicSource(source) {
  const { text, ...safe } = source;
  return safe;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const city = searchParams.get("city") || "";
  const normalizedCity = normalize(city);
  const today = madridDateParts();

  const wanted = [SOURCES.ambParking, SOURCES.ambResidents, SOURCES.boe];

  if (normalizedCity.includes("hospitalet")) {
    wanted.unshift(SOURCES.hospitalet, SOURCES.hospitaletGreen);
  }

  if (normalizedCity === "barcelona" || normalizedCity.includes("barcelona ciutat")) {
    wanted.unshift(SOURCES.barcelonaResidents, SOURCES.barcelonaGeneral);
  }

  const loaded = await Promise.all(wanted.map(readSource));
  const byId = Object.fromEntries(loaded.map((source) => [source.id, source]));
  const hospitalet = hospitaletFacts(byId.hospitalet, today);
  const hospitaletResident = hospitaletResidentFacts(byId["hospitalet-green"]);

  return NextResponse.json(
    {
      city,
      localDate: today.iso,
      checkedAt: new Date().toISOString(),
      temporaryRules: hospitalet.temporaryRules,
      residentRules: hospitaletResident.residentRules,
      facts: [
        ...hospitalet.facts,
        ...hospitaletResident.facts,
        ...barcelonaFacts(byId["barcelona-residents"])
      ],
      sources: loaded.map(publicSource),
      policy: {
        sourcePriority: [
          "Señalización física del tramo",
          "Ayuntamiento / operador municipal",
          "AMB cuando corresponda",
          "Normativa estatal DGT/BOE"
        ],
        warning:
          "ParkBCN resume fuentes oficiales. Si hay discrepancia, prevalece la señalización del tramo y la normativa vigente."
      }
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600"
      }
    }
  );
}
