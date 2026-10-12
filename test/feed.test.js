const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/barcelona.json');
const { getConfig, validateDelivery } = require('../lib/config');
const { runScan } = require('../lib/scan');
const { updateFeed, renderFeed } = require('../lib/feed');
const { createApp } = require('../index');

const now = new Date('2026-10-12T08:00:00Z');
const token = 'a'.repeat(64);
const quiet = { log() {}, warn() {}, error() {} };
const config = getConfig({ EMAIL_ENABLED: 'false', CALENDAR_FEED_ENABLED: 'true', CALENDAR_FEED_TOKEN: token });
const client = { store: async () => structuredClone(fixture.store), event: async card => structuredClone(fixture.events.find(e => e.urlKey === card.urlKey)) };

async function snapshot() {
    let state = { version: 1, events: {} };
    const store = { withLock: async fn => fn(async () => {}), read: async () => structuredClone(state), write: async value => { state = structuredClone(value); } };
    const result = await runScan(config, { store, client, now, logger: quiet });
    return { state, result, store };
}

test('El calendario de suscripción funciona sin credenciales de correo ni Google', async () => {
    assert.doesNotThrow(() => validateDelivery(config));
    const { result, state } = await snapshot();
    assert.equal(result.feedSessions, 1);
    assert.equal(result.emailsSent, 0);
    assert.equal(result.calendarSynced, 0);
    assert.equal(state.feed.events.length, 1);
    assert.equal(state.feed.events[0].urlKey, 'ghost-street-barcelona');
});

test('El token del calendario no puede ser vacío ni demasiado corto', () => {
    assert.throws(() => validateDelivery(getConfig({ EMAIL_ENABLED: 'false', CALENDAR_FEED_ENABLED: 'true', CALENDAR_FEED_TOKEN: 'short' })), /CALENDAR_FEED_TOKEN/);
});

test('Se conserva el calendario anterior cuando LEGO falla o retira un anuncio', async () => {
    const { state } = await snapshot();
    updateFeed(state, { events: [], decisions: [], failures: [{ store: 'barcelona' }] }, config, now);
    assert.equal(state.feed.events.length, 1);
});

test('Un modelo que deja de estar confirmado se retira de la suscripción', async () => {
    const { state } = await snapshot();
    updateFeed(state, { events: [], decisions: [{ url: state.feed.events[0].url, status: 'excluded' }], failures: [] }, config, now);
    assert.equal(state.feed.events.length, 0);
});

test('El calendario mantiene UID y fechas; cambios de contenido actualizan el ETag', async () => {
    const { state } = await snapshot();
    const first = renderFeed(state, now), second = renderFeed(state, now);
    assert.equal(first.etag, second.etag);
    assert.equal((first.content.match(/BEGIN:VCALENDAR/g) || []).length, 1);
    assert.equal((first.content.match(/BEGIN:VEVENT/g) || []).length, 1);
    assert.ok(first.content.includes('DTSTART:20261024T080000Z'));
    const uid = first.content.match(/UID:[^\r]+/)[0];
    state.feed.events[0].heading = 'Cambio de título';
    const changed = renderFeed(state, now);
    assert.notEqual(changed.etag, first.etag);
    assert.ok(changed.content.includes(uid));
});

test('Las sesiones terminadas dejan de aparecer aunque el cron no haya vuelto a ejecutarse', async () => {
    const { state } = await snapshot();
    assert.ok(!renderFeed(state, new Date('2026-10-25T12:00:00Z')).content.includes('BEGIN:VEVENT'));
});

test('El feed HTTP exige el token, sirve ICS y permite revalidar con ETag', async t => {
    const { store } = await snapshot();
    const app = createApp({ config, store, logger: quiet });
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${base}/calendar/wrong.ics`)).status, 404);
    const response = await fetch(`${base}/calendar/${token}.ics`);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').startsWith('text/calendar'));
    assert.ok((await response.text()).includes('BEGIN:VEVENT'));
    assert.equal((await fetch(`${base}/calendar/${token}.ics`, { headers: { 'if-none-match': response.headers.get('etag') } })).status, 304);
});

test('Un feed sin primera sincronización devuelve 503 sin inventar datos', async t => {
    const app = createApp({ config, store: { read: async () => ({ version: 1, events: {} }) }, logger: quiet });
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/calendar/${token}.ics`)).status, 503);
});
