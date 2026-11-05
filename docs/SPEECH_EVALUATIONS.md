# Evaluaciones desde Speech analytic

- Solo Entel y plantilla No venta V1/V2. El usuario autenticado que confirma la carga es el evaluador.
- Confirmar importa el SA, el indice de evaluaciones, sus detalles y los feedbacks en una transaccion PostgreSQL. Un error revierte todo el lote.
- Identidad estable por archivo de audio normalizado. Reintentos, filas repetidas y versiones adicionales no crean otra evaluacion. No se sobrescribe una evaluacion previa ni se restaura una eliminada.
- Los analisis importados antes de esta funcionalidad generan sus evaluaciones al reimportar el Excel. La vista previa informa cuantos registros nuevos se crearan.
- Cada lote nuevo tiene una carpeta por fecha/hora de carga (Lima), identificador propio y marca SA. Los filtros existentes se aplican a su contenido.
- El dashboard recibe las evaluaciones por el indice habitual; los feedbacks vinculados no duplican su conteo. La fecha usada en el dashboard es la fecha de llamada, no la fecha de carga.

## Correspondencia PUE No venta

NV-1.1, 1.2, 2.1, 3.1, 3.2, 3.3 y 4.1 corresponden al mismo codigo PUE.
NV-5.1 corresponde a PUE 6.1; NV-6.1 y 6.2 a PUE 7.1 y 7.2.
NV-5.2 no prueba PUE 6.2 (tipificacion y sistemas): permanece pendiente de revision, no como Cumple ni No aplica.
La contratacion telefonica tiene peso cero en esta PUE No venta.
Se conservan evidencias y minutos; la nota original SA permanece separada. El calculo usa los pesos PUE existentes y excluye respuestas vacias y No aplica. La nota es provisional mientras existan criterios pendientes. Cero tolerancia reportada aplica nota cero con evidencia SA visible.

## Identidad y feedback

Solo se vinculan usuarios asesores activos de Entel por relacion explicita con Dotacion o nombre exacto no ambiguo. Sin coincidencia queda `pendingAdvisorCreation`, nombre original y alerta; no se crea un usuario ni se entrega el feedback a otro asesor.
La vinculacion posterior debe ser revisada; crear un homonimo no reasigna automaticamente registros pendientes.
Los feedbacks respetan el bloqueo del importador y reutilizan el flujo Pendiente de feedback / Aceptado por asesor / Feedback terminado y el SLA actual. Se conservan identificadores numericos compatibles con las acciones existentes.

## Verificacion

`npm test` incluye pruebas de correspondencia, permisos, identificadores, bloqueos y resultados.
`node scripts/verify-speech-flow.js --browser` usa tablas temporales en una conexion dedicada, el Excel de prueba indicado por `SPEECH_SAMPLE_XLSX`, las filas extraidas en `reference/speech/source-rows.json` y Playwright de `CODEX_NODE_MODULES`. Prueba rollback, reintentos, carpeta, ficha y conteo del dashboard sin escribir datos operativos permanentes.
