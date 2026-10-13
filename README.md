# Avisos de construcciones LEGO gratuitas

Detecta eventos de tiendas LEGO de España en los que construyes un modelo y te lo llevas gratis. Barcelona está configurada por defecto. Excluye promociones con compra y deja pendientes de revisión los talleres, sorteos o sorpresas que no confirman la entrega de un modelo.

Consulta la API interna de LEGO sin navegador. Si falla, intenta leer los mismos datos del JSON incluido en la página oficial. Ambas fuentes son internas y pueden cambiar: los errores se notifican como fallos, no como ausencia de eventos.

## Puesta en marcha

El plan de mejoras y el registro de comprobaciones se mantienen en [PLAN.md](PLAN.md). Las instrucciones de continuidad están en [AGENTS.md](AGENTS.md).

Necesitas Node.js 22.16 o superior.

```sh
npm ci
npm run scan
```

En PowerShell, si la política de ejecución bloquea `npm.ps1`, usa `npm.cmd`.

`scan` consulta LEGO y muestra eventos confirmados, descartados y pendientes de revisión. **No envía correos, no escribe estado y no modifica calendarios.** Se puede usar sin ninguna credencial.

`npm run preview` guarda una vista del correo en HTML y el archivo de calendario `.ics` en `.data/preview/`, también sin enviar ni modificar tu cuenta. Abre el HTML en un navegador para revisar el botón y el aviso, o importa el `.ics` en Google Calendar.

Para activar los avisos:

1. Copia `.env.example` a `.env.local`.
2. Configura el correo y, si quieres creación automática, conecta Google Calendar.
3. Ejecuta `npm run scan` para revisar los resultados.
4. Ejecuta `npm run sync` para enviar avisos y sincronizar el calendario.

Los archivos locales de configuración y estado están excluidos de Git. Las variables del entorno tienen prioridad sobre `.env.local`, y `.env.local` sobre `.env`.

## Correo y calendario con un clic

Configura `GMAIL_USER`, `GMAIL_PASSWORD` y `EMAIL_TO`. Usa una [contraseña de aplicación de Google](https://support.google.com/accounts/answer/185833), no tu contraseña habitual. `EMAIL_TO` acepta direcciones separadas por comas; si está vacío se utiliza `GMAIL_USER`. No hay destinatarios personales fijados en el código.

Cada aviso incluye imagen cuando está disponible, condiciones oficiales, ubicación, sesiones, botón para añadir a Google Calendar y un archivo `.ics` compatible con otros calendarios. Los cambios generan un aviso de actualización. Si ya hay un evento creado automáticamente, el botón abre ese evento.

Una fecha incompleta o ambigua se conserva en el aviso como información pendiente y no se inventa una hora para el calendario. Las fechas sin año se resuelven por proximidad a la fecha de consulta, con límites para evitar convertir anuncios antiguos en eventos futuros. Los horarios usan `Europe/Madrid` y los archivos `.ics` usan UTC, incluido el cambio de hora.

## Creación automática en Google Calendar

Este modo **crea eventos en tu cuenta**, sin tener que pulsar el botón del correo. También actualiza título, descripción y horario cuando cambian, con recordatorios un día y una hora antes. No añade invitados ni envía invitaciones.

1. Crea un proyecto en [Google Cloud](https://console.cloud.google.com/) y habilita **Google Calendar API**.
2. Configura la pantalla de consentimiento de OAuth. Si está en pruebas, añade tu cuenta como usuario de prueba.
3. Crea un cliente OAuth de tipo **Aplicación de escritorio** y guarda `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en `.env.local`.
4. Opcionalmente crea un calendario dedicado, por ejemplo «LEGO gratis», y copia su identificador desde Configuración → Integrar calendario a `GOOGLE_CALENDAR_ID`. Por defecto se utiliza `primary`.
5. Ejecuta:

```sh
npm run calendar:connect
```

Abre el enlace mostrado y autoriza tu cuenta. La conexión usa un callback local, estado aleatorio y PKCE. El token se guarda en `.env.local` sin mostrarse en consola y activa `GOOGLE_CALENDAR_ENABLED=true`.

6. Ejecuta `npm run sync`. Para recibir solo eventos de calendario, configura `EMAIL_ENABLED=false`.

En aplicaciones externas de Google que permanecen en modo de prueba, los refresh tokens de estos permisos suelen caducar a los siete días. Para uso continuo, configura el consentimiento para producción según los requisitos de Google. Si se revoca el acceso, vuelve a ejecutar la conexión. [Caducidad de los tokens en Google OAuth](https://developers.google.com/identity/protocols/oauth2?hl=en#expiration).

Para desplegar, configura las variables de Google en Vercel por su panel de entorno; no publiques `.env.local` ni pegues tokens en registros. Usa credenciales diferentes para pruebas y producción si ambas van a sincronizar calendarios.

## Calendario por suscripción, sin contraseña de Gmail ni OAuth

Activa `CALENDAR_FEED_ENABLED=true`, configura un `CALENDAR_FEED_TOKEN` aleatorio de al menos 32 caracteres y, si quieres usar únicamente esta opción, deja `EMAIL_ENABLED=false` y `GOOGLE_CALENDAR_ENABLED=false`.

El cron guarda los eventos confirmados en Redis. El calendario se publica en `https://TU-DOMINIO/calendar/TU-TOKEN.ics`; su consulta no envía correos ni vuelve a consultar LEGO. Mantén privada esa URL.

En Google Calendar desde el ordenador, abre **Otros calendarios → + → Desde URL**, pega la dirección completa y añade el calendario. Los eventos aparecen en un calendario separado, de solo lectura, sin necesidad de un cliente OAuth. Se puede usar también con otros clientes que admitan suscripciones iCalendar. [Instrucciones de Google](https://support.google.com/calendar/answer/37100?hl=es).

Google decide cuándo vuelve a descargar los calendarios externos: los cambios del cron no aparecen de forma instantánea. El servidor conserva los eventos confirmados cuando un anuncio desaparece, hasta que terminen; retira los que cambian a promoción con compra o dejan de estar confirmados. Si LEGO falla temporalmente, se conserva la última información válida disponible.

El archivo `.vercelignore` evita subir archivos `.env`, datos locales, pruebas y dependencias instaladas al despliegue.

## Estado, duplicados y recuperación

- En local se guarda `.data/state.json`, con escritura atómica y bloqueo entre procesos. También puede usarse en un servidor con volumen persistente y un planificador externo.
- En Vercel es obligatorio conectar **Upstash Redis**. Se admiten `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN`, o las variables `KV_REST_API_URL` y `KV_REST_API_TOKEN` que añade la integración de Vercel. El disco temporal de una función no sirve para evitar duplicados.
- Se registran por separado los correos enviados y las sesiones sincronizadas. Si un canal falla, el siguiente intento reanuda ese canal sin repetir los que terminaron correctamente.
- Los eventos de Google tienen identificadores deterministas; un reintento o cambio de horario actualiza el evento existente.
- El bloqueo de Redis dura diez minutos; el trabajo tiene un presupuesto de cuatro minutos y comprueba el bloqueo antes de escribir o enviar. El bloqueo local tiene comprobación periódica de actividad.
- Si un anuncio elimina una sesión futura y su nuevo horario es inequívoco, se elimina esa sesión del calendario. Si desaparece el anuncio completo, no se supone que está cancelado: puede haber dejado de publicarse por otros motivos.

Los avisos se envían individualmente y se registran por destinatario. Añadir una dirección no repite los avisos para los destinatarios anteriores. Se migra el seguimiento de los envíos antiguos a la lista configurada en el entorno; conviene conservar `EMAIL_TO` durante la migración y editar desde el panel a partir de entonces. El correo SMTP no ofrece entrega exactamente una vez: si Gmail acepta un mensaje pero se pierde la respuesta, o falla el guardado posterior, un reintento puede repetirlo. El `Message-ID` es estable para ese aviso. En usos que necesiten esa garantía, conviene un proveedor con claves de idempotencia.

## Portada y panel privado

La portada muestra públicamente los próximos eventos confirmados, con imagen oficial, tienda, horarios de Madrid, condiciones y enlaces para abrir el anuncio o añadir una sesión a Google Calendar. No necesitas iniciar sesión para consultarlos.

`GET /api/events` lee el estado ya sincronizado en Redis y publica únicamente datos del anuncio. No consulta LEGO ni envía correos; no incluye destinatarios, preferencias o la URL privada de suscripción. Las sesiones terminadas se filtran en cada petición. La portada lee esta lista cada minuto mientras está visible e indica la fecha de la última consulta de la fuente, los fallos y los datos con más de 48 horas. La muestra del correo y del calendario está marcada como ejemplo visual y no se añade a los eventos reales.

La portada se sirve en `/` y el panel en `/admin`, con acceso en `/login`. No hay registro público. El panel incluye:

- Eventos confirmados y calendario mensual con horas de Madrid y enlaces oficiales.
- Destinatarios editables, pausa individual y pausa general. Las preferencias se guardan en Redis sin desplegar de nuevo. `EMAIL_TO` y `EMAIL_ENABLED` se utilizan como valores iniciales hasta guardar las preferencias desde el panel.
- Consulta manual de LEGO, con envío de avisos pendientes. El cron diario sigue funcionando. Guardar preferencias no envía mensajes por sí mismo.
- Prueba de correo para destinatarios guardados, incluso con avisos pausados. La aceptación SMTP no demuestra recepción en la bandeja de entrada: comprueba spam.
- URL privada de suscripción al calendario, fecha de última consulta correcta por tienda, anuncios excluidos e historial de las últimas 50 operaciones.

Para configurar el acceso:

1. Ejecuta `npm run admin:setup`. Genera una contraseña aleatoria en `.data/admin-access.txt` y guarda `ADMIN_PASSWORD_HASH` y `SESSION_SECRET` en `.env.local`.
2. Configura esas dos variables como secretos en **Production** de Vercel. El servidor guarda un hash con sal de la contraseña; nunca la contraseña en claro.
3. Configura `APP_URL` con el dominio público estable, sin rutas, para el enlace de suscripción. Si no está, se usa `VERCEL_PROJECT_PRODUCTION_URL` cuando esté disponible.
4. Despliega y entra en `/login` con la contraseña del archivo privado. Las sesiones duran seis horas; en Vercel se guardan en Redis y funcionan entre instancias. En local se usa memoria para las sesiones.

Para cambiar la contraseña: `npm run admin:setup -- --rotate`, actualiza ambos secretos y despliega. Eso invalida las cookies anteriores. No compartas `.data/admin-access.txt`, `.env.local` ni la URL del calendario. Las credenciales de Gmail y Google permanecen en el entorno del servidor.

El acceso usa cookies `HttpOnly`, `SameSite=Strict` y `Secure` en Vercel, regeneración de sesión, comprobación de origen y token CSRF. Los intentos de acceso se limitan a diez por IP cada quince minutos; las consultas manuales y las pruebas de correo a una por minuto. Las escrituras comparten el bloqueo con el cron y rechazan cambios guardados desde una versión antigua.

El panel refresca el estado visible cada minuto mientras no estés editando destinatarios. Ese refresco lee Redis: **no vuelve a consultar LEGO**. El botón «Actualizar LEGO» consulta la fuente y actualiza el calendario del panel. Google controla su propia frecuencia de actualización de la suscripción.

## Servidor y Vercel

```sh
npm start
```

- `GET /health`: comprueba que el servidor está disponible.
- `GET /sendLego`: ejecuta la sincronización.
- `GET /sendLego?dryRun=true`: consulta sin efectos externos.

Las dos variantes de `/sendLego` requieren `Authorization: Bearer <CRON_SECRET>`. El secreto no se acepta en la URL. Un trabajo concurrente devuelve `409`; los fallos de fuentes o canales devuelven `502`; los errores de configuración o estado devuelven `500` y el detalle queda en los registros del servidor.

`vercel.json` conserva la consulta diaria a las **03:05 UTC**. Selecciona Node.js 22 o superior en el proyecto, conecta Upstash y configura correo, `CRON_SECRET` y, opcionalmente, Google Calendar. Vercel añade automáticamente la cabecera de autorización del cron. El cron funciona en producción; `npm start` no instala un planificador local. [Express en Vercel](https://vercel.com/docs/frameworks/backend/express) · [Cron y autorización](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

## Comprobaciones

```sh
npm run check
npm test
npm run scan
```

Las pruebas usan los anuncios públicos de Barcelona capturados como fixture y dobles de correo, Google y almacenamiento. Comprueban filtros, horarios, horario de verano, fallback, archivos de calendario, autorización, concurrencia, actualizaciones y recuperación de errores. La consulta `scan` valida las fuentes reales actuales; el envío real necesita credenciales configuradas.

Para las pruebas del navegador, instala Chromium con `npx playwright install chromium` y ejecuta `npm run test:e2e`. También puedes usar Chrome instalado poniendo `PLAYWRIGHT_CHANNEL=chrome` (en PowerShell: `$env:PLAYWRIGHT_CHANNEL='chrome'`). El servidor de pruebas usa datos y credenciales ficticios, sin correos reales. Comprueba acceso, edición persistente, calendario, copia de URL, actualización, cierre de sesión y vista móvil; guarda capturas privadas en `.data/qa/`.
