import { NextResponse } from "next/server";

const MUNICIPAL_LAYER =
  "https://ide.amb.cat/geoserveis/rest/services/EFluvials/OrtoRius/MapServer/0/query";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat/lng inválidos" }, { status: 400 });
  }

  const params = new URLSearchParams({
    where: "1=1",
    geometry: `${lng},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "nommuni,codi_ine",
    returnGeometry: "false",
    f: "json"
  });

  try {
    const response = await fetch(`${MUNICIPAL_LAYER}?${params.toString()}`, {
      next: { revalidate: 86400 },
      headers: { "User-Agent": "ParkBCN/0.3" }
    });
    if (!response.ok) throw new Error(`AMB respondió ${response.status}`);

    const data = await response.json();
    const feature = data?.features?.[0]?.attributes;

    return NextResponse.json(
      feature
        ? { name: feature.nommuni || null, ine: feature.codi_ine || null, source: "AMB" }
        : { name: null, ine: null, source: "AMB" },
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: "No se pudo identificar el municipio mediante AMB", detail: error.message },
      { status: 502 }
    );
  }
}
