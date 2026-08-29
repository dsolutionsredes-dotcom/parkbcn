import { NextResponse } from "next/server";

const SOURCES = {
  ambParking: {
    id: "amb-parking",
    name: "AMB · Aparcament Metropolità",
    authority: "Àrea Metropolitana de Barcelona",
    url: "https://www.amb.cat/es/web/mobilitat/mobilitat-sostenible/zones-d-estacionament/aparcament/informacio-de-servei",
    role: "Información metropolitana de estacionamiento regulado",
    mustContain: ["aparcament", "tiempo máximo"]
  },
  hospitaletAire: {
    id: "hospitalet-aire",
    name: "Zones AIRE · L’Hospitalet",
    authority: "La Farga GEM · operador municipal",
    url: "https://www.lafarga.com/corporatiu/estacionaments-regulats-hospitalet/",
    role: "Horarios y regulación de zonas AIRE",
    mustContain: ["zones aire", "horaris"]
  },
  hospitaletAugust: {
    id: "hospitalet-august",
    name: "Gratuidad azul y verde en agosto",
    authority: "La Farga GEM · operador municipal",
    url: "https://www.lafarga.com/corporatiu/gratuitat-de-la-zona-blava-i-verda-durant-lagost/",
    role: "Excepción temporal de agosto",
    detectPublishedDate: true,
    mustContain: ["agost", "zona blava", "zona verda"]
  },
  hospitaletResident: {
    id: "hospitalet-resident",
    name: "Zona verde para residentes",
    authority: "La Farga GEM · operador municipal",
    url: "https://www.lafarga.com/corporatiu/no-caldra-distintiu-per-aparcar-a-les-zones-verdes-com-a-resident/",
    role: "Condiciones de residente en zona verde",
    detectPublishedDate: true,
    mustContain: ["zona verda", "tiquet"]
  },
  barcelonaGreen: {
    id: "barcelona-green",
    name: "AREA Barcelona · Plazas verdes",
    authority: "Ajuntament de Barcelona / B:SM",
    url: "https://areaverda.cat/es/informacion/tipos-de-plazas/area-verde",
    role: "Condiciones, horarios y tarifas de AREA Verde",
    mustContain: ["residentes autorizados", "zona asignada"]
  },
  barcelonaBlue: {
    id: "barcelona-blue",
    name: "AREA Barcelona · Plazas azules",
    authority: "Ajuntament de Barcelona / B:SM",
    url: "https://areaverda.cat/es/informacion/tipos-de-plazas/area-azul",
    role: "Condiciones, horarios y tarifas de AREA Azul",
    mustContain: ["estacionamiento máximo", "tarifas azul"]
  },
  badalonaBlue: {
    id: "badalona-blue",
    name: "Badalona · Zona azul",
    authority: "Engestur · empresa municipal",
    url: "https://www.engestur.cat/es/services/zona-azul/",
    role: "Horarios, tarifas y control de la zona azul",
    mustContain: ["zona azul", "horario"]
  },
  badalonaGreen: {
    id: "badalona-green-artigues",
    name: "Badalona · Zona verde de Artigues",
    authority: "Ajuntament de Badalona",
    url: "https://www.badalona.cat/ca/actualitat/noticies/el-barri-dartigues-es-el-primer-de-badalona-que-comptara-amb-zona-verda-daparcament-per-a-residents-en-una-decisio-consensuada-amb-els-veins",
    role: "Publicación municipal sobre la zona verde de Artigues",
    detectPublishedDate: true,
    mustContain: ["artigues", "zona verda"]
  },
  barcelonaResidents: {
    id: "barcelona-residents",
    name: "AREA Barcelona · Exclusivas residentes",
    authority: "Ajuntament de Barcelona / B:SM",
    url: "https://areaverda.cat/es/tipo-de-plazas/exclusivas-para-residentes",
    role: "Plazas exclusivas, horarios y excepciones 24 h",
    mustContain: ["exclusivas residentes", "24 horas"]
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

function firstPublishedDate(text = "") {
  const match = text.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  return match ? match[0] : null;
}

async function readSource(source) {
  try {
    const response = await fetch(source.url, {
      next: { revalidate: 1800 },
      headers: { "User-Agent": "ParkBCN/0.2.1 (+official-source-check)" }
    });

    if (!response.ok) return null;
    if (/login|signin|oauth|autentic|carpeta.?ciutadana/i.test(response.url || "")) return null;

    const html = await response.text();
    const text = stripHtml(html);
    const normalizedText = normalize(text);
    const expected = source.mustContain || [];
    const hasExpectedContent = expected.every((phrase) =>
      normalizedText.includes(normalize(phrase))
    );
    if (expected.length && !hasExpectedContent) return null;

    return {
      ...source,
      available: true,
      checkedAt: new Date().toISOString(),
      publishedDate: source.detectPublishedDate ? firstPublishedDate(text) : null,
      text
    };
  } catch {
    return null;
  }
}

function hospitaletFacts(byId, today) {
  const facts = [];
  const temporaryRules = [];
  const residentRules = [];

  const august = byId["hospitalet-august"];
  if (august) {
    const text = normalize(august.text);
    const publishedYear = august.publishedDate
      ? Number(august.publishedDate.split("/")[2])
      : today.year;
    const confirmsAugust =
      text.includes("1 al 31") &&
      text.includes("agost") &&
      text.includes("zona") &&
      (text.includes("blava") || text.includes("azul")) &&
      (text.includes("verda") || text.includes("verde")) &&
      (text.includes("gratuit") || text.includes("gratu"));

    if (confirmsAugust) {
      temporaryRules.push({
        id: `hospitalet-august-free-${publishedYear}`,
        title: "Gratuidad especial de agosto",
        appliesTo: ["zona blava", "zona verda", "zona azul", "zona verde"],
        excludes: ["carga y descarga", "carrega i descarrega", "dum", "zona groga", "zona amarilla"],
        free: true,
        start: `${publishedYear}-08-01`,
        end: `${publishedYear}-08-31`,
        active:
          publishedYear === today.year &&
          today.month === 8 &&
          today.day >= 1 &&
          today.day <= 31,
        publishedDate: august.publishedDate,
        sourceId: august.id,
        summary:
          "Del 1 al 31 de agosto las zonas azul y verde de L’Hospitalet son gratuitas. La zona DUM/carga y descarga sigue regulada."
      });
      facts.push({
        id: "hospitalet-august-fact",
        title: "Excepción de agosto",
        text:
          "La publicación oficial del operador municipal confirma la gratuidad temporal de las zonas azul y verde durante agosto; no incluye DUM.",
        publishedDate: august.publishedDate,
        sourceId: august.id
      });
    }
  }

  const resident = byId["hospitalet-resident"];
  if (resident) {
    const text = normalize(resident.text);
    const freeAssigned =
      text.includes("aparcar gratu") &&
      (text.includes("zona verda que") || text.includes("zona verde que"));
    const requiresTicket = text.includes("tiquet gratu") || text.includes("ticket gratu");
    const weekdayHours = text.includes("8 a 20") && text.includes("dilluns a divendres");

    if (freeAssigned) {
      residentRules.push({
        id: "hospitalet-resident-green",
        municipality: "L'Hospitalet de Llobregat",
        type: "resident-green",
        freeAssignedGreen: true,
        assignedAreaOnly: true,
        blueBonus: false,
        requiresTicket,
        weekdayHours: weekdayHours ? "08:00–20:00, lunes a viernes" : null,
        sourceId: resident.id,
        summary:
          "La gratuidad de residente se aplica a la zona verde que corresponde al residente; sigue siendo necesario obtener el tique gratuito cuando proceda."
      });
      facts.push({
        id: "hospitalet-resident-fact",
        title: "Residente en zona verde",
        text:
          "La autorización de residente no convierte en gratuita cualquier zona verde de L’Hospitalet: se aplica a la zona que corresponde al residente.",
        publishedDate: resident.publishedDate,
        sourceId: resident.id
      });
    }
  }

  return { temporaryRules, residentRules, facts };
}

function barcelonaFacts(byId, zoneType) {
  const facts = [];
  const residentRules = [];
  const kind = normalize(zoneType);

  const green = byId["barcelona-green"];
  if (green && (kind.includes("verd") || kind.includes("green"))) {
    const text = normalize(green.text);
    const residentAssigned = text.includes("zona asignada") && text.includes("0,20");
    const freeOutsideHours = text.includes("fuera de este horario") && text.includes("libre");
    if (residentAssigned) {
      residentRules.push({
        id: "barcelona-resident-green",
        municipality: "Barcelona",
        type: "resident-green",
        freeAssignedGreen: false,
        assignedAreaOnly: true,
        residentDailyPrice: "0,20 €/día",
        requiresTicket: true,
        sourceId: green.id,
        summary:
          "En Barcelona el residente autorizado obtiene tarifa reducida solo en su zona asignada; fuera de ella se aplica la tarifa de no residente."
      });
    }
    facts.push({
      id: "barcelona-green-fact",
      title: "AREA Verde",
      text: freeOutsideHours
        ? "AREA indica que fuera del horario de regulación el estacionamiento verde es libre, salvo condiciones específicas señalizadas en el tramo."
        : "AREA Verde depende del horario y señalización específica del tramo.",
      sourceId: green.id
    });
  }

  const blue = byId["barcelona-blue"];
  if (blue && (kind.includes("blav") || kind.includes("azul") || kind.includes("blue"))) {
    facts.push({
      id: "barcelona-blue-fact",
      title: "AREA Azul",
      text:
        "El horario y el tiempo máximo dependen del tramo; AREA indica que siempre debe comprobarse la señalización vertical específica.",
      sourceId: blue.id
    });
  }

  const residents = byId["barcelona-residents"];
  if (residents && kind.includes("resident")) {
    const text = normalize(residents.text);
    if (text.includes("20:00 a 8:00") || text.includes("20:00 a 08:00")) {
      facts.push({
        id: "barcelona-residents-night",
        title: "Exclusiva residentes con horario",
        text:
          "En las zonas exclusivas reguladas de 8:00 a 20:00, AREA permite a no residentes estacionar libremente de 20:00 a 8:00, salvo condiciones específicas.",
        sourceId: residents.id
      });
    }
    if (text.includes("24 horas") && (text.includes("barceloneta") || text.includes("born"))) {
      facts.push({
        id: "barcelona-residents-24h",
        title: "Exclusividad 24 horas",
        text:
          "AREA publica zonas con exclusividad de residentes durante 24 horas, entre ellas ámbitos de Barceloneta y Born.",
        sourceId: residents.id
      });
    }
  }

  return { facts, residentRules };
}

function publicSource(source) {
  if (!source) return null;
  const { text, ...safe } = source;
  return safe;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const city = searchParams.get("city") || "";
  const zoneType = searchParams.get("type") || "";
  const residentProfile = searchParams.get("resident") === "1";
  const normalizedCity = normalize(city);
  const normalizedType = normalize(zoneType);
  const today = madridDateParts();

  const wanted = [];

  if (normalizedCity.includes("hospitalet")) {
    wanted.push(SOURCES.hospitaletAire);
    if (residentProfile && (normalizedType.includes("verd") || normalizedType.includes("green"))) {
      wanted.push(SOURCES.hospitaletResident);
    }
    if (
      today.month === 8 &&
      (normalizedType.includes("verd") ||
        normalizedType.includes("blav") ||
        normalizedType.includes("verde") ||
        normalizedType.includes("azul"))
    ) {
      wanted.push(SOURCES.hospitaletAugust);
    }
  } else if (normalizedCity === "barcelona" || normalizedCity.includes("barcelona ciutat")) {
    if (normalizedType.includes("verd") || normalizedType.includes("green")) {
      wanted.push(SOURCES.barcelonaGreen);
    } else if (
      normalizedType.includes("blav") ||
      normalizedType.includes("azul") ||
      normalizedType.includes("blue")
    ) {
      wanted.push(SOURCES.barcelonaBlue);
    } else if (normalizedType.includes("resident")) {
      wanted.push(SOURCES.barcelonaResidents);
    }
  } else if (normalizedCity.includes("badalona")) {
    if (normalizedType.includes("verd") || normalizedType.includes("green")) {
      wanted.push(SOURCES.badalonaGreen);
    } else if (
      normalizedType.includes("blav") ||
      normalizedType.includes("azul") ||
      normalizedType.includes("blue")
    ) {
      wanted.push(SOURCES.badalonaBlue);
    } else {
      wanted.push(SOURCES.ambParking);
    }
  } else {
    wanted.push(SOURCES.ambParking);
  }

  const unique = [...new Map(wanted.map((item) => [item.id, item])).values()];
  const loaded = (await Promise.all(unique.map(readSource))).filter(Boolean);
  const byId = Object.fromEntries(loaded.map((source) => [source.id, source]));

  const hospitalet = hospitaletFacts(byId, today);
  const barcelona = barcelonaFacts(byId, zoneType);

  return NextResponse.json(
    {
      city,
      zoneType,
      localDate: today.iso,
      checkedAt: new Date().toISOString(),
      temporaryRules: hospitalet.temporaryRules,
      residentRules: [...hospitalet.residentRules, ...barcelona.residentRules],
      facts: [...hospitalet.facts, ...barcelona.facts],
      sources: loaded.map(publicSource),
      policy: {
        warning:
          "ParkBCN solo muestra fuentes oficiales que pudo comprobar en esta consulta. Si una fuente no responde o no es específica para la regla, no se muestra como enlace.",
        sourcePriority: [
          "Señalización física del tramo",
          "Ayuntamiento / operador municipal",
          "AMB cuando corresponda",
          "Normativa estatal"
        ]
      }
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600"
      }
    }
  );
}
