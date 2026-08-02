# ADR 0003 — Core público y plataforma comercial privada

**Estado:** aceptada
**Fecha:** 2 de agosto de 2026
**Refina:** [ADR 0001](0001-open-core-mit.md) y [ADR 0002](0002-ephemeral-history.md)

## Contexto

La distribución orgánica de una GitHub Action depende de un repositorio público,
una implementación auditable y una versión gratuita útil. Al mismo tiempo, MIT
permite uso, modificación, distribución y comercialización por terceros. La
monetización no puede depender de que el analizador estático sea secreto.

El riesgo principal de la etapa actual sigue siendo no conseguir adopción. El
riesgo de clonación existe y se limita manteniendo fuera del repositorio público
las capacidades operativas que generan recurrencia, datos longitudinales y
coordinación entre equipos.

## Decisión

Se separan explícitamente dos productos y repositorios.

### `ci-bill-doctor` — público bajo MIT

- parser y normalización de workflows;
- catálogo público de precios;
- motor determinístico y reglas explicables;
- CLI y GitHub Action;
- comparación base/head;
- cálculo histórico efímero dentro del runner;
- formatos Markdown/JSON;
- fixtures, laboratorio reproducible y documentación de metodología.

La versión pública permanece útil sin cuenta, licencia comercial ni backend.

### `ci-bill-doctor-cloud` — privado y propietario

- autenticación, organizaciones y miembros;
- instalaciones, entitlements y límites de planes;
- checkout, billing y webhooks;
- persistencia histórica longitudinal;
- agregación multi-repositorio;
- ahorro verificado después de cambios;
- políticas y presupuestos por organización;
- reportes programados y notificaciones;
- datasets derivados, benchmarks y señales operativas propias;
- administración, soporte y observabilidad del servicio.

El repositorio privado no reutilizará la licencia MIT como licencia global. Si
consume el paquete público, conservará sus avisos donde corresponda, pero el
código nuevo del servicio seguirá siendo propietario.

### Marca

La licencia MIT permite redistribuir y comercializar el software, pero no se
presenta como autorización para hacer pasar un fork, redistribución o servicio
como la oferta oficial. El uso nominativo y la atribución veraz permanecen
permitidos. El nombre y la identidad visual se administran mediante
[`TRADEMARKS.md`](../../TRADEMARKS.md). Antes de depender comercialmente de la
marca o invertir de manera material en ella se realizará una búsqueda
profesional de disponibilidad.

## Controles de frontera

- No incorporar secretos, billing, cuentas o persistencia comercial al core.
- No hacer que el core dependa del servicio pago para su función gratuita.
- Definir contratos API desde el repositorio privado; publicar solo el cliente
  mínimo que sea necesario para interoperar.
- No publicar datos privados, benchmarks o señales derivadas sin consentimiento.
- Revisar cada función nueva contra esta ADR antes de elegir repositorio.
- Mantener historial de terceros y avisos de licencia para dependencias o código
  incorporado.

## Consecuencias

Positivas:

- conserva confianza, auditabilidad y distribución en GitHub Marketplace;
- un fork recibe los derechos sobre el software que concede MIT, pero no
  autorización para presentarse como la distribución o el servicio oficial ni
  para usar la marca fuera de la política publicada;
- el servicio puede evolucionar sin convertir la Action gratuita en un demo;
- el costo variable del core permanece a cargo del runner del usuario.

Negativas:

- terceros pueden comercializar el core MIT o construir un servicio alternativo;
- la ventaja debe venir de ejecución, distribución, datos permitidos y producto;
- mantener dos repositorios exige contratos claros y disciplina de frontera;
- la política de marca y cualquier estrategia de licenciamiento futura requieren
  revisión profesional antes de depender de su exigibilidad.

## Criterio de revisión

Revisar esta decisión antes de introducir el primer componente propietario
consumido por la Action o de cambiar la frontera de datos. El código ya
publicado bajo MIT continuará disponible bajo los términos recibidos; los
cambios de licencia solo podrán aplicarse prospectivamente y según los derechos
de autor correspondientes.
