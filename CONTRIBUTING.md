# Contribuir

El proyecto está en una beta temprana. Por ahora se aceptan issues con reportes
reproducibles, preguntas de uso y feedback sobre resultados, pero no se aceptan
pull requests externos con código o documentación.

Esta restricción temporal permite cerrar la política de propiedad intelectual,
revisión de seguridad y procedencia antes de incorporar trabajo de terceros. No
envíes patches ni fragmentos sustanciales de código mediante issues. Un pull
request externo puede cerrarse sin merge aunque el cambio sea técnicamente útil.

Los problemas de seguridad no deben publicarse en un issue; seguí el canal
privado indicado en [SECURITY.md](SECURITY.md).

## Flujo local para mantenedores

    nvm use
    npm install
    npm run check

## Reglas para el motor

- Toda regla debe ser determinística y explicable.
- Toda regla nueva necesita al menos un caso positivo y uno negativo.
- Una recomendación no puede afirmar ahorro exacto sin datos de duración.
- Los falsos positivos se tratan como un defecto de producto.
- Los cambios de tarifas deben actualizar la fecha de la snapshot y sus pruebas.
- No se incorporan payloads, código o logs a telemetría.

## Cambios mantenidos dentro del proyecto

Mantenerlos pequeños e indicar:

- problema que resuelven;
- evidencia utilizada;
- nuevos supuestos;
- impacto esperado en falsos positivos;
- pruebas agregadas.

## Política futura de contribuciones

Antes de aceptar el primer pull request externo, el proyecto publicará términos
de contribución explícitos —por ejemplo, licencia de entrada igual a la licencia
MIT de salida y Developer Certificate of Origin, o un acuerdo específico si se
necesitara otra estructura—. Ningún código externo debe incorporarse hasta que
esa decisión esté vigente.

La licencia MIT del software no concede derechos sobre la marca CI Bill Doctor;
consultá [TRADEMARKS.md](TRADEMARKS.md).
