# ParkBCN V3.1

Actualización segura sobre V3 enfocada en **“¿puedo aparcar aquí ahora y cuánto cuesta?”**.

## Cambios V3.1

- Perfil con distintivo ambiental DGT: `0 / ECO / C / B / sin distintivo / no lo sé`.
- Valor inicial para este dispositivo: **B**.
- Se separa **Tarifa** de **Precio ahora**.
- Solo muestra “De pago ahora” cuando el horario del tramo puede interpretarse como activo.
- Solo muestra “Gratis ahora” si existe una regla oficial exacta que lo permite o una excepción oficial vigente.
- Si el horario está fuera de servicio pero la fuente no confirma libertad de estacionamiento, muestra **No confirmado**, no “gratis”.
- Excepciones por fecha: L’Hospitalet agosto 2026, Viladecans agosto 2026, y reglas recurrentes de agosto verificadas en Esplugues, Sant Andreu de la Barca, Sant Boi y Sant Vicenç dels Horts.
- Tarifas ambientales oficiales de Barcelona; ParkBCN usa el distintivo del perfil cuando puede identificar Tarifa A/B/Gremis.
- Más fuentes municipales exactas: Cornellà, Gavà, Sant Adrià, Sant Andreu, Sant Vicenç y Viladecans, además de las ya incluidas.
- Las URLs se validan en servidor. Si una página oficial no responde, redirige a login o deja de contener las frases esperadas, **no se muestra ni se usa**.
- Las páginas generales de inicio no se usan como prueba de una regla concreta.
- Fuentes oficiales se revalidan periódicamente en servidor (caché 6 h). Las reglas siguen siendo deterministas; no se usa un LLM para decidir legalidad.

## Fuentes

Prioridad de ParkBCN:

1. Señalización física del tramo.
2. Ayuntamiento / operador municipal oficial.
3. AMB / GIS oficial.
4. DGT / BOE para reglas generales.

La ausencia de una fuente exacta **no se interpreta como permiso para aparcar**.

## Deploy

Mismo procedimiento que V3:

- mismo repositorio GitHub;
- mismo Dockerfile;
- mismo puerto interno `3000`;
- EasyPanel → Implementar.

No requiere una base de datos todavía. El siguiente salto (V4) sería PostgreSQL + sincronizador programado de reglas/fuentes.
