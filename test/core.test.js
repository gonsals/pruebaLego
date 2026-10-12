const test = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const fixture = require('./fixtures/barcelona.json');
const { classifyEvent } = require('../lib/classify');
const { parseSchedule } = require('../lib/dates');
const { createIcs, googleCalendarLink, calendarEventId } = require('../lib/calendar');
const { buildMail } = require('../lib/email');
const { discover, runScan } = require('../lib/scan');
const { getConfig, validateDelivery } = require('../lib/config');

const now = new Date('2026-10-12T08:00:00Z');
const quiet = { log() {}, warn() {}, error() {} };
const client = { store: async () => structuredClone(fixture.store), event: async card => structuredClone(fixture.events.find(e => e.urlKey === card.urlKey)) };
const schedule = (text, date = now) => parseSchedule({ subHeading: text }, { now: date });

test('Los cinco anuncios reales solo confirman el modelo que puedes llevarte', async () => {
    const result = await discover(getConfig({}), { client, now });
    assert.equal(result.failures.length, 0);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].urlKey, 'ghost-street-barcelona');
    assert.equal(result.events[0].sessions[0].start, '2026-10-24T10:00:00+02:00');
    assert.equal(result.decisions.find(d => d.title.includes('Privado')).status, 'excluded');
    assert.equal(result.decisions.find(d => d.title.includes('Halloween')).status, 'review');
});

test('No basta con decir gratis, casa o sorpresa', () => {
    for (const event of [
        { heading: 'Taller gratis', description: 'Construye en la tienda' },
        { heading: 'La casa LEGO', description: 'Descubre este producto' },
        { heading: 'Llévate una sorpresa a casa', description: 'Hasta fin de existencias' },
    ]) assert.notEqual(classifyEvent(event).status, 'confirmed');
});

test('Se excluyen modelos gratuitos condicionados a una compra', () => {
    assert.equal(classifyEvent({ heading: 'Construye un modelo y llévatelo a casa gratis', description: 'Con compras de 100 €' }).status, 'excluded');
});

test('Las negaciones de compra conservan las construcciones gratuitas', () => {
    const event = { heading: 'Construye un modelo y llévatelo a casa gratis', description: 'Sin necesidad de comprar. El modelo no está a la venta.' };
    assert.equal(classifyEvent(event).status, 'confirmed');
});

test('El formato real con h y espacio no separable se interpreta', () => {
    assert.equal(schedule('24/10 - De 10:00\u00a0h a 14:00\u00a0h').sessions.length, 1);
});

test('Horarios con año, puntos y guion, y varias sesiones', () => {
    assert.equal(schedule('24/10/2026 | 9.30 h - 11.00 h').sessions[0].start, '2026-10-24T09:30:00+02:00');
    assert.equal(schedule('24/10 y 25/10 - De 10:00 a 12:00 y de 16:00 a 18:00').sessions.length, 4);
});

test('Fechas escritas con mes y horas sin minutos', () => {
    assert.equal(schedule('24 y 25 de octubre de 2026 - De 10 h a 14 h').sessions.length, 2);
});

test('El año se resuelve correctamente al cruzar diciembre y enero', () => {
    assert.equal(schedule('02/01 - De 10:00 a 12:00', new Date('2026-12-30T12:00:00Z')).sessions[0].start, '2027-01-02T10:00:00+01:00');
    assert.equal(schedule('28/12 - De 10:00 a 12:00', new Date('2027-01-02T12:00:00Z')).expired, true);
});

test('Anuncios antiguos no se convierten en eventos futuros', () => {
    assert.equal(schedule('10/10/2025 - De 10:00 a 12:00').expired, true);
    const stale = schedule('01/05 - De 10:00 a 12:00');
    assert.equal(stale.sessions.length, 0);
    assert.ok(stale.issues.length);
});

test('No se inventan horarios, rangos o fechas inválidas', () => {
    for (const text of ['24/10', 'Del 24 al 31 de octubre - De 10:00 a 14:00', '31/02/2026 - De 10:00 a 14:00', '24/10 - De 14:00 a 10:00', '24/10 - De 25:00 a 26:00']) {
        const parsed = schedule(text);
        assert.equal(parsed.sessions.length, 0, text);
        assert.ok(parsed.issues.length, text);
    }
});

test('Se usan los offsets reales de Madrid después del cambio de hora', () => {
    assert.equal(schedule('26/10/2026 - De 10:00 a 14:00').sessions[0].start, '2026-10-26T10:00:00+01:00');
});

test('No se crean horas inexistentes o duplicadas por cambio de hora', () => {
    for (const [text, date] of [
        ['29/03/2026 - De 02:15 a 04:00', new Date('2026-03-01T12:00:00Z')],
        ['25/10/2026 - De 02:15 a 04:00', now],
    ]) assert.equal(schedule(text, date).sessions.length, 0);
});

test('Los identificadores de sesiones no cambian al terminar la primera sesión', () => {
    const text = '24/10/2026 - De 10:00 a 12:00\n25/10/2026 - De 10:00 a 12:00';
    const before = schedule(text), after = schedule(text, new Date('2026-10-24T13:00:00Z'));
    assert.equal(after.sessions[0].slot, before.sessions[1].slot);
});

test('El modo consulta no usa almacenamiento ni notificaciones', async () => {
    let calls = 0;
    const fail = () => { calls++; throw new Error('Efecto externo inesperado'); };
    const result = await runScan(getConfig({}), { dryRun: true, client, now, store: { withLock: fail }, email: { send: fail }, calendar: { upsert: fail } });
    assert.equal(result.events.length, 1);
    assert.equal(calls, 0);
});

test('Una fuente caída se informa como error y no como ausencia de regalos', async () => {
    const result = await discover(getConfig({}), { client: { store: async () => { throw new Error('LEGO inaccesible'); } }, now });
    assert.equal(result.failures.length, 1);
});

test('Enlace de Google e ICS apuntan al mismo instante e incluyen lugar y descripción', async () => {
    const { events: [event] } = await discover(getConfig({}), { client, now });
    const params = new URL(googleCalendarLink(event, event.sessions[0])).searchParams;
    assert.equal(params.get('dates'), '20261024T080000Z/20261024T120000Z');
    assert.equal(params.get('ctz'), 'Europe/Madrid');
    assert.ok(params.get('location').includes('Passeig de Gràcia'));
    const ics = createIcs(event, { now });
    assert.ok(ics.includes('DTSTART:20261024T080000Z'));
    assert.ok(ics.includes('DTEND:20261024T120000Z'));
    assert.ok(ics.includes(`UID:${calendarEventId(event, 0)}`));
    assert.ok(ics.split('\r\n').every(line => Buffer.byteLength(line, 'utf8') <= 75));
    assert.equal(DateTime.fromISO(event.sessions[0].start).toUTC().hour, 8);
});

test('Correo multipart con ICS, HTML escapado y enlace al evento sincronizado', async () => {
    const { events: [event] } = await discover(getConfig({}), { client, now });
    event.heading = '<script>alert("x")</script>';
    const mail = buildMail(event, { to: ['test@example.com'], from: 'sender@example.com', fingerprint: event.fingerprint, calendarLinks: { 0: 'https://calendar.google.com/event?eid=123' }, now });
    assert.equal(mail.attachments.length, 1);
    assert.ok(mail.html.includes('&lt;script&gt;'));
    assert.ok(!mail.html.includes('<script>'));
    assert.ok(mail.html.includes('Ver en Google Calendar'));
    assert.ok(mail.text.includes('Passeig de Gràcia'));
    assert.ok(mail.html.includes('Condiciones del evento'));
});

test('Sin horario completo se avisa sin crear adjuntos ni enlaces de fecha inventada', async () => {
    const { events: [event] } = await discover(getConfig({}), { client, now });
    event.sessions = []; event.scheduleIssues = ['Horario por confirmar'];
    const mail = buildMail(event, { to: ['test@example.com'], from: 'sender@example.com', fingerprint: event.fingerprint, now });
    assert.equal(mail.attachments.length, 0);
    assert.ok(mail.html.includes('Horario por confirmar'));
    assert.ok(!mail.html.includes('calendar.google.com/calendar/render'));
});

test('La configuración falla antes de enviar si faltan canales o persistencia en Vercel', () => {
    assert.throws(() => validateDelivery(getConfig({})), /GMAIL/);
    assert.throws(() => validateDelivery(getConfig({ EMAIL_ENABLED: 'false' })), /canal/);
    assert.throws(() => validateDelivery(getConfig({ EMAIL_ENABLED: 'false', GOOGLE_CALENDAR_ENABLED: 'true' })), /Calendar/);
    assert.throws(() => validateDelivery(getConfig({ VERCEL: '1', GMAIL_USER: 'test@example.com', GMAIL_PASSWORD: 'test' })), /REDIS/);
});
