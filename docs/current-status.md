# CI Bill Doctor — Estado actual

**Fecha:** 1 de agosto de 2026
**Versión de trabajo:** 0.1.0
**Objetivo de este corte:** cerrar una vertical funcional con historial experimental verificable

## Entregado

- Repositorio local y estructura base.
- Licencia MIT y frontera open-core documentada.
- Parser YAML 1.2 estricto.
- Núcleo determinístico sin red.
- Análisis de workflows individuales.
- Comparación de archivos base y head.
- Clasificación de runners Linux, Windows, macOS, self-hosted y desconocidos.
- Cálculo del producto de matrices estáticas.
- Catálogo de precios versionado, con fuente oficial, fechas y JSON Schema.
- Validación del catálogo y soporte de overrides explícitos.
- Clasificación conservadora: larger/custom runners permanecen desconocidos.
- Señal agregada de tarifa por minuto de workflow.
- Reglas iniciales:
  - runner caro;
  - timeout ausente;
  - matriz grande;
  - push y pull request potencialmente duplicados;
  - falta de concurrency/cancel-in-progress;
  - oportunidad prudente de caché.
- Evidencia, recomendación, severidad y confianza por hallazgo.
- CLI con Markdown y JSON.
- GitHub Action compilada para Node.js 24.
- Lectura base/head de workflows modificados mediante API.
- Lectura head preparada para forks mediante el repositorio base y el SHA
  inmutable del evento; validación remota same-repository aprobada y prueba de
  fork todavía pendiente.
- Permiso mínimo explícito `pull-requests: read`; `write` solo para comentarios.
- Step Summary, output JSON y comentario idempotente opcional.
- Umbral configurable para fallar el check.
- Historial efímero opt-in mediante metadatos de runs/jobs completados.
- Inputs acotados: ventana de 7–90 días y muestra de 3–20 runs.
- Inclusión de jobs de reintentos mediante `filter=all`.
- Muestreo run-weighted en hasta cinco buckets temporales y paginación acotada a
  200 jobs por run, incluidos reintentos.
- Límite de cinco workflows históricos; datos parciales se excluyen en lugar de
  tratarse como completos o representativos.
- Presupuesto global de 120 requests históricos por ejecución.
- Cálculo de mean/p50/p95 por run y frecuencia mensual con 30,4375 días.
- Baseline mensual esperado mediante media por run × frecuencia; p50/p95 se
  conservan solo como escenarios de sensibilidad por run.
- Proyección `gross-equivalent` del escenario head mediante ratio estático.
- Supresión de proposed/delta mensual cuando cambia la configuración de triggers.
- Supresión de proposed/delta si una matriz estática es aproximada.
- Cobertura histórica de 100% requerida para publicar escenarios mensuales.
- Acumulación interna en micro-USD enteros y confianza máxima `medium`.
- Diagnósticos agregados sin IDs, nombres de jobs ni labels históricos.
- Fallback estático ante permisos, rate limits, límites o datos insuficientes.
- Estado de historial no disponible incluido en Markdown/JSON.
- Escape de HTML, Markdown activo y menciones en contenido controlado por PRs.
- Laboratorio consumidor reproducible con tres escenarios y runbook remoto.
- Smoke integral del bundle sobre una API GitHub simulada.
- Gate de CI contra bundles compilados desactualizados.
- Detección de listas incompletas cuando el PR supera el resultado disponible de la API.
- Step Summary, comentarios y JSON acotados; truncamiento explícito por workflow.
- Actualización idempotente de comentarios propios, incluidos PAT del actor, sin confiar en marcadores ajenos.
- Job de smoke sobre el runtime productivo Node.js 24.
- Tests del núcleo, integración y fixtures.
- Build reproducible y auditoría de dependencias sin vulnerabilidades conocidas.
- Laboratorio remoto público aprobado para PR normal, expansión de matriz,
  cambio de triggers, configuración mínima sin checkout y comentario idempotente.
- Fallback HTTP 403 aprobado en un consumidor privado sin `actions: read`.

## Verificación realizada

- TypeScript strict: aprobado.
- 45 pruebas automatizadas: aprobadas.
- Build de librería/CLI: aprobado.
- Bundle de Action: aprobado.
- Ocho escenarios integrales del bundle contra API simulada: aprobados.
- Auditoría npm: cero vulnerabilidades conocidas.
- CI remota Node 22/24 y bundle reproducible: aprobados.
- Resultados y enlaces registrados en [remote-validation.md](remote-validation.md).

## Lo que la cifra significa hoy

Sin historial, el valor calculado continúa siendo la suma:

    tarifa pública del runner × copias estáticas de la matriz

para un minuto de ejecución de cada job.

Sirve para comparar la estructura base con la propuesta.

Con `history: "true"`, el reporte agrega un escenario mensual: usa duración real
de jobs tarifables, frecuencia observada, media y percentiles nearest-rank por
run. El valor mensual esperado es media × frecuencia; las columnas at-run-p50/p95
son sensibilidades, no percentiles del agregado mensual. La propuesta escala el
baseline por la razón de tarifa estática head/base. Es un
costo bruto equivalente a tarifas de lista, no una factura: no incorpora cuotas,
descuentos, créditos, larger runners, otros repositorios ni efectos futuros de
caché, tráfico o duración.

## Diferencias respecto de la arquitectura objetivo

- El core está separado por módulos, pero todavía vive en un único paquete npm.
- No existe backend, cuenta, licencia ni facturación.
- La paginación de jobs se detiene en 200; runs mayores se excluyen.
- El muestreo temporal reduce sesgo de recencia, pero todavía usa como máximo 20
  runs y debe backtestearse en distribuciones multimodales.
- No hay retry/backoff ni presupuesto adaptativo por headers de rate limit.
- Las requests REST todavía no tienen timeout/abort propio; el timeout del job es la última defensa.
- La proyección no fue backtesteada contra períodos futuros ni facturas reales.
- No hay scanner web o landing.
- No hay telemetría; permanece deshabilitada por diseño.
- Existen nueve fixtures YAML del core y 45 pruebas, todavía por debajo del gate de 25
  fixtures representativos.

## Próximo bloque recomendado

1. Completar un pull request real desde fork con permisos de solo lectura.
2. Publicar la primera release y Marketplace únicamente después de ese gate.
3. Backtestear dirección y error del escenario esperado contra los 30 días siguientes.
4. Incorporar lectura de headers y retry adaptativo acotado sin
   superar el objetivo de 30 segundos.
5. Llevar el dataset a 25 fixtures, incluidos eventos de pull request y forks.

## Decisiones técnicas pendientes

- Backtesting requerido antes de ampliar la confianza del modelo.
- Política de retry/backoff compatible con el presupuesto de requests.
- Soporte futuro para runs con más de 200 jobs.

Este archivo debe actualizarse al cerrar cada bloque del roadmap para mantener
separado lo implementado de lo únicamente diseñado.
