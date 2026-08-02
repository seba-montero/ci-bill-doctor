# CI Bill Doctor — Arquitectura

**Estado:** diseño vivo; núcleo estático y proyección histórica experimental implementados
**Principio rector:** el análisis ocurre en el runner; el núcleo es puro, determinístico y utilizable sin SaaS

## 1. Objetivos arquitectónicos

- Producir la misma salida para las mismas entradas, versión de motor y catálogo.
- Separar completamente cálculo, acceso a GitHub y presentación.
- Mantener workflows y código dentro del runner por defecto.
- Ejecutar sin backend.
- Permitir CLI, Action y scanner web sobre el mismo núcleo.
- Fallar de forma conservadora: desconocido reduce confianza; nunca equivale a costo cero.
- Facilitar pruebas con fixtures sin depender de GitHub ni de red.
- Mantener bajo el costo operativo y la superficie de seguridad.

## 2. Vista del sistema

```text
Pull request / workflow_dispatch
             │
             ▼
┌──────────────────────────────┐
│ GitHub Action (TypeScript)   │
│ - inputs/context             │
│ - archivos base/head         │
│ - historial REST opt-in      │
└──────────────┬───────────────┘
               │ datos normalizados
               ▼
┌──────────────────────────────┐
│ Core determinístico          │
│ parser → diff → estimator    │
│ → rules → confidence         │
└──────────────┬───────────────┘
               │ AnalysisReport
        ┌──────┴─────────┐
        ▼                ▼
 Step summary/JSON   Comentario PR
```

## 3. Componentes

### 3.1 `core`

Paquete TypeScript sin red, filesystem, variables de entorno ni reloj global. Todas esas dependencias entran como argumentos.

Responsabilidades:

- parsear y normalizar workflows;
- identificar capacidades soportadas y desconocidas;
- calcular diff semántico;
- expandir matrices estáticas;
- construir escenarios base/propuesto;
- estimar frecuencia, duración, minutos y costo equivalente;
- asignar confianza mediante reglas explícitas;
- generar recomendaciones basadas en evidencia;
- producir un objeto `AnalysisReport` versionado.

No debe:

- llamar a GitHub;
- leer secretos;
- publicar comentarios;
- ejecutar expresiones `${{ ... }}` ni comandos del workflow.

La estimación histórica vive en módulos puros separados del adaptador GitHub. Recibe un `HistorySnapshot`, una comparación de señales estáticas y el catálogo; no conoce tokens, repositorios ni endpoints.

### 3.2 `action`

Adaptador para GitHub Actions compilado a JavaScript distribuible.

Responsabilidades:

- validar inputs;
- descubrir evento, repositorio, SHA base y SHA head;
- cargar archivos desde checkout o API;
- habilitar historial únicamente con `history: true`;
- validar ventana de 7–90 días y muestra de 3–20 runs;
- dividir la ventana en hasta cinco buckets temporales no solapados y consultar candidatos en cada uno;
- asignar la muestra global de 3–20 runs en proporción al `total_count` de cada bucket;
- paginar jobs manualmente hasta dos páginas/200 registros por run;
- limitar el historial a cinco workflows modificados por ejecución;
- compartir un presupuesto máximo de 120 requests históricos entre todos los workflows de la ejecución;
- traducir respuestas de GitHub al modelo del core;
- invocar el análisis;
- publicar step summary, output JSON y comentario;
- emitir mensajes de diagnóstico sin datos sensibles.

La Action implementa paginación manual acotada únicamente para jobs. No implementa paginación adicional de runs, backoff, reintentos ni lectura de headers de rate limit. Una falla esperada de red/API se hace visible en Markdown/JSON y conserva la comparación estática; una excepción de programación o del core se propaga y falla la Action.

### 3.3 `cli`

Adaptador local para validación, debugging y automatización.

Casos:

- comparar dos directorios o archivos;
- analizar costo estático por ejecución;
- generar JSON/Markdown;
- ejecutar fixtures;
- usar un archivo de historial previamente exportado — futuro, no implementado.

El CLI es importante para SEO y adopción open source, pero no debe retrasar el primer Action funcional.

### 3.4 Catálogo de precios

Archivo de datos versionado dentro del repositorio, no constantes dispersas.

**Estado de implementación:** primera versión disponible en
catalog/github-hosted-standard.json, validada al cargar por src/pricing.ts y
documentada mediante catalog/pricing-catalog.schema.json. Los overrides ya
pueden inyectarse en el core; todavía no están expuestos por CLI o Action.

Campos mínimos:

```ts
interface PricingCatalog {
  schemaVersion: 1;
  catalogVersion: string;
  currency: "USD";
  effectiveFrom: string;
  reviewedAt: string;
  sourceUrl: string;
  runners: Record<string, {
    pricePerMinute: number | null;
    billingIncrementSeconds?: number;
    notes?: string[];
  }>;
}
```

Reglas:

- `null` significa desconocido, nunca gratis.
- Cada actualización cambia `catalogVersion`.
- Fixtures fijan el catálogo para evitar tests dependientes de la fecha.
- Inputs permiten overrides por organización o runner.
- El reporte siempre muestra versión y fuente.

## 4. Modelo de dominio

```ts
type Confidence = "high" | "medium" | "low";

interface HistorySnapshot {
  windowDays: number;
  // status=completed y created_at dentro de la ventana
  totalCompletedRuns: number;
  samplingStrategy: "time-stratified-run-weighted";
  runs: HistoricalRun[];
}

interface StaticRateComparison {
  baseUsdPerWorkflowMinute: number | null;
  headUsdPerWorkflowMinute: number | null;
  triggerConfigurationChanged?: boolean;
  // false si una matriz es aproximada o existe un finding invalid-job
  staticComparisonComplete?: boolean;
}

interface MonthlyProjection {
  basis: "gross-equivalent";
  currency: "USD";
  confidence: Confidence;
  history: {
    windowDays: number;
    totalCompletedRuns: number; // status=completed y created_at dentro de la ventana
    sampledRuns: number;
    validRuns: number;
    excludedRuns: number;
    samplingStrategy: "time-stratified-run-weighted";
  };
  monthlyRunFrequency: number | null;
  staticRateRatio: number | null;
  observedRunCost: ProjectionRunCostDistribution;
  baseMonthlyCost: ProjectionMonthlyScenarios;
  proposedMonthlyCost: ProjectionMonthlyScenarios;
  monthlyDelta: ProjectionMonthlyScenarios;
  diagnostics: ProjectionDiagnostic[];
  assumptions: string[];
}

interface ProjectionRunCostDistribution {
  meanUsd: number | null;
  p50Usd: number | null;
  p95Usd: number | null;
}

interface ProjectionMonthlyScenarios {
  expectedUsd: number | null;
  atRunP50Usd: number | null;
  atRunP95Usd: number | null;
}
```

Los costos históricos se acumulan internamente como enteros de micro-USD y se redondean por job. El contrato JSON expone importes en USD; toda cifra incluye base `gross-equivalent`, catálogo, supuestos y diagnósticos.

## 5. Pipeline determinístico

### 5.1 Adquisición

- Enumerar únicamente rutas que cumplen `^\.github/workflows/[^/]+\.ya?ml$`; GitHub no descubre workflows anidados.
- Resolver base y head por SHA, no por nombres de rama mutables. Leer ambos
  contra el repositorio base: GitHub expone el commit head mediante la ref del
  pull request y el token no necesita ampliar su alcance al repositorio fork.
- Mantener `history: false` por defecto.
- Aceptar `history-window-days` 7–90, default 30, y `history-sample-runs` 3–20, default 10.
- Consultar historial solo para comparaciones de pull request y hasta cinco workflows modificados.
- Identificar el workflow histórico por el nombre del archivo base.
- Dividir la ventana en `min(5, history-sample-runs)` buckets temporales contiguos y no solapados, con precisión de un segundo.
- Consultar en cada bucket runs con `status: completed` cuyo `created_at` cae dentro de ese intervalo, sin filtro de branch y con `exclude_pull_requests: true`.
- Pedir candidatos en cada bucket y sumar sus `total_count` para la frecuencia global.
- Distribuir el cupo global de 3–20 runs proporcionalmente al `total_count` de cada bucket, limitado por candidatos disponibles; la estrategia se identifica como `time-stratified-run-weighted`.
- Deduplicar candidatos por run id y no superar el cupo global configurado.
- Consultar jobs con `filter: all`; esto incorpora intentos anteriores.
- Paginar jobs manualmente en páginas de 100 hasta completar el total o alcanzar 200 registros/dos páginas por run.
- Marcar el run truncado si el total supera 200, una página queda parcial o `total_count` cambia durante la paginación.
- Ejecutar las consultas de jobs en lotes con concurrencia máxima de tres.

### 5.2 Parseo seguro

- Utilizar parser YAML que preserve ubicación y detecte anchors/aliases.
- Aplicar límites de tamaño, profundidad, aliases y nodos.
- No evaluar expresiones, JavaScript, shell ni plantillas.
- Conservar expresión desconocida como nodo simbólico.

### 5.3 Normalización

- Convertir forma corta/larga de eventos a una representación común.
- Normalizar nombres de runner y matrices.
- Mantener expresiones dinámicas como `UnknownValue` con motivo.
- Diferenciar ausencia de propiedad de valor implícito de GitHub.

### 5.4 Diff semántico

Comparar elementos por identidad estable:

- workflow → path;
- job → id YAML;
- step → id, o firma estable si no existe;
- trigger/filtro → forma normalizada;
- matrix → dimensiones y combinaciones.

Un cambio de formato, comentarios u orden irrelevante no debe aparecer como costo.

La comparación normaliza estructuralmente `on`. Un simple cambio de orden de claves no cuenta; agregar, quitar o modificar un trigger/filtro establece `triggerConfigurationChanged`.

### 5.5 Estimación

1. Calcular el costo de cada job no `skipped` como duración de pared por tarifa del runner. Un job `cancelled` sin duración positiva observada —timestamps ausentes, iguales o invertidos— contribuye cero antes de clasificar el runner; si tiene duración positiva, se tarifa normalmente.
2. Acumular cada run en micro-USD enteros; un run solo es válido si su paginación está completa y todos los jobs que requieren precio tienen timestamps válidos y tarifa.
3. Tratar un run completo con cero jobs o con todos sus jobs `skipped` como observación válida de costo cero.
4. Calcular media, p50 y p95 observados del costo por run; los percentiles usan **nearest-rank**.
5. Calcular frecuencia mensual como `completedRunsCreatedInWindow / windowDays × 30.4375`, donde el numerador cuenta runs con estado `completed` creados dentro de la ventana.
6. Multiplicar la media por la frecuencia para obtener `expectedUsd`; multiplicar p50/p95 por la misma frecuencia para obtener `atRunP50Usd`/`atRunP95Usd` como escenarios de sensibilidad.
7. Calcular `ratio = señal_estática_head / señal_estática_base`.
8. Publicar los escenarios base mensuales solo si el 100% de los runs muestreados es completo y tarifable.
9. Si un run se excluye, conservar frecuencia y media/p50/p95 observados de los runs válidos como diagnóstico, pero devolver base/propuesta/delta mensual en `null`.
10. Si la comparación estática es completa y `on` no cambió estructuralmente, multiplicar los tres escenarios base por el ratio para producir propuesta y delta.
11. Si `on` cambió, conservar baseline histórico pero devolver propuesta/delta en `null`, diagnóstico `trigger-configuration-changed` y confianza baja.
12. Si alguna matriz estática tiene confianza baja o base/head contiene un finding `invalid-job`, conservar baseline pero devolver propuesta/delta en `null` con `approximate-static-comparison`.
13. Emitir confianza baja con menos de 5 runs válidos, ventana menor de 7 días o proyección incompleta; en otro caso emitir media.

La confianza está limitada a media durante el rollout porque el ratio estático conserva frecuencia y duración históricas en vez de predecirlas. `atRunP50Usd` y `atRunP95Usd` responden cuánto costaría el mes si cada run costara el p50/p95 observado: no son percentiles de la suma mensual, peor caso, intervalo de confianza ni SLA. Obtener percentiles del agregado mensual requeriría un modelo de conteos y duración o bootstrap, fuera de este contrato.

`total_count` se utiliza completo para frecuencia aunque sea superior a 1.000: el límite de búsqueda de GitHub restringe cuántos resultados pueden paginarse, no el total informado. El muestreo por buckets evita usar solamente los runs más recientes y la asignación proporcional evita dar el mismo peso a períodos con volúmenes muy distintos. Sigue siendo una muestra pequeña y no una reconstrucción exhaustiva.

Una lista de más de 200 jobs, una carrera donde cambia `total_count` entre páginas o una respuesta parcial marca el run como truncado. También se excluye el run completo ante runner desconocido/sin precio, timestamps inválidos o overflow cuando el job requiere tarifación; la excepción es un `cancelled` sin duración positiva, que vale cero. La exclusión de un solo run impide extrapolar cualquier escenario mensual, aunque frecuencia y distribución observada sigan visibles. Si no hay comparación estática fiable —incluida una matriz aproximada o un finding `invalid-job`—, el baseline puede permanecer pero no propuesta/delta. Un cambio estructural en triggers no invalida el baseline observado, pero sí impide proyectar la propuesta con una frecuencia que ya no es comparable.

No se infieren cuotas gratuitas, créditos, descuentos, impuestos, redondeo de invoice, spend caps ni uso de otros repositorios. La salida siempre se etiqueta `gross-equivalent`.

### 5.6 Reglas y recomendaciones

Cada regla implementa una interfaz común:

```ts
interface OptimizationRule {
  id: string;
  version: number;
  evaluate(context: RuleContext): Recommendation | null;
}
```

Una recomendación incluye:

- regla y versión;
- evidencia exacta;
- ahorro como rango;
- confianza independiente;
- impacto funcional potencial;
- parche sugerido solo si es seguro;
- enlace a documentación.

### 5.7 Render

Renderers separados transforman `AnalysisReport` en:

- Markdown compacto para PR;
- step summary extendido;
- JSON estable;
- salida terminal.

El comentario contiene una marca HTML invisible para poder actualizarlo sin duplicados.

## 6. Integración con GitHub

### Eventos

- `pull_request`: flujo principal y único evento con proyección histórica en esta versión.
- `workflow_dispatch`: auditoría estática manual; si se solicita historial, se advierte que no está disponible.
- `merge_group`: P1.

No utilizar `pull_request_target` en ejemplos generales. Contribuciones desde forks deben ejecutarse con permisos reducidos y sin secretos.

### Permisos

```yaml
permissions:
  contents: read
  actions: read # solo con history: true
  pull-requests: write
```

Modos degradados:

| Permiso disponible | Comportamiento |
|---|---|
| contents + actions + PR write + history opt-in | comparación, proyección y comentario |
| contents + actions + PR read + history opt-in | comparación, proyección y step summary |
| contents + PR read | estimación estática y step summary |
| sin contents o sin PR read | error claro, sin cálculo incompleto |

`pull-requests: read` es necesario para enumerar los archivos del PR; el ejemplo
usa `write` porque habilita comentarios. Sin comentarios se reduce a `read`, no se
elimina. `actions: read` es condicional; concederlo no activa historial por sí
solo. El análisis no debe fallar porque no puede comentar o proyectar. El error
de publicación es distinto del error de cálculo histórico.

### Límites de API implementados

- Máximo de cinco workflows históricos por ejecución; los restantes conservan análisis estático.
- Hasta cinco llamadas `listWorkflowRuns` por workflow, una por bucket temporal no solapado.
- Jobs: una llamada típica por run; hasta dos páginas/200 jobs como hard cap.
- Default de 10 runs: 15 requests típicos y hard cap de 25 por workflow.
- Máximo de 20 runs: 25 requests típicos y hard cap de 45 por workflow.
- Con cinco workflows: 75/125 requests típicos y hard caps 125/225 para default/máximo respectivamente.
- Los totales anteriores describen demanda teórica; un budget compartido corta la ejecución antes de superar 120 requests históricos reales.
- El `total_count` de cada bucket se usa para frecuencia y asignación proporcional aun cuando el total combinado supera 1.000; no se paginan todos los runs.
- Las consultas de jobs se agrupan de tres en tres para limitar concurrencia.
- Una falla esperada por status HTTP o código de red conocido se reduce a una razón sanitizada, se guarda en `historyCollection` y aparece en Markdown/JSON.
- El agotamiento del budget global se trata como indisponibilidad esperada: los workflows afectados conservan análisis estático y muestran la razón.
- Excepciones inesperadas del adaptador/core no se convierten en fallback: se propagan para fallar el check y hacer visible el bug.
- Si `pull_request.changed_files` supera los registros recuperados, fallar cerrado; la REST API no expone más de 3.000 archivos.
- Step Summary y output JSON reservan margen bajo los límites de GitHub y omiten items completos, nunca bytes arbitrarios; el JSON informa `truncated`, `summaryTruncated`, `omittedItems` y `omittedDeletedWorkflowFiles`.

### Siguientes mejoras de resiliencia

- Paginación adicional de runs y soporte para más de 200 jobs, solo si los datos justifican ampliar el hard cap.
- Lectura y observación de headers de rate limit.
- Backoff para respuestas transitorias.
- Política explícita de reintentos, sin reintentar autorización inválida.

Estas mejoras no deben describirse como implementadas hasta contar con código y pruebas.

## 7. Privacidad y threat model

### Activos sensibles

- contenido de workflows privados;
- nombres de repositorio, jobs, ramas y usuarios;
- token de GitHub;
- secretos interpolados accidentalmente en logs;
- metadatos históricos: ids, timestamps, conclusiones y labels de runner recibidos desde GitHub.

### Amenazas prioritarias

1. Exfiltración desde un PR de fork.
2. Dependencia de Action comprometida.
3. YAML malicioso que agota memoria o CPU.
4. Token impreso en una excepción.
5. Comentario que expone información de costos en lugar no deseado.

### Controles

- nunca ejecutar contenido analizado;
- límites estrictos de archivo/nodos/aliases/matrices;
- permisos declarados explícitamente y mínimos;
- ejemplos fijados por SHA para consumidores sensibles;
- dependencias fijadas, actualización automática revisada y análisis de supply chain;
- redactor central aplicado a errores antes del logger;
- sin envío de contenido a servicios externos;
- historial deshabilitado por defecto y permiso `actions: read` condicional;
- no descargar logs, artefactos, contenidos adicionales de workflow ni billing;
- procesar metadatos históricos en memoria y emitir únicamente agregados/diagnósticos;
- no incluir ids crudos de runs o jobs en Markdown o JSON;
- escapar HTML, sintaxis Markdown y menciones en todo texto controlado por workflow/PR antes de renderizar summary o comentario;
- comentarios configurables y step summary como fallback;
- política de reporte responsable de vulnerabilidades.

### Secretos

- Usar `GITHUB_TOKEN` efímero provisto por la ejecución.
- No persistir el token.
- El core no recibe ningún token.
- No incluir valores de `env`, `with` o expresiones en los reportes.

## 8. Frontera con servicios alojados

El core no consulta licencias, billing ni un backend y funciona de forma
independiente. Los servicios alojados se mantienen fuera de este repositorio,
según [ADR 0003](decisions/0003-public-core-private-cloud.md). Cualquier
integración futura debe ser explícita, fail-open para el análisis local y
documentar permisos y datos antes de incorporarse aquí.

## 9. Observabilidad

### Local

- logs estructurados por nivel;
- códigos de diagnóstico estables;
- timings por fase;
- versión de core/catálogo en cada reporte;
- opción `debug` que sigue redacción de secretos.

El core no envía telemetría.

## 10. Estrategia de pruebas

**Estado local:** 45 pruebas automatizadas y ocho escenarios integrales del
bundle aprobados. Estos últimos ejercitan el transporte contra una API GitHub
simulada; la ejecución contra un repositorio remoto de laboratorio continúa
pendiente y no se considera cubierta por esta suite.

### Unitarias

- parseo/normalización;
- expansión de matrices;
- aritmética decimal y redondeo;
- clasificación de confianza;
- frecuencia mensual de runs `completed` creados en la ventana, media/p50/p95 por run, escenarios mensuales y ratio estático;
- acumulación/redondeo en micro-USD;
- reglas de recomendación;
- renderers estables.

### Fixtures de contrato

- workflows simples y matrices complejas;
- descubrimiento solo en la raíz de `.github/workflows`: mover raíz→subdirectorio cuenta como eliminado y subdirectorio→raíz como agregado;
- `include`/`exclude`;
- expresiones dinámicas;
- reusable workflows;
- runners desconocidos;
- múltiples eventos y filtros;
- YAML con anchors y límites adversariales;
- historiales escasos, sesgados y con outliers.
- reintentos, jobs omitidos, timestamps inválidos, runners desconocidos y jobs `cancelled` con/sin duración positiva;
- `total_count` de runs superior a 1.000 y asignación proporcional entre buckets con volúmenes desiguales;
- una/dos páginas de jobs, más de 200 registros y carrera de `total_count` entre páginas;
- runs completos vacíos o con todos los jobs omitidos como costo cero;
- muestra incompleta que conserva observados pero anula escenarios mensuales;
- matriz estática aproximada o finding `invalid-job` que conserva baseline pero anula propuesta/delta;
- triggers estructuralmente iguales con distinto orden y triggers realmente modificados;

### Propiedades

- el mismo input produce bytes equivalentes en JSON canónico;
- agregar un runner pago no puede reducir costo sin otra modificación explícita;
- un precio desconocido nunca produce cero;
- `expectedUsd` usa media por run × frecuencia y `atRunP50Usd`/`atRunP95Usd` conservan exactamente sus escenarios de sensibilidad;
- un unsupported relevante nunca aumenta la confianza.
- la proyección nunca supera confianza media durante el rollout;
- un run parcial nunca contribuye costo parcial;
- un solo run excluido anula base/propuesta/delta mensual;
- un cambio de `on` nunca produce propuesta/delta mensual basada en frecuencia anterior;
- datos controlados por PR no generan HTML, links, formato o menciones activos;
- `history: false` nunca llama endpoints de historial.

### Integración

- repositorio sandbox con PRs de fixtures;
- laboratorio generado desde `lab/template` y escenarios declarados en un manifiesto;
- tokens con combinaciones de permisos;
- PR de fork sin secretos;
- falta de `actions: read`, respuestas parciales y fallback estático;
- fallas API esperadas visibles y bugs inesperados propagados;
- agotamiento del presupuesto global a 120 requests sin una llamada 121;
- repositorio sandbox con historial — pendiente de ejecución remota;
- actualización idempotente del comentario.

### Seguridad

- dependency review y secret scanning;
- pruebas de YAML bombs/tamaños extremos;
- análisis estático;
- generación reproducible del bundle distribuido;
- gate de CI con `git diff --exit-code` después de reconstruir el bundle;
- revisión manual de permisos antes de release.

## 11. Rendimiento y costos

Objetivos iniciales:

- análisis estático p95 < 10 segundos;
- análisis histórico default p95 < 30 segundos — objetivo pendiente de medición remota;
- memoria < 256 MB para workflows normales;
- muestra global default de 10 y máxima de 20 runs por workflow, distribuida en hasta cinco buckets;
- hasta dos páginas y 200 jobs por run;
- máximo de cinco workflows históricos por ejecución;
- presupuesto típico de 15/25 requests por workflow para default/máximo, con hard caps de 25/45;
- para cinco workflows: 75/125 típicos y 125/225 como hard caps para default/máximo;
- hard cap global efectivo: 120 requests históricos por ejecución, aunque la suma teórica por workflow sea mayor;
- cero infraestructura operada por el proyecto para el análisis local.

La API REST no introduce un costo monetario separado para el operador, porque la Action utiliza `GITHUB_TOKEN` y no existe un backend de proyección. Las consultas sí consumen el rate limit del repositorio y tiempo del job del usuario. El límite publicado para `GITHUB_TOKEN` es normalmente 1.000 requests/hora por repositorio —15.000 para recursos de GitHub Enterprise Cloud—. Cinco workflows con defaults demandan típicamente 75 requests; la ejecución nunca supera el budget histórico global de 120, además de las llamadas no históricas necesarias para PR/contenidos. Ver [límites oficiales de la REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).

El costo principal del análisis lo paga el propio runner del usuario en minutos de Actions. Esto debe mantenerse razonable: una herramienta para reducir CI no puede consumir minutos significativos de CI.

## 12. Decisiones diferidas

- GitHub App vs. Action con token: evaluar si los permisos bloquean la activación.
- Frontera open-core: mantener la proyección efímera abierta y los servicios
  alojados en un repositorio separado.
- Scanner en navegador mediante bundle JS/WASM: solo si la landing demuestra tráfico.
- Datos agregados de benchmarks: requieren consentimiento y revisión de privacidad independiente.

## 13. Criterios de evolución

Agregar un componente solo si cumple al menos una condición:

- desbloquea activación medida;
- aumenta exactitud en un caso frecuente;
- reduce soporte repetido;
- mitiga un riesgo técnico o de seguridad alto.

No agregar dashboards, IA, nuevas plataformas o infraestructura por percepción de completitud.
