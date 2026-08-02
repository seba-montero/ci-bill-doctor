# CI Bill Doctor — Especificación de producto

**Estado:** MVP en desarrollo; proyección histórica experimental implementada
**Versión:** 0.1
**Fecha:** 1 de agosto de 2026
**Responsable:** fundador/producto

## 1. Resumen

CI Bill Doctor es una GitHub Action y herramienta de línea de comandos que analiza los cambios realizados en workflows de GitHub Actions y responde, dentro del pull request, tres preguntas:

1. ¿Cuánto puede cambiar el consumo mensual de CI si se integra este PR?
2. ¿Qué parte de la configuración explica el cambio?
3. ¿Qué correcciones seguras podrían reducirlo?

El producto no intenta reconstruir la factura exacta de GitHub. Calcula una señal estática y, cuando el usuario habilita historial y existen datos suficientes, un costo mensual esperado **`gross-equivalent`** a precios de lista junto con escenarios de sensibilidad. Cada cifra incluye supuestos, evidencia y nivel de confianza; no se presenta como costo neto ni costo marginal facturado.

## 2. Problema

El gasto de CI suele descubrirse tarde: al revisar la factura o cuando se agota una cuota. En un pull request, cambios aparentemente pequeños pueden multiplicar el consumo:

- ampliar una matriz de versiones o sistemas operativos;
- agregar ejecuciones en `push` además de `pull_request`;
- utilizar runners más caros;
- eliminar o invalidar una caché;
- ejecutar el workflow ante cambios irrelevantes;
- duplicar jobs o eliminar cancelación de ejecuciones obsoletas;
- aumentar `timeout-minutes` o retención de artefactos.

Las calculadoras manuales no conocen el diff del PR ni el historial del repositorio. Las plataformas generales de observabilidad suelen actuar después de la ejecución y pueden ser demasiado amplias o caras para equipos pequeños.

## 3. Usuarios y casos de uso

La herramienta está orientada a maintainers, tech leads y responsables de
plataforma que usan GitHub Actions y quieren revisar cambios de costo dentro del
pull request. También resulta útil en proyectos open source que desean mantener
workflows eficientes. Los runners exclusivamente self-hosted y la conciliación
exacta de facturas quedan fuera del modelo actual.

## 4. Propuesta de valor y posicionamiento

**Frase principal:** “Conocé el impacto equivalente de cada PR en el costo de GitHub Actions antes de hacer merge”.

**Categoría:** control preventivo de costos de CI.

**Diferencial:** CI Bill Doctor no es un dashboard de gasto histórico. Funciona como un revisor automático del PR: compara workflow base y propuesto, usa evidencia reciente, explica el delta y sugiere cambios concretos.

**Promesa permitida:** “Estimá y reducí el costo de GitHub Actions antes del merge”.

**Promesas que deben evitarse:**

- “Calcula tu factura exacta”.
- “Garantiza ahorros”.
- “Detecta todos los costos”.
- “Reemplaza la información de billing de GitHub”.

## 5. Experiencia principal

1. El usuario agrega la Action a un workflow de pull requests.
2. La Action localiza workflows modificados y obtiene el archivo de la rama base.
3. El núcleo normaliza ambas versiones y detecta cambios relevantes.
4. Si el usuario configura `history: true`, consulta una ventana limitada de runs y jobs recientes con permiso `actions: read`; el default permanece en `false`.
5. Calcula media/p50/p95 del costo por run, frecuencia mensual y escenarios base/propuesto `gross-equivalent`.
6. Publica un resumen en `GITHUB_STEP_SUMMARY` y, si fue autorizado, crea o actualiza un único comentario en el PR.
7. El reporte muestra valor esperado, sensibilidades al p50/p95 por run, confianza, supuestos y recomendaciones.
8. En ejecuciones posteriores actualiza el mismo comentario para no generar ruido.

### Ejemplo conceptual del reporte

```text
Impacto mensual esperado: +US$38 · confianza media
Sensibilidad: +US$31 si cada run cuesta p50; +US$46 si cuesta p95

Principal causa
- La matriz pasó de 6 a 18 combinaciones: +12 jobs por ejecución.
- Ventana histórica: 30 días; frecuencia normalizada: 74 ejecuciones/mes.

Recomendaciones
- Excluir Node 18 de macOS: ahorro mensual esperado US$25; sensibilidad US$21 al p50 por run y US$29 al p95.
- Agregar concurrency/cancel-in-progress: ahorro mensual esperado US$7; sensibilidad US$5/US$9 al p50/p95 por run.

Supuestos
- Precios del catálogo 2026-08-01.
- No se descontaron minutos incluidos, descuentos ni spend caps.
```

## 6. Alcance del MVP

### P0 — imprescindible

- Ejecutarse en `pull_request` y `workflow_dispatch`.
- Descubrir solo rutas que cumplen `^\.github/workflows/[^/]+\.ya?ml$`; un archivo anidado no es un workflow ejecutable de GitHub.
- Parsear YAML sin ejecutar expresiones del workflow.
- Comparar jobs, matrices, runners, triggers, filtros de paths/branches, concurrencia, timeout, servicios, contenedores y retención de artefactos.
- Expandir matrices estáticas y reconocer matrices dinámicas como incertidumbre.
- Mantener un catálogo de precios versionado con fecha y fuente.
- Permitir precios personalizados por minuto.
- Calcular una estimación estática aun sin acceso al historial.
- Ofrecer historial efímero opt-in mediante `history: false` por defecto.
- Validar `history-window-days` con default 30 y rango 7–90.
- Validar `history-sample-runs` con default 10 y rango 3–20.
- Consultar como máximo cinco workflows modificados por ejecución de la Action.
- Dividir la ventana en hasta cinco buckets temporales no solapados y consultar, sin filtro de branch, candidatos con `status: completed` cuyo `created_at` cae en cada bucket.
- Asignar el cupo global de 3–20 runs proporcionalmente al `total_count` de cada bucket (`time-stratified-run-weighted`).
- Paginar jobs con `filter: all`, incluidos reintentos, hasta dos páginas/200 registros por run.
- Degradar la proyección cuando una lista de jobs está truncada, cambia su `total_count` entre páginas o existen datos críticos incompletos.
- Aplicar un presupuesto global de 120 requests históricos por ejecución; al agotarse, registrar historial no disponible y conservar análisis estático.
- Detectar cambios estructurales en `on`; conservar el baseline histórico, pero omitir propuesta/delta mensual y bajar confianza porque la frecuencia deja de ser comparable.
- Incorporar duración y frecuencia históricas únicamente en comparaciones de pull requests.
- Presentar valor base, valor propuesto y delta para el esperado y las dos sensibilidades, además de confianza.
- Mostrar todas las suposiciones y advertir qué elementos no se pudieron modelar.
- Generar recomendaciones basadas en reglas, vinculadas a evidencia concreta.
- Publicar salida legible y un reporte JSON para integraciones.
- Actualizar un solo comentario identificable en el PR.
- Aplicar redacción de tokens y secretos conocidos antes de loguear errores.
- Fallar de forma informativa, sin bloquear el merge por defecto.

### Mejoras técnicas posteriores

- Política opcional para fallar cuando el delta supera un umbral.
- Paginación adicional de runs o soporte para más de 200 jobs, tratamiento explícito de rate limits y política de reintentos para la API de Actions.
- Botón o patch descargable para recomendaciones seguras.
- Anotaciones por línea y check dedicado.
- Soporte para eventos `merge_group` y reusable workflows entre repositorios.
- Comentarios privados mediante GitHub App.

### Fuera de alcance del MVP

- Acceso o conciliación con facturas y métodos de pago.
- Prometer costos netos exactos después de cuotas o descuentos.
- Modificar o hacer merge automáticamente.
- Generar workflows completos mediante IA.
- GitLab CI, CircleCI, Buildkite, Azure DevOps u otros proveedores.
- Modelar costos reales de runners self-hosted.
- SSO, SCIM, despliegue on-premise o contratos enterprise.
- Optimización de tiempo de compilación dentro del código de la aplicación.
- Observabilidad general de flaky tests o calidad de software.
- Descargar logs o artefactos de ejecuciones.
- Bloquear el merge a partir de la proyección histórica durante la beta.

## 7. Modelo de estimación

### Conceptos

- **Minutos observados:** tiempo de pared entre `started_at` y `completed_at` para jobs no `skipped` con duración positiva; un `cancelled` sin duración positiva contribuye costo cero.
- **Frecuencia observada:** total de runs con estado `completed` cuyo `created_at` cae dentro de la ventana, sin filtro de branch.
- **Factor de expansión:** cantidad de jobs generados por matrices y dependencias.
- **Costo `gross-equivalent`:** tiempo observado de runners alojados multiplicado por precios de lista del catálogo.
- **Costo mensual esperado:** media observada del costo por run multiplicada por la frecuencia mensual normalizada.
- **Sensibilidades mensuales:** costo mensual si cada run costara el p50 o el p95 observado; no son percentiles del gasto mensual agregado.
- **Confianza:** alta, media o baja según cobertura y calidad de la evidencia.

### Contrato de cálculo experimental

```text
frecuencia_mensual = completed_runs_created_in_window / window_days × 30.4375
costo_base_esperado = media_costo_run × frecuencia_mensual
costo_base_at_run_p50/p95 = costo_run_p50/p95 × frecuencia_mensual
ratio_estático = señal_head / señal_base
costo_propuesto_{esperado,p50,p95} = costo_base_{esperado,p50,p95} × ratio_estático
delta_{esperado,p50,p95} = costo_propuesto_{esperado,p50,p95} - costo_base_{esperado,p50,p95}
```

- La distribución observada por run expone media, p50 y p95; los percentiles usan **nearest-rank**.
- `expectedUsd` es la media por run por frecuencia. `atRunP50Usd` y `atRunP95Usd` son sensibilidades “si cada run costara p50/p95”, no percentiles de la suma mensual. Percentiles mensuales reales requerirían bootstrap o un modelo explícito de frecuencia y costos.
- El cálculo interno acumula micro-USD enteros y redondea por job.
- `filter: all` incorpora intentos anteriores de un run porque también consumen tiempo de runner.
- Un run se acepta solo si su lista de jobs está completa y todos los jobs que requieren tarifación tienen timestamps válidos y un runner tarifable.
- Un run completo sin jobs o compuesto únicamente por jobs `skipped` contribuye costo cero y permanece como observación válida.
- Un job `cancelled` sin duración positiva observada —timestamps ausentes, iguales o invertidos— contribuye cero antes de clasificar el runner; si registró duración positiva, se tarifa normalmente.
- Los runs se seleccionan desde buckets temporales no solapados y el cupo global se distribuye en proporción al volumen de runs de cada bucket.
- Base/propuesta/delta mensual requieren que el 100% de los runs muestreados sea completo y tarifable.
- Si un run se excluye, frecuencia y media/p50/p95 observados de los válidos permanecen visibles, pero todos los escenarios mensuales quedan en `null`.
- La propuesta conserva la frecuencia y duración observadas; solo escala el baseline por el ratio de señal estática head/base.
- Si cambia estructuralmente la configuración `on`, el baseline histórico puede mostrarse, pero propuesta y delta quedan en `null` con diagnóstico `trigger-configuration-changed`.
- Si alguna matriz base/head tiene confianza estática baja o cualquiera de los dos análisis contiene un finding `invalid-job`, el baseline puede mostrarse, pero propuesta y delta quedan en `null` con `approximate-static-comparison`.
- Si el ratio no puede calcularse, se puede mostrar evidencia histórica pero no costo propuesto ni delta mensual.

### Reglas de confianza durante el rollout

- **Media:** proyección completa, 100% de la muestra válida, al menos 5 runs válidos y ventana de al menos 7 días.
- **Baja:** muestra incompleta, menos de 5 runs válidos, cambio estructural de triggers, comparación estática aproximada o proyección incompleta.
- **Alta:** no se emite durante la beta. La confianza queda limitada a media porque el ratio estático no demuestra que las duraciones futuras permanezcan estables.

La confianza no debe calcularse como una probabilidad falsa. Es una categoría explicada por indicadores observables.

### Principios de exactitud

- Usar media, p50 y p95 nearest-rank por run; reservar la media para la expectativa mensual y los percentiles para sensibilidad.
- Separar Linux, Windows y macOS; un runner desconocido o sin tarifa invalida el run cuando ese job requiere tarifación.
- No atribuir al PR ahorro proveniente de supuestos no verificables.
- Usar `total_count` completo para frecuencia aunque supere 1.000; el límite de búsqueda afecta la paginación de resultados, no ese total.
- Muestrear por tiempo y volumen para evitar sesgo solo-reciente y sobrepeso de buckets con pocos runs, sin presentar la muestra como censo exhaustivo.
- Tratar más de 200 jobs, una página parcial o un cambio de total entre páginas como run truncado.
- No extrapolar escenarios mensuales desde un subconjunto válido: un solo run excluido anula base/propuesta/delta.
- Identificar cambios sin precio en lugar de asignarles cero.
- Versionar toda salida con versión de motor y catálogo.
- Explicar que el p95 es un percentil observado por run y que `atRunP95Usd` es una sensibilidad, no percentil mensual, peor caso, intervalo de confianza ni SLA.
- No extrapolar frecuencia histórica a una propuesta que cambia la configuración de triggers.

## 8. Recomendaciones determinísticas iniciales

Cada recomendación debe incluir condición, evidencia, ahorro estimado, limitaciones y documentación oficial.

- Agregar `concurrency` con `cancel-in-progress` cuando haya ejecuciones superpuestas cancelables.
- Restringir triggers mediante `paths`, `paths-ignore`, `branches` o tipos de evento.
- Reducir combinaciones redundantes de una matriz.
- Evitar runners macOS/Windows para jobs que históricamente no los requieren.
- Establecer `timeout-minutes` razonable basado en percentiles históricos.
- Reducir retención de artefactos grandes cuando sea visible en configuración.
- Compartir cachés o corregir claves evidentemente demasiado volátiles.
- Evitar ejecutar el mismo conjunto de jobs en `push` y `pull_request` para la misma rama.

El MVP no recomienda cambios semánticos inseguros ni elimina versiones soportadas sin que el usuario lo decida.

## 9. Requisitos no funcionales

- Tiempo objetivo de ejecución sin historial: menos de 10 segundos.
- Con historial default: objetivo menor de 30 segundos en p95, pendiente de validación remota.
- Presupuesto típico por workflow: 15 requests con defaults y 25 con muestra máxima; hard caps 25 y 45 respectivamente.
- Presupuesto agregado teórico para cinco workflows: 75/125 requests típicos y hard caps 125/225; un budget global implementado limita la ejecución real a 120 requests históricos.
- Procesar historial para un máximo de cinco workflows modificados por ejecución.
- Resultado determinístico para las mismas entradas y catálogo.
- Ningún workflow o contenido de código sale del runner en el plan gratuito/local.
- Cero secretos en logs, comentarios o telemetría.
- Compatible con repositorios monorepo y nombres de archivo con caracteres no ASCII.
- Errores parciales deben reducir confianza, no producir números inventados.
- Errores esperados de autorización/red/API, incluido presupuesto agotado, deben conservar el análisis estático y quedar visibles en Markdown/JSON mediante una razón sanitizada.
- Errores inesperados de programación o del core deben propagarse y fallar la Action; no se silencian como fallback.
- Todo texto controlado por workflow/PR debe escapar HTML, Markdown activo y menciones antes de renderizarse.
- Un diff incompleto respecto de `pull_request.changed_files` debe fallar con explicación; nunca informar falsamente que no hubo workflows modificados.
- Step Summary y JSON deben permanecer bajo límites conservadores y truncar solo items completos; el JSON declara el truncamiento y los conteos omitidos.
- Dependencias fijadas y artefacto de Action generado de forma reproducible.
- Core cubierto por fixtures y pruebas de propiedades para matrices/cálculos.

## 10. Privacidad y permisos

### Configuración recomendada con historial y comentario

```yaml
permissions:
  contents: read
  actions: read
  pull-requests: write
```

- `contents: read`: leer la versión base y propuesta de los workflows.
- `pull-requests: read`: listar los archivos modificados; es el mínimo para analizar un PR.
- `actions: read`: obtener metadatos de runs y jobs recientes; es necesario solo con `history: true`.
- `pull-requests: write`: crear o actualizar el comentario. Sin comentarios debe reducirse a `read`, no omitirse; el resultado queda en el step summary.

En PRs provenientes de forks, GitHub puede entregar un token de solo lectura. El producto debe degradar con seguridad al step summary; no debe recomendar `pull_request_target` como solución predeterminada, porque ejecutar código no confiable con permisos elevados introduce un riesgo serio.

Sin historial, el consumidor puede omitir `actions: read`. Sin permiso o token suficiente, el resultado histórico se omite y el análisis estático continúa.

### Política de datos

- Procesamiento local en el runner por defecto.
- La consulta histórica utiliza metadatos de runs/jobs, pero no descarga logs, artefactos ni información de billing.
- Los metadatos históricos permanecen en memoria durante la ejecución; no se persisten ni se envían a un backend.
- El reporte expone solo agregados y diagnósticos, no identificadores crudos de runs o jobs.
- No enviar YAML, nombres de jobs, logs, código, secretos ni autores a ningún backend.
- Cualquier conexión futura con un servicio alojado requiere instalación y consentimiento explícitos.
- Telemetría permanece deshabilitada; una propuesta futura debe ser separada, mínima y opt-in.

## 11. Frontera comercial

El core MIT es funcional sin cuenta, backend ni límites comerciales. La
persistencia, agregación multi-repositorio, ahorro verificado, políticas y
reportes pertenecen a una plataforma privada separada según
[ADR 0003](decisions/0003-public-core-private-cloud.md). Pricing y empaquetado
no forman parte de esta especificación pública.

## 12. Métricas técnicas

- Porcentaje de workflows completamente modelados.
- Distribución de confianza alta/media/baja.
- Error absoluto y porcentual del `expectedUsd` cuando exista verificación posterior; las sensibilidades no se evalúan como intervalo de cobertura.
- Porcentaje de proyecciones completas y de runs aceptados/excluidos.
- Requests de Actions por workflow y duración adicional de la Action.
- Tiempo de instalación y tiempo de ejecución.
- Incidentes de secretos o privacidad: objetivo absoluto cero.

## 13. Criterios de aceptación del MVP

El MVP está listo para beta pública cuando:

- analiza correctamente al menos 25 fixtures representativos;
- maneja matrices `include`/`exclude`, múltiples eventos y runners conocidos;
- trata un rename raíz→subdirectorio de `.github/workflows` como workflow eliminado y el inverso como agregado;
- identifica elementos desconocidos y reduce confianza sin fallar;
- genera exactamente el mismo reporte ante entradas idénticas;
- actualiza un comentario existente sin duplicarlo;
- funciona sin permiso de escritura mediante step summary;
- ningún test o log contiene credenciales reales;
- documentación y ejemplo de instalación pueden completarse en menos de 10 minutos;
- toda cifra muestra catálogo, supuestos y nivel de confianza;
- `history: false` no realiza consultas de runs/jobs;
- falta de `actions: read`, error de API o datos críticos parciales conservan el análisis estático;
- una proyección experimental nunca supera confianza media ni participa en `fail-on`;
- el JSON/Markdown histórico no expone identificadores crudos de runs o jobs;
- hasta cinco buckets no solapados cubren la ventana y la asignación proporcional nunca excede el cupo global 3–20;
- dos páginas completas permiten hasta 200 jobs; truncamiento/carrera de total excluyen el run completo;
- un run excluido mantiene frecuencia y media/p50/p95 observados, pero anula base/propuesta/delta mensual;
- runs completos vacíos o solo `skipped` valen cero;
- jobs `cancelled` sin duración positiva valen cero aun con runner desconocido; los cancelados con duración positiva requieren tarifa y se cobran normalmente;
- matriz estática de baja confianza o finding `invalid-job` mantiene baseline, pero anula propuesta/delta;
- un `total_count` superior a 1.000 sigue participando en frecuencia;
- el presupuesto global nunca permite más de 120 requests históricos y su agotamiento queda visible como fallback;
- una falla API esperada queda visible; un bug inesperado falla el check;
- contenido controlado por PR no puede activar HTML, links, formato o menciones en la salida;
- un cambio estructural en `on` conserva baseline, deja propuesta/delta mensual en `null` y emite confianza baja.

## 14. Dependencias externas y fuentes de verdad

- [Documentación de precios de GitHub Actions](https://docs.github.com/en/billing/reference/actions-runner-pricing)
- [Permisos de `GITHUB_TOKEN`](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication)
- [API REST de Actions](https://docs.github.com/en/rest/actions)
- [Límites de la API REST](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [Requisitos de GitHub Marketplace](https://docs.github.com/en/apps/github-marketplace/creating-apps-for-github-marketplace/requirements-for-listing-an-app)

El catálogo interno debe registrar URL, fecha de revisión, moneda y notas. Un cambio de precio no puede desplegarse sin fixtures de regresión y actualización de la fecha del catálogo.
