[English](README.md) | Español

# CI Bill Doctor

CI Bill Doctor estima posibles regresiones de costo en GitHub Actions antes del
merge.

El producto no intenta adivinar una factura exacta. Convierte cambios de workflows
en señales explicables: runners caros, expansión de matrices, jobs sin timeout,
ejecuciones duplicadas, falta de cancelación y oportunidades prudentes de caché.

## Estado

Versión beta actual: 0.1.0.

Ya funciona:

- análisis determinístico de un workflow;
- comparación entre una versión base y una versión propuesta;
- estimación transparente de la tarifa agregada por minuto de workflow;
- detección de runners macOS y Windows;
- cálculo de matrices estáticas;
- reglas para timeouts, triggers, concurrency y caché;
- CLI con salida Markdown o JSON;
- GitHub Action para analizar archivos modificados en un pull request;
- resumen en GitHub Step Summary;
- comentario opcional y umbral configurable para fallar el check;
- historial efímero opt-in de runs/jobs completados;
- proyección mensual esperada y escenarios de sensibilidad `gross-equivalent`;
- degradación a análisis estático ante permisos o datos insuficientes;
- laboratorio consumidor reproducible;
- pruebas automatizadas del núcleo, adaptador y manifiesto de laboratorio;
- smoke integral del bundle contra una API GitHub simulada.

Todavía no incluye:

- free-tier, descuentos o larger runners;
- persistencia longitudinal, conciliación con factura o ahorro verificado;
- parches automáticos;
- dashboard, autenticación o facturación;
- soporte para GitLab, CircleCI o Buildkite.

## Principio central

Cada resultado debe responder cuatro preguntas:

1. Qué cambió.
2. Por qué puede costar más.
3. Qué evidencia utilizó la regla.
4. Qué limitaciones tiene la estimación.

No se usa IA en el motor de decisión del MVP.

## Requisitos locales

- Node.js 22.22.2, fijado en .nvmrc.
- npm.

El bundle de la Action usa el runtime Node.js 24 de GitHub.

## Inicio rápido

Instalar:

    npm install

Ejecutar pruebas:

    npm test

Analizar un workflow:

    npm run cli -- analyze .github/workflows/ci.yml

Comparar dos versiones:

    npm run cli -- compare test/fixtures/base.yml test/fixtures/head.yml

Obtener JSON:

    npm run cli -- compare test/fixtures/base.yml test/fixtures/head.yml --json

Construir la librería, CLI y bundle de la Action:

    npm run build

Ejecutar el smoke integral del bundle compilado:

    npm run smoke:action

## Uso como GitHub Action

Para analizar un pull request no hace falta hacer checkout. La configuración
mínima es:

    name: CI cost guard

    on:
      pull_request:
        paths:
          - ".github/workflows/**"

    permissions:
      contents: read
      pull-requests: read

    jobs:
      inspect:
        runs-on: ubuntu-latest
        timeout-minutes: 5
        steps:
          - uses: seba-montero/ci-bill-doctor@v0

El análisis histórico y los comentarios son opt-in. Para habilitarlos, agregá
`actions: read`, elevá `pull-requests` a `write` y configurá `history: "true"`
y `comment: "true"`. El input `fail-on` también es opcional; el default nunca
bloquea el merge.

Para máxima seguridad, `comment` puede permanecer en `false` y el permiso
`pull-requests` puede reducirse de `write` a `read`. No puede omitirse por
completo: la Action lo necesita para listar los archivos modificados del PR. El
resultado seguirá apareciendo en Step Summary. `actions: read` solo es necesario
con `history: "true"`; el historial está deshabilitado por defecto.

## Modelo de costos actual

El núcleo usa una snapshot versionada de tarifas públicas de runners estándar:

- Linux: US$0,006/minuto.
- Windows: US$0,010/minuto.
- macOS: US$0,062/minuto.

Fuente: [GitHub Actions runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing).

La métrica presentada es:

    tarifa del runner × cantidad estática de copias de la matriz

Se suma para todos los jobs analizables. Esta señal estática no incorpora
duración, cantidad de runs, caché ni concurrencia real.

Las tarifas no están dispersas en reglas: viven en el
[catálogo versionado](catalog/github-hosted-standard.json), validado al cargar y
acompañado por un [JSON Schema](catalog/pricing-catalog.schema.json). Los labels
de larger runners o runners personalizados quedan como desconocidos.

## Historial opt-in y proyección mensual

Al habilitar `history`, CI Bill Doctor consulta metadatos recientes de GitHub
Actions y agrega un escenario mensual conservador a las comparaciones de pull
requests.

| Input | Default | Rango | Función |
|---|---:|---:|---|
| `history` | `false` | boolean | Habilita lectura y proyección histórica |
| `history-window-days` | `30` | 7–90 | Ventana usada para estimar frecuencia |
| `history-sample-runs` | `10` | 3–20 | Runs que alimentan mean/p50/p95 por ejecución |

La frecuencia se calcula como:

    completed runs created in window / window days × 30.4375

Para cada run, el costo observado surge del tiempo transcurrido de cada job por
la tarifa pública del runner. Los reintentos se incluyen. El baseline mensual
esperado usa `mean cost/run × frequency`; además muestra escenarios de
sensibilidad si cada run costara el p50 o p95 observado. Esos escenarios no son
percentiles del costo mensual agregado. La propuesta mantiene duración y
frecuencia y escala el baseline por la razón entre la señal estática head/base. Si cambia la
configuración `on`, conserva el baseline pero omite proposed/delta porque la
frecuencia histórica dejó de ser comparable. Hace lo mismo si una matriz estática
solo puede estimarse con confianza baja.

La salida es `gross-equivalent`: no es una factura, presupuesto garantizado ni
intervalo de confianza. No descuenta minutos incluidos, descuentos, créditos,
impuestos, consumo de otros repositorios ni cambios futuros de tráfico, caché o
duración. Durante la beta la confianza máxima es `medium`.

El adaptador divide la ventana en hasta cinco buckets temporales, obtiene
candidatos de cada uno y distribuye la muestra global proporcionalmente al
`total_count` de cada bucket. Así, los percentiles se aproximan por run sin quedar
limitados a las ejecuciones más recientes. Para cada run pagina hasta 200 jobs e
incluye reintentos. Un workflow usa normalmente 15 requests con defaults y 25 con
la muestra máxima; el peor caso por paginación es 25/45. Solo se procesan los
primeros cinco workflows modificados por ejecución y existe un presupuesto global
de 120 requests históricos por Action.

Si una lista supera 200 jobs, aparece un runner sin precio o faltan timestamps
críticos, no se extrapola el subconjunto válido: el baseline/proposed/delta
mensual queda indisponible hasta tener cobertura completa. `total_count` conserva
la frecuencia incluso por encima de 1.000; ese límite afecta la paginación de
resultados de GitHub, no el contador. La Action nunca falla solo porque una
consulta API esperable no esté disponible; conserva el análisis estático y lo
registra en Markdown/JSON.

GitHub limita a 3.000 los archivos que puede devolver para un pull request. Si
el payload declara más archivos que los recuperados, CI Bill Doctor falla de
forma explícita en vez de afirmar que el diff está completo. Step Summary y
`report-json` usan un margen conservador respecto de los límites de GitHub; si
un reporte excepcional no cabe, se omiten workflows completos y el JSON sigue
siendo válido con `truncated`, `summaryTruncated` y contadores `omitted*`.

Fuentes de la integración: [workflow runs](https://docs.github.com/en/rest/actions/workflow-runs)
y [workflow jobs](https://docs.github.com/en/rest/actions/workflow-jobs).

## Estructura

    src/
      action.ts       integración con GitHub
      analyzer.ts     reglas determinísticas
      cli.ts          interfaz de línea de comandos
      compare.ts      comparación base versus head
      format.ts       reportes Markdown
      github-history.ts adaptador acotado de GitHub Actions
      history.ts      percentiles y proyección mensual
      parser.ts       parseo y validación YAML
      pricing.ts      snapshot de tarifas
      types.ts        contrato de resultados
      workflow-path.ts clasificación segura de cambios de archivos
    catalog/
      github-hosted-standard.json
      pricing-catalog.schema.json
    test/
      fixtures/
      analyzer.test.ts
      github-history.test.ts
      history.test.ts
      lab-manifest.test.ts
      pricing.test.ts
      workflow-path.test.ts
    lab/
      README.md       runbook del repositorio consumidor
      template/       baseline publicable
      scenarios/      cambios y expectativas reproducibles
      scripts/        generador y aplicador seguros
    docs/
      product-spec.md
      architecture.md

## Privacidad y permisos

El MVP no necesita almacenar código.

En pull requests, la Action lee los archivos modificados dentro de
.github/workflows en las revisiones base y head. Ambas lecturas se fijan a los
SHA del evento y se realizan contra el repositorio base, de modo que un fork no
amplía el alcance del token. Con historial habilitado también
consulta metadatos de runs y jobs completados, pero nunca logs, artifacts ni otros
archivos de código. Los datos históricos se procesan en memoria y el reporte
conserva solo agregados y diagnósticos sin IDs, nombres o labels. No se persisten
ni se envían a un backend o modelo de IA.

Permisos mínimos para análisis estático: `contents: read` y
`pull-requests: read`. Para historial se agrega `actions: read`; para publicar el
comentario, `pull-requests: read` se eleva a `pull-requests: write`.

## Producto alojado futuro

El core MIT no impone cuotas de repositorios ni requiere cuenta. Un servicio
alojado separado podrá monetizar historial longitudinal, agregación
multi-repositorio, ahorro verificado, políticas por organización y reportes
periódicos. Pricing, límites y proveedor de cobro se definirán únicamente después
de validar uso repetido; no forman parte del contrato de esta Action.

## Licencia y modelo open-core

El parser, motor determinístico, CLI y GitHub Action se distribuyen bajo
[licencia MIT](LICENSE). La versión gratuita debe seguir siendo útil sin cuenta
ni backend.

La monetización futura se concentra en persistencia, continuidad, agregación y
coordinación, no en ocultar el primer cálculo histórico. Las decisiones están
registradas en [ADR 0001](docs/decisions/0001-open-core-mit.md) y
[ADR 0002](docs/decisions/0002-ephemeral-history.md). La separación física entre
este core público y la plataforma comercial privada se registra en
[ADR 0003](docs/decisions/0003-public-core-private-cloud.md).

La licencia MIT permite uso comercial del software. El nombre, logos e identidad
oficial se administran por separado mediante la [política de marca](TRADEMARKS.md).
Las licencias del software incorporado en el bundle de la Action se conservan
en los [avisos de terceros](THIRD_PARTY_NOTICES.md).

## Documentación

- [Especificación de producto](docs/product-spec.md)
- [Estado actual](docs/current-status.md)
- [Arquitectura](docs/architecture.md)
- [Laboratorio reproducible](lab/README.md)
- [Informe de validación remota](docs/remote-validation.md)
- [Decisiones de arquitectura](docs/decisions/0001-open-core-mit.md)
- [Frontera del historial efímero](docs/decisions/0002-ephemeral-history.md)
- [Core público y plataforma privada](docs/decisions/0003-public-core-private-cloud.md)
- [Política de marca](TRADEMARKS.md)
- [Avisos de terceros](THIRD_PARTY_NOTICES.md)

## Decisiones abiertas

- Criterios de backtesting antes de ampliar la confianza del modelo.
- Política de retry/backoff dentro del presupuesto de requests.
- Soporte futuro para runs con más de 200 jobs.
