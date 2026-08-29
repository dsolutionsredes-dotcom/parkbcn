# ParkBCN V1

PWA móvil para visualizar zonas de estacionamiento regulado de Barcelona metropolitana usando la capa pública GIS de AMB.

## Incluye

- Mapa OpenStreetMap + Leaflet.
- GPS del móvil.
- Carga de tramos oficiales AMB por el área visible del mapa.
- Zona azul / verde con ciudad, horario, tarifa y tiempo máximo cuando AMB lo proporciona.
- Detección orientativa de la zona regulada más cercana.
- Botón **He aparcado aquí**.
- Temporizador basado en el tiempo máximo publicado por AMB.
- Aviso local 15 minutos antes mientras la PWA está activa.
- Comandos de voz básicos:
  - "He aparcado aquí"
  - "Parking libre aquí" / "Zona blanca"
  - "Dónde estoy"
- Puntos personales de parking libre guardados en `localStorage`.
- Manifest PWA.
- Dockerfile listo para EasyPanel.

## Fuente oficial inicial

AMB ArcGIS:
`https://ide.amb.cat/geoserveis/rest/services/plataforma_metropolitana_aparcament/MapServer/0`

La capa ofrece geometrías tipo línea y campos como:
`CIUTAT`, `TRAM`, `TRAM_TIPUS`, `TARIFA`, `HORARI`, `PREU_FRACCIO`, `TEMPS_MAX_HORES`, `TEMPS_MAX_MINUTS`, `PLACES`.

## Probar localmente

```bash
npm install
npm run dev
```

Abrir:
`http://localhost:3000`

Para GPS real desde móvil conviene desplegar con HTTPS.

## EasyPanel

1. Crear un repo nuevo en GitHub, por ejemplo `parkbcn`.
2. Subir este proyecto.
3. En EasyPanel: **Create Service > App > GitHub**.
4. Elegir el repo.
5. Build usando el `Dockerfile`.
6. Puerto interno: `3000`.
7. Añadir un dominio/subdominio y HTTPS.
8. Deploy.

No necesita base de datos en esta V1.

## Limitaciones V1

- AMB no representa necesariamente parking libre/no regulado, DUM, exclusivas residentes ni todas las prohibiciones.
- La detección de zona cercana es orientativa.
- El reconocimiento de voz depende del navegador.
- La notificación V1 funciona de forma fiable mientras la PWA sigue activa; push en segundo plano será parte de V2.
- La señalización física y normativa municipal prevalecen siempre.

## V2 recomendada

- PostgreSQL.
- Cuenta/perfil del conductor y permisos de residente.
- Reglas municipales y excepciones por fecha/horario.
- Web Push real en segundo plano.
- Sincronización de puntos personales con servidor.
- Integración de Open Data Barcelona y otras fuentes municipales.
- Motor para responder "¿puedo aparcar aquí ahora?".
