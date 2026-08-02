# CI Bill Doctor: laboratorio reproducible

Este directorio prepara un repositorio consumidor pequeño para validar CI Bill
Doctor en GitHub sin backend, secretos de repositorio ni permisos de escritura.
El laboratorio separa dos cosas:

- `template/`: estado inicial que se publica en la rama por defecto.
- `scenarios/`: cambios controlados que se aplican en ramas independientes.

El objetivo no es medir una factura exacta. Es comprobar que la Action se
instala con seguridad, distingue un pull request normal de un cambio de
workflow, detecta regresiones estáticas y degrada la proyección histórica sin
romper el análisis cuando GitHub no entrega datos suficientes.

## Qué cubre

| Escenario | Cambio | Resultado esperado |
|---|---|---|
| `normal-pr` | Agrega solo documentación | La Action informa que no encontró workflows agregados o modificados |
| `matrix-impact` | Linux ×2 pasa a macOS ×6 | Delta estático de `$0.0120/min` a `$0.3720/min`; aparecen `expensive-runner` y `large-matrix` |
| `trigger-expansion` | `push` limitado a `main` pasa a todas las ramas y agrega cron | El costo estático no cambia, aparece `duplicate-branch-triggers` y la propuesta mensual se omite porque cambió `on` |

El workflow guardián está preparado para validar:

- historial opt-in con una muestra de cinco runs;
- token integrado `${{ github.token }}`, sin secretos configurados por el usuario;
- permisos mínimos de solo lectura;
- pull requests provenientes de forks, sin comentarios ni
  `pull_request_target`.

## Prerrequisitos

- Node.js 22 o posterior;
- Git;
- un repositorio GitHub accesible que contenga CI Bill Doctor, incluido
  `action.yml` y `dist/action/index.cjs`;
- preferentemente un SHA de commit completo e inmutable para fijar la Action.

Para probar forks, el repositorio consumidor debe ser público. GitHub puede
pedir aprobación manual para la primera ejecución de un colaborador externo;
eso es una política de la plataforma, no un secreto ni una dependencia de este
laboratorio.

## 1. Comprobación local de los escenarios

Desde la raíz de CI Bill Doctor:

```bash
npm run cli -- compare \
  lab/template/.github/workflows/app-ci.yml \
  lab/scenarios/matrix-impact/overlay/.github/workflows/app-ci.yml

npm run cli -- compare \
  lab/template/.github/workflows/app-ci.yml \
  lab/scenarios/trigger-expansion/overlay/.github/workflows/app-ci.yml
```

La primera comparación debe mostrar un aumento de `$0.3600/min`. La segunda
debe conservar la tarifa y marcar que los triggers cambiaron en el JSON:

```bash
npm run cli -- compare \
  lab/template/.github/workflows/app-ci.yml \
  lab/scenarios/trigger-expansion/overlay/.github/workflows/app-ci.yml \
  --json
```

## 2. Crear el repositorio consumidor

El generador exige un destino inexistente para no sobrescribir trabajo. Sustituye
los placeholders del workflow por la ubicación real de la Action:

```bash
node lab/scripts/create-repository.mjs \
  --destination /tmp/ci-bill-doctor-lab \
  --action-repository OWNER/ci-bill-doctor \
  --action-ref COMMIT_SHA
```

Se recomienda reemplazar `/tmp/ci-bill-doctor-lab` por una ubicación
persistente. `COMMIT_SHA` debe ser el commit exacto que se desea validar; una
rama o tag también funciona para iteración, pero es menos reproducible.

El generador no inicializa Git, no crea repositorios remotos y no realiza
operaciones de red.

## 3. Publicar el baseline

Dentro del directorio generado:

```bash
git init -b main
git add .
git commit -m "chore: initialize CI Bill Doctor lab"
```

Después, crear un repositorio GitHub vacío y público y subir `main` mediante el
método habitual. Esta es una operación externa deliberadamente separada del
generador.

Antes de continuar, verificar en GitHub que existen estos workflows:

- `Application CI`;
- `CI Bill Doctor Lab`.

La primera incorporación del workflow guardián debe estar en `main` antes de
abrir los pull requests de prueba. GitHub no ejecuta retroactivamente un
workflow que todavía no existe en la rama por defecto.

## 4. Sembrar historial de forma controlada

La proyección solo se calcula para workflows modificados en un pull request y
usa el historial del archivo base. Para producir una muestra útil:

1. Abrir `Actions > Application CI > Run workflow`.
2. Ejecutar el workflow sobre `main` al menos cinco veces.
3. Esperar a que todas las ejecuciones y todos sus jobs terminen.
4. Confirmar que el repositorio conserva `actions: read` en
   `.github/workflows/ci-bill-doctor.yml`.

Las ejecuciones manuales cuentan porque la estimación usa runs completados de
ese workflow, sin limitarse a un tipo de evento. Los cinco runs solo permiten
validar la mecánica; no constituyen una muestra comercial ni una factura.

Si no hay cinco runs, un job queda truncado, un runner no tiene precio o la API
responde con permisos insuficientes, la Action debe conservar el análisis
estático y explicar por qué la proyección no está disponible. Ese fallback es
un resultado válido del laboratorio.

## 5. Ejecutar cada escenario

Cada escenario parte nuevamente desde `main`. No deben aplicarse uno encima de
otro.

Ejemplo para la matriz:

```bash
git switch main
git switch -c lab/matrix-impact
node /RUTA/A/ci-bill-doctor/lab/scripts/apply-scenario.mjs \
  --destination "$PWD" \
  --scenario matrix-impact
git add .
git commit -m "test: expand CI matrix onto macOS"
git push -u origin lab/matrix-impact
```

Abrir un pull request contra `main` y revisar el Step Summary de
`CI Bill Doctor Lab`. Repetir con ramas nuevas para:

```text
normal-pr
matrix-impact
trigger-expansion
```

El script solo aplica overlays locales. Rechaza destinos que no fueron creados
por el generador y evita sobrescribir archivos que ya difieran del baseline.

## 6. Resultados esperados

### Pull request normal

El cambio no toca `.github/workflows`. El guardián igualmente se ejecuta para
demostrar que una instalación global no molesta al desarrollo habitual. El
Step Summary debe indicar:

```text
No added or modified GitHub Actions workflow files were found.
```

### Impacto de runner y matriz

El baseline tiene dos copias Linux:

```text
2 × US$0.006/min = US$0.012/min
```

La propuesta tiene seis copias macOS:

```text
6 × US$0.062/min = US$0.372/min
```

El delta esperado es `+US$0.360/min`. Con historial completo, la Action también
muestra un baseline mensual `gross-equivalent` y escala el escenario propuesto
por la relación estática `31×`. No debe interpretarse como una factura.

### Expansión de triggers

La matriz y el runner no cambian, por lo que el delta por minuto queda en cero.
Se espera la regla `duplicate-branch-triggers`. Como la estructura de `on`
cambió, el baseline histórico puede mostrarse, pero `proposed` y `delta`
mensuales deben quedar como desconocidos.

## 7. Prueba desde un fork

1. Crear un fork del repositorio consumidor público.
2. Aplicar `matrix-impact` en una rama del fork.
3. Abrir el pull request contra el repositorio original.
4. Si GitHub solicita aprobación de la ejecución, aprobarla desde la interfaz.
5. Verificar el Step Summary; no debe intentarse escribir comentarios.

El guardián usa únicamente:

```yaml
permissions:
  actions: read
  contents: read
  pull-requests: read
```

Además, `comment: "false"` es deliberado. No cambiar este laboratorio a
`pull_request_target`: ejecutar código o una Action modificable por un fork con
un token de escritura ampliaría innecesariamente el riesgo. Si la lectura de
historial no está disponible para un fork, el comportamiento esperado es el
fallback estático documentado.

## 8. Criterios de salida

El laboratorio se considera aprobado cuando:

- el PR normal termina sin findings ni errores;
- el PR de matriz muestra las tarifas y findings esperados;
- el PR de triggers detecta el cambio de frecuencia potencial;
- al menos una comparación muestra proyección histórica o un fallback
  explícito y comprensible;
- el PR desde fork funciona con permisos de solo lectura;
- ninguna ejecución requiere secretos, backend o comentario en el PR;
- el JSON de salida está disponible como output de la Action y el Markdown se
  ve correctamente en Step Summary.

Registrar manualmente URL del run, SHA probado, resultado y cualquier diferencia
en un issue local o en la bitácora de validación. No agregar tokens, contenido de
logs ni identificadores privados al reporte.
