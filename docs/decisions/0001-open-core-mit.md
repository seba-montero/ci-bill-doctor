# ADR 0001 — Núcleo abierto bajo MIT

**Estado:** aceptada
**Fecha:** 1 de agosto de 2026

## Contexto

CI Bill Doctor analiza archivos de workflows y debe ser auditable antes de que
un maintainer lo use en repositorios públicos o privados. El código distribuido
debe poder compararse con su fuente y funcionar sin enviar el workflow a un
servicio externo.

## Decisión

Se adopta un modelo open-core:

- parser, motor determinístico, catálogo de precios, CLI y GitHub Action se
  publican bajo licencia MIT;
- el análisis estático útil permanece disponible sin cuenta ni backend;
- el bundle distribuible se genera desde el código del repositorio;
- la lógica no ejecuta comandos declarados por workflows;
- el core no envía telemetría;
- futuras funciones alojadas pueden ser comerciales.

El repositorio continúa marcado como private en package.json únicamente para
evitar una publicación accidental en npm durante la validación. Esto no limita
la licencia ni la publicación del repositorio en GitHub.

La decisión posterior [ADR 0002](0002-ephemeral-history.md) refinó esta frontera:
el cálculo histórico efímero y local permanece en el núcleo MIT; persistencia,
agregación y verificación longitudinal permanecen fuera del core.
La [ADR 0003](0003-public-core-private-cloud.md) establece repositorios separados
para el core público y la plataforma comercial privada.

## Razones

- reduce el riesgo percibido al pedir permisos;
- permite auditoría de seguridad y metodología;
- facilita revisión y reutilización por la comunidad;
- facilita una Action reproducible y fijable por SHA;
- mantiene el analizador útil sin depender de un servicio alojado.

## Consecuencias

Positivas:

- onboarding más simple;
- mayor confianza para repositorios privados;
- posibilidad de contribuciones y fixtures reales;
- menor necesidad de venta asistida.

Negativas:

- competidores pueden reutilizar el motor;
- hay que mantener una frontera clara con el servicio alojado;
- la ventaja no puede depender únicamente de reglas estáticas.

## Criterio de revisión

Revisar la frontera antes de incorporar una dependencia del servicio alojado o
cambiar el alcance del core. La licencia del código ya publicado no se revocará
retroactivamente.
