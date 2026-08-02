# Seguridad

## Versiones soportadas

Mientras el proyecto está en beta, solo la última release publicada recibe
correcciones de seguridad. Las revisiones de `main` son de desarrollo y no se
consideran una versión soportada.

## Modelo de datos del MVP

CI Bill Doctor procesa workflows de GitHub Actions. Con `history: "true"` también
lee metadatos de runs y jobs completados para calcular agregados. No debe leer ni
almacenar otros archivos de código fuente, secretos, variables protegidas, logs o
artifacts de ejecución.

## Permisos mínimos

- `contents: read` para recuperar las revisiones de workflows.
- `pull-requests: read` para listar los archivos modificados del pull request.
- `actions: read` únicamente si se habilita `history`.
- `pull-requests: write`, en lugar de `read`, únicamente si se habilitan comentarios.

El comentario y el historial están deshabilitados por defecto. No se recomienda
`pull_request_target`: ampliar permisos para ejecutar un pull request no confiable
introduciría un riesgo mayor que el valor de la proyección.

## Historial efímero

La consulta histórica usa una ventana y muestra acotadas. Los datos se procesan
en memoria dentro del runner y no se persisten ni se envían a un backend. El
reporte expone conteos, percentiles, rangos y diagnósticos agregados; no incluye
IDs de runs/jobs, nombres de jobs ni labels de runners obtenidos del historial.

No se descargan logs, artifacts ni datos de billing. Ante permisos insuficientes,
rate limits, respuestas parciales o datos no tarifables, la Action continúa con
el análisis estático.

## Reporte de problemas

Reportar vulnerabilidades mediante
[Private Vulnerability Reporting](https://github.com/seba-montero/ci-bill-doctor/security/advisories/new).
No publicar tokens, workflows privados, payloads completos ni detalles
explotables en un issue público.

## Límites

El analizador no ejecuta comandos declarados en workflows y no evalúa expresiones
de GitHub. Las expresiones dinámicas se clasifican como desconocidas. La
proyección es un escenario bruto equivalente y no debe usarse como conciliación
de factura ni como único criterio para bloquear un merge durante la beta.
