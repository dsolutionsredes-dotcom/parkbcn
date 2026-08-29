import { NextResponse } from "next/server";

const AMB_LAYER =
  "https://ide.amb.cat/geoserveis/rest/services/plataforma_metropolitana_aparcament/MapServer/0/query";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const bbox = searchParams.get("bbox");

  if (!bbox) {
    return NextResponse.json(
      { error: "Falta bbox=minLon,minLat,maxLon,maxLat" },
      { status: 400 }
    );
  }

  const parts = bbox.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
    return NextResponse.json({ error: "bbox inválido" }, { status: 400 });
  }

  const params = new URLSearchParams({
    where: "1=1",
    outFields:
      "OBJECTID,CIUTAT,TRAM,TRAM_ID,TRAM_TIPUS,TARIFA,HORARI,PREU_FRACCIO,TEMPS_MAX_HORES,TEMPS_MAX_MINUTS,PLACES",
    returnGeometry: "true",
    geometry: parts.join(","),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    outSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    resultRecordCount: "2000",
    f: "geojson"
  });

  try {
    const response = await fetch(`${AMB_LAYER}?${params.toString()}`, {
      next: { revalidate: 300 },
      headers: { "User-Agent": "ParkBCN/0.1" }
    });

    if (!response.ok) {
      throw new Error(`AMB respondió ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600"
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: "No se pudieron cargar los datos de AMB", detail: error.message },
      { status: 502 }
    );
  }
}
