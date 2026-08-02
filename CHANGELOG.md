# Changelog

## Unreleased

## 0.1.0 - 2026-08-02

- Frontera formalizada entre core público MIT y plataforma comercial privada.
- Titular de copyright y política de marca documentados antes de la publicación.
- Historial efímero opt-in de runs/jobs de GitHub Actions.
- Inputs `history`, `history-window-days` y `history-sample-runs` con límites.
- Permiso condicional `actions: read` y fallback seguro al análisis estático.
- Proyección mensual esperada `mean/run × frequency` y sensibilidades at-run-p50/p95.
- Escenario proposed omitido cuando los triggers hacen incomparable la frecuencia.
- Reintentos históricos incluidos y muestras parciales/desconocidas excluidas.
- Muestreo run-weighted en hasta cinco buckets temporales.
- Paginación acotada a 200 jobs por run y cobertura completa obligatoria.
- Proposed/delta omitidos ante matrices estáticas aproximadas.
- Estado de fallback histórico visible en Markdown/JSON.
- Presupuesto global de 120 requests históricos por ejecución.
- Escape de Markdown controlado por workflows.
- Clasificación segura de renames hacia/desde `.github/workflows`.
- Cálculos internos en micro-USD y confianza limitada a `medium` durante beta.
- Diagnósticos históricos agregados sin identificadores ni labels crudos.
- Runs completos sin jobs o con todos los jobs skipped contabilizados como costo cero.
- Jobs cancelados sin duración positiva contabilizados como costo cero.
- Permiso mínimo de PR corregido a `pull-requests: read`; `write` queda reservado para comentarios.
- Lectura del workflow head de forks mediante el repositorio base y el SHA inmutable del evento.
- Laboratorio consumidor reproducible con escenarios normal, matriz/macOS y expansión de triggers.
- Smoke test integral del bundle contra una API GitHub simulada: PR, forks, historial, fallback 403 y permisos.
- Gate de CI para impedir publicar un bundle desincronizado respecto del código fuente.
- Detección cerrada de listas de PR incompletas por el límite de 3.000 archivos de GitHub.
- Step Summary y JSON acotados; el JSON conserva validez e informa truncamiento explícito.
- Comentario idempotente para `github-actions[bot]` y PAT del actor, sin aceptar marcadores ajenos.
- Smoke de producción agregado sobre Node.js 24.
- Suite ampliada a 45 pruebas más ocho escenarios integrales del bundle.
- Validación remota aprobada en consumidores públicos, privados y desde fork.

### Implementación inicial incluida en la primera release

- Parser YAML estricto para GitHub Actions.
- Analizador determinístico de costo y configuración.
- Comparación base versus head.
- CLI Markdown/JSON.
- GitHub Action con Step Summary y comentario opcional.
- Suite inicial de pruebas.
- Documentación de producto, arquitectura y validación.
- Licencia MIT y decisión open-core.
- Catálogo de precios JSON versionado y validado.
- Overrides de catálogo para el core.
- Clasificación conservadora de runners estándar, custom y self-hosted.
- Fixtures para reusable workflows, filtros, caché e include/exclude.
- Suite ampliada a 18 pruebas.
