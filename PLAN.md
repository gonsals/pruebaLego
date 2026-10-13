# Plan de evolución — Avisos LEGO

Última revisión: 2026-10-13.

## Objetivo de esta entrega

Añadir una portada y un panel privado en la aplicación Express desplegada en Vercel. Permitir gestionar destinatarios sin editar variables ni desplegar, consultar eventos y calendario, actualizar LEGO manualmente y ver el estado real de los avisos.

## Forma de trabajar

Este plan se revisa antes de cada cambio. Se actualizan las tareas al terminarlas, junto con la validación y las limitaciones observadas. Cada nueva mejora se incorpora aquí antes de implementarla. No se almacenan credenciales en este documento ni en Git.

## Primera entrega

- [x] Revisar código, persistencia, calendario y configuración actuales.
- [x] Añadir configuración editable en Redis: destinatarios, pausas y envío de correo.
- [x] Separar los avisos por destinatario para evitar reenvíos y mostrar direcciones ajenas.
- [x] Guardar intentos, última consulta correcta, decisiones e historial limitado de actividad.
- [x] Proteger el panel con acceso de administrador y sesiones compartidas en Redis.
- [x] Crear portada, acceso y panel adaptable a móvil con eventos, calendario y destinatarios.
- [x] Añadir actualización manual, prueba de correo y enlace de suscripción al calendario.
- [x] Verificar permisos, sesiones, cambios de destinatarios, reintentos y flujo completo.
- [ ] Configurar acceso en Vercel, desplegar y comprobar la aplicación publicada.
- [ ] Actualizar documentación, registrar resultado y publicar cambios en GitHub.

## Decisiones

- Mantener Express, Redis y Vercel; la suscripción existente del calendario conserva su URL.
- Guardar preferencias de uso en Redis. Credenciales de Gmail, Redis, cron y administrador permanecen en el entorno del servidor.
- Acceso de un administrador para esta primera versión; no abrir registros públicos.
- El panel muestra datos de nuestra aplicación y la fecha de su consulta. Google decide cuándo refresca su propia suscripción.
- La actualización manual modifica el calendario y envía únicamente avisos pendientes a los destinatarios activos.
- Mantener lectura y compatibilidad del estado existente. Evitar repetir avisos al migrar el seguimiento de destinatarios.
- Conservar los datos anteriores cuando una fuente falle y distinguir último intento de última consulta correcta.

## Verificación prevista

- Pruebas de integración de acceso, autorización, CSRF, edición persistente y acciones del panel.
- Envío individual y deduplicación por destinatario, incluyendo listas ampliadas y fallos parciales.
- Consulta real de LEGO y persistencia desde el despliegue, sin envíos de prueba no solicitados.
- Revisión visual cuando exista un navegador disponible. Si no lo hay, registrar la limitación y comprobar HTML, recursos y flujo HTTP.
- Comprobar que `.env`, datos locales y claves no entren en Git ni en el despliegue.

## Siguientes entregas

1. Selección de otras tiendas y filtros por edad.
2. Recordatorios antes del evento, separados del aviso de novedades.
3. Revisión manual de anuncios ambiguos con motivo y enlace oficial.
4. Avisos de fallos persistentes y recuperación del servicio.

## Registro

- 2026-10-13: plan inicial documentado; comienzo del panel privado y de la gestión persistente de destinatarios.
- 2026-10-13: implementados portada, panel, sesiones Redis, CSRF, límites de acciones, preferencias con revisión para evitar sobrescrituras, deduplicación por destinatario e historial de 50 operaciones. Pasan 62 pruebas de servidor y 2 pruebas de navegador Chrome; revisión de capturas de escritorio y móvil. Correo y fuente simulados en las pruebas del panel.
- 2026-10-13: comprobado proyecto de Vercel y configuración actual. Los avisos están activados en producción; se conserva esa preferencia y la URL existente del calendario. Pendiente verificar el despliegue con Redis y LEGO reales.
- 2026-10-13: verificados acceso y guardado real en Redis, consulta manual de LEGO (1 evento, 0 fallos, 0 correos repetidos) y misma URL de calendario. Chrome publicado confirma cookie segura, calendario, cierre de sesión y móvil sin desbordamiento. Detectada una carrera al enviar el formulario antes de preparar la sesión: corregir con una única petición inicial y prueba con respuesta retrasada antes de cerrar la entrega.
- 2026-10-13: corregida la carrera del acceso; la prueba de navegador con sesión retrasada pasa. Los recursos sin nombre versionado se revalidan al cargarlos para evitar conservar JavaScript de un despliegue anterior. Pasan las 3 pruebas de navegador. Pendiente publicar esta corrección y registrar la comprobación final.
