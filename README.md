# ParkBCN V3

PWA móvil para consultar aparcamiento regulado en el área metropolitana de Barcelona con prioridad a fuentes oficiales.

## Cambios V3

- Reconoce dinámicamente el municipio mediante una **capa oficial de límites de AMB** (36 municipios metropolitanos).
- Mantiene el feed de tramos regulados oficial de **AMB Aparcament Metropolità** para los municipios integrados en esa plataforma.
- Catálogo central de fuentes en `data/official-sources.json`; la interfaz no tiene URLs municipales dispersas.
- Las páginas oficiales se comprueban en servidor antes de mostrarse. Si no responden o no contienen el contenido esperado, **no aparece hipervínculo**.
- Fuentes directas verificadas para Barcelona, L'Hospitalet, Badalona, El Prat, Sant Joan Despí, Sant Just, Santa Coloma, Esplugues, Castelldefels, Montgat y Sant Boi, además de AMB.
- Reglas temporales que se pueden detectar desde fuentes oficiales, por ejemplo gratuidad de agosto donde exista publicación vigente.
- Perfil único de residente en el dispositivo; editarlo reemplaza el perfil actual.
- Modo conducción con `watchPosition`, Wake Lock y mapa que sigue el GPS.
- Si el usuario mueve manualmente el mapa durante conducción, el seguimiento se pausa y aparece **Volver a seguirme**.
- Panel inferior con tres alturas: `peek`, `compact`, `expanded`; se desliza desde el tirador sin interferir con el mapa.
- Al aparcar, el panel queda minimizado y el botón “He aparcado aquí” deja de estar disponible.
- Micrófono `tap-to-talk`: nunca queda escuchando de forma continua; se apaga al terminar la frase, al tocarlo de nuevo o tras 7 segundos.
- Tipografía móvil aumentada.
- Interpretación conservadora de horarios: solo muestra “fuera del horario publicado” cuando el formato puede interpretarse con suficiente seguridad.

## Cobertura y límites reales

AMB enumera 36 municipios metropolitanos. ParkBCN V3 puede identificar jurisdicción dentro de esos 36 mediante la capa municipal oficial.

El servicio AMB Aparcament Metropolità publica actualmente información de estacionamiento regulado para 11 municipios: Barcelona, L'Hospitalet, Badalona, El Prat, Sant Joan Despí, Sant Just Desvern, Santa Coloma de Gramenet, Esplugues de Llobregat, Castelldefels, Montgat y Sant Boi de Llobregat.

Por tanto, **identificar el municipio no significa que exista un mapa oficial de tramos regulados para todos los 36**. V3 muestra “sin tramo AMB” cuando no existe esa evidencia, en lugar de inventar una regla.

## Despliegue

Mismo despliegue que V2:

- Dockerfile en raíz.
- Puerto interno: `3000`.
- No hay que cambiar el dominio ni el servicio de EasyPanel.
- Subir/commit al repo y volver a **Implementar**.

## Siguiente evolución recomendada

1. PostgreSQL para persistir catálogo de reglas/fuentes, versiones e historial de cambios.
2. Job programado para revisar fuentes oficiales y crear versiones de las reglas.
3. Push real en segundo plano para avisos de finalización.
4. Integración ZBE/etiqueta ambiental del vehículo.
5. Incidencias temporales/obras cuando cada ayuntamiento publique un feed oficial utilizable.
6. Aparcamientos públicos alternativos y ocupación en tiempo real cuando exista API oficial.

La señalización física del tramo siempre prevalece.
