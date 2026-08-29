# ParkBCN V2.1

Corrección de V2 centrada en fiabilidad de fuentes, micrófono y legibilidad.

## Cambios principales

- **Fuentes oficiales contextuales:** solo se muestran enlaces que el servidor pudo abrir y cuyo contenido coincide con la regla esperada.
- **Sin “No disponible”:** una fuente caída, redirigida a un índice genérico o que requiera autenticación simplemente no aparece como hipervínculo.
- **L’Hospitalet:** se eliminó el enlace genérico al índice municipal. Se usan páginas directas de Zones AIRE / La Farga GEM (operador municipal), la publicación directa de gratuidad de agosto y la publicación específica de residentes.
- **Barcelona:** enlace directo a AREA Verde, AREA Azul o Exclusivas Residentes según el tipo de tramo.
- **Badalona:** enlace directo a Engestur para zona azul y a la publicación municipal de Artigues cuando corresponde a zona verde.
- **Resto de municipios:** si no hay una fuente municipal específica validada, se muestra únicamente la fuente AMB pertinente; no se inventa un enlace local.
- **Micrófono tap-to-talk:** nunca queda escuchando de forma continua. Se detiene tras el resultado, al volver a pulsar o automáticamente a los 8 segundos.
- **Mi perfil:** existe un solo perfil activo por dispositivo. Editarlo reemplaza el perfil actual; no crea otra persona.
- **Texto más grande:** se aumentó la legibilidad de tarjetas, reglas, fuentes y modales.
- **Guía de marcas:** el enlace estatal lleva directamente al Reglamento General de Circulación en BOE.

## Fuentes base

### Datos cartográficos

AMB ArcGIS:
`https://ide.amb.cat/geoserveis/rest/services/plataforma_metropolitana_aparcament/MapServer/0`

### L’Hospitalet

- Zones AIRE: `https://www.lafarga.com/corporatiu/estacionaments-regulats-hospitalet/`
- Gratuidad agosto: `https://www.lafarga.com/corporatiu/gratuitat-de-la-zona-blava-i-verda-durant-lagost/`
- Residentes zona verde: `https://www.lafarga.com/corporatiu/no-caldra-distintiu-per-aparcar-a-les-zones-verdes-com-a-resident/`

### Barcelona

- Verde: `https://areaverda.cat/es/informacion/tipos-de-plazas/area-verde`
- Azul: `https://areaverda.cat/es/informacion/tipos-de-plazas/area-azul`
- Exclusivas residentes: `https://areaverda.cat/es/tipo-de-plazas/exclusivas-para-residentes`

### Badalona

- Zona azul: `https://www.engestur.cat/es/services/zona-azul/`
- Zona verde Artigues: publicación municipal de 05/06/2026 incluida en el código.

### Normativa estatal de marcas

BOE · Reglamento General de Circulación, art. 171:
`https://www.boe.es/buscar/act.php?id=BOE-A-2003-23514#a171`

## EasyPanel

No cambia el despliegue:

- Dockerfile en raíz.
- Puerto interno `3000`.
- Subir archivos a `main` y pulsar **Implementar**.

## Nota de seguridad

ParkBCN resume información oficial, pero la señalización física del tramo y la normativa vigente prevalecen siempre.
