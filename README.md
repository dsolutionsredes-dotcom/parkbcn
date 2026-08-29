# ParkBCN V2

PWA móvil para consultar estacionamiento regulado en Barcelona metropolitana con datos GIS de AMB y comprobación de fuentes oficiales.

## Qué añade V2

- Perfil local de residente: municipio, zona/barrio autorizado y matrícula opcional.
- La app no presupone que ser residente de un municipio te autorice en todas sus zonas. En L'Hospitalet puede confirmarse un tramo conocido como parte de la zona residente asignada.
- Panel de decisión resumida: gratis ahora / regulado / residentes / regulación especial / no identificado.
- Fuentes oficiales en una ventana **ⓘ Más info** con enlace directo y fecha de comprobación.
- Consulta en vivo del Ayuntamiento de L'Hospitalet, AREA Barcelona, AMB y BOE según el municipio.
- Detección de excepciones temporales publicadas en la fuente oficial, empezando por la gratuidad de agosto de L'Hospitalet cuando está vigente.
- Modo conducción con seguimiento GPS y Screen Wake Lock cuando el navegador lo permite.
- Al iniciar un aparcamiento desaparece el botón **He aparcado aquí** para evitar reiniciar el contador accidentalmente.
- Guía rápida de colores y marcas mediante **ⓘ**.
- Colores AMB ampliados: verde, azul, naranja y rojo.
- Parking libre personal sigue guardándose como referencia local.

## Datos oficiales

### Geometría de zonas reguladas

AMB ArcGIS:
`https://ide.amb.cat/geoserveis/rest/services/plataforma_metropolitana_aparcament/MapServer/0`

Campos usados:
`CIUTAT`, `TRAM`, `TRAM_ID`, `TRAM_TIPUS`, `TARIFA`, `HORARI`, `PREU_FRACCIO`, `TEMPS_MAX_HORES`, `TEMPS_MAX_MINUTS`, `PLACES`.

### Fuentes de reglas

El endpoint `/api/official?city=...` consulta una lista cerrada de fuentes oficiales para evitar depender de blogs o agregadores:

- Ajuntament de L'Hospitalet.
- AREA Barcelona / Ajuntament de Barcelona / B:SM.
- Àrea Metropolitana de Barcelona.
- BOE para normativa estatal de circulación.

Las páginas se vuelven a comprobar periódicamente desde el servidor. Si una fuente no responde, la app lo indica y no inventa una regla.

## Seguridad de la decisión

Orden de prioridad mostrado al usuario:

1. Señalización física del tramo.
2. Ayuntamiento u operador municipal.
3. AMB cuando corresponda.
4. Normativa estatal DGT/BOE.

ParkBCN es un asistente y no sustituye el tique, permiso o validación oficial.

## EasyPanel

La V2 mantiene el mismo despliegue que V1:

- Dockerfile en la raíz.
- Puerto interno `3000`.
- `npm run build` y `npm start`.

Tras subir los archivos a la rama `main`, en EasyPanel basta con **Implementar** de nuevo.

## Limitaciones V2

- El perfil de residente necesita que el usuario indique su zona autorizada; la app no puede deducir el alcance legal solo por municipio.
- Para municipios sin parser específico, se utilizan los datos AMB y las fuentes oficiales generales; las excepciones municipales se irán añadiendo de forma incremental.
- El aviso local de 15 minutos sigue dependiendo de que el navegador/PWA permanezca operativo. Web Push en segundo plano queda para una versión posterior.
- El parking libre guardado por el usuario es una referencia personal, no una certificación municipal.
