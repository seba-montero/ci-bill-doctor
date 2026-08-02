# ADR 0002 — Historial efímero abierto; persistencia como servicio

**Estado:** aceptada
**Fecha:** 1 de agosto de 2026
**Refina:** [ADR 0001](0001-open-core-mit.md)

## Contexto

La señal estática detecta regresiones estructurales, pero no demuestra por sí
sola cuánto se ejecuta un workflow ni cuánto duran sus jobs. Persistir historial
fuera del runner agregaría costo, permisos y superficie de seguridad sin ser
necesario para producir la primera proyección.

Esta decisión refina ADR 0001 sin modificar la licencia del núcleo.

## Decisión

La consulta histórica local, opt-in y sin persistencia forma parte del núcleo
MIT. Su objetivo es validar si un escenario basado en runs reales produce valor
antes de construir infraestructura comercial.

- `history` permanece deshabilitado por defecto y requiere `actions: read`.
- Los metadatos se procesan en memoria dentro del runner.
- No se descargan logs, artifacts ni información de billing.
- El reporte conserva únicamente agregados y diagnósticos sanitizados.
- La cifra se denomina `gross-equivalent`, no factura ni costo neto.
- La muestra se estratifica en el tiempo y se asigna por volumen de runs.
- Un rango mensual requiere cobertura completa de la muestra tarifable.
- El mensual esperado usa media por run; p50/p95 son sensibilidades por run, no
  percentiles del agregado mensual.
- La confianza se limita a `medium` durante el rollout.
- Un cambio en `on` conserva el baseline, pero invalida proposed/delta mensual.
- Una falla histórica degrada al análisis estático y no falla el check.

La persistencia y los servicios alojados permanecen fuera de este repositorio.

## Consecuencias

La versión gratuita demuestra más valor y permite medir exactitud sin operar un
backend. A cambio, el primer cálculo histórico deja de ser una frontera de cobro
y aumenta el consumo de API/minutos del job del usuario cuando se habilita.

La proyección debe medir sesgo de muestra, disponibilidad y error antes de
aumentar confianza o usarse para políticas automáticas.

## Criterio de revisión

Revisar esta frontera antes de introducir persistencia o una dependencia de red.
Una revisión no puede retirar retroactivamente capacidades ya publicadas bajo
MIT.
