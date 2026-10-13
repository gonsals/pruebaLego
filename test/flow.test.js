const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/barcelona.json');
const { runScan } = require('../lib/scan');
const { getConfig } = require('../lib/config');
const { createApp } = require('../index');
const { BusyError } = require('../lib/state');

const now = new Date('2026-10-12T08:00:00Z');
const quiet = { log() {}, warn() {}, error() {} };

function harness() {
    const events = structuredClone(fixture.events);
    let state = { version: 1, events: {} };
    const calls = { mail: [], calendar: [], removed: [] };
    const config = getConfig({ GMAIL_USER: 'test@example.com', GMAIL_PASSWORD: 'password', GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_REFRESH_TOKEN: 'refresh', CRON_SECRET: 'secret' });
    const options = {
        now, logger: quiet,
        client: { store: async () => structuredClone(fixture.store), event: async card => structuredClone(events.find(e => e.urlKey === card.urlKey)) },
        store: { withLock: async fn => fn(async () => {}), read: async () => structuredClone(state), write: async value => { state = structuredClone(value); } },
        email: { target: 'mail', send: async (event, opts) => { calls.mail.push({ event, opts }); } },
        calendar: { target: 'calendar', upsert: async (event, session, slot) => { calls.calendar.push({ event, session, slot }); return { id: `id${slot}`, htmlLink: `https://calendar.google.com/event/${slot}` }; }, remove: async id => calls.removed.push(id) },
    };
    return { config, options, calls, events, readState: () => structuredClone(state) };
}

test('La primera sincronización crea un evento y envía un aviso; la siguiente no repite', async () => {
    const h = harness();
    const first = await runScan(h.config, h.options);
    const second = await runScan(h.config, h.options);
    assert.equal(first.calendarSynced, 1);
    assert.equal(first.emailsSent, 1);
    assert.equal(second.calendarSynced, 0);
    assert.equal(second.emailsSent, 0);
    assert.equal(h.calls.calendar.length, 1);
    assert.equal(h.calls.mail[0].opts.calendarLinks[0], 'https://calendar.google.com/event/0');
});

test('Un cambio de horario actualiza el mismo evento y manda aviso de actualización', async () => {
    const h = harness();
    await runScan(h.config, h.options);
    const event = h.events.find(e => e.urlKey === 'ghost-street-barcelona');
    event.subHeading = '24/10 - De 11:00 h a 15:00 h';
    event.description = event.description.replace('10:00 h a 14:00 h', '11:00 h a 15:00 h');
    await runScan(h.config, h.options);
    assert.equal(h.calls.calendar[0].slot, h.calls.calendar[1].slot);
    assert.equal(h.calls.calendar[1].session.start, '2026-10-24T11:00:00+02:00');
    assert.equal(h.calls.mail[1].opts.revision, 1);
});

test('Si falla el correo, el reintento conserva el calendario y recupera solo el correo', async () => {
    const h = harness();
    const original = h.options.email.send;
    h.options.email.send = async () => { throw new Error('SMTP caído'); };
    const first = await runScan(h.config, h.options);
    assert.equal(first.failures[0].channel, 'email');
    h.options.email.send = original;
    const second = await runScan(h.config, h.options);
    assert.equal(second.emailsSent, 1);
    assert.equal(second.calendarSynced, 0);
    assert.equal(h.calls.calendar.length, 1);
});

test('Si falla Google, se manda correo con enlace manual y se recupera Google sin repetir correo', async () => {
    const h = harness();
    const original = h.options.calendar.upsert;
    h.options.calendar.upsert = async () => { throw new Error('Calendar caído'); };
    const first = await runScan(h.config, h.options);
    assert.equal(first.emailsSent, 1);
    assert.equal(first.failures[0].channel, 'calendar');
    h.options.calendar.upsert = original;
    const second = await runScan(h.config, h.options);
    assert.equal(second.calendarSynced, 1);
    assert.equal(second.emailsSent, 0);
});

test('Un anuncio que desaparece no cancela un evento ya creado', async () => {
    const h = harness();
    await runScan(h.config, h.options);
    h.options.client.store = async () => ({ ...fixture.store, events: [] });
    await runScan(h.config, h.options);
    assert.equal(h.calls.removed.length, 0);
});

test('Una sesión futura eliminada del anuncio se elimina del calendario', async () => {
    const h = harness();
    const model = h.events.find(e => e.urlKey === 'ghost-street-barcelona');
    const original = model.description;
    model.description += '\n25/10/2026 - De 10:00 a 14:00';
    await runScan(h.config, h.options);
    assert.equal(h.calls.calendar.length, 2);
    model.description = original;
    await runScan(h.config, h.options);
    assert.deepEqual(h.calls.removed, ['id1']);
});

test('No se reenvía un aviso por el simple paso del tiempo entre sesiones', async () => {
    const h = harness();
    const model = h.events.find(e => e.urlKey === 'ghost-street-barcelona');
    model.description += '\n25/10/2026 - De 10:00 a 14:00';
    await runScan(h.config, h.options);
    await runScan(h.config, { ...h.options, now: new Date('2026-10-24T15:00:00Z') });
    assert.equal(h.calls.mail.length, 1);
    assert.equal(h.calls.removed.length, 0);
});

test('Un regalo confirmado sin fecha se avisa, sin modificar el calendario', async () => {
    const h = harness();
    const model = h.events.find(e => e.urlKey === 'ghost-street-barcelona');
    model.subHeading = null;
    model.description = 'Construye un modelo y llévatelo a casa gratis. Por orden de llegada.';
    const result = await runScan(h.config, h.options);
    assert.equal(result.emailsSent, 1);
    assert.equal(result.calendarSynced, 0);
    assert.ok(h.calls.mail[0].event.scheduleIssues.length);
});

test('Flujo HTTP completo: autorización, consulta sin efectos y dos ejecuciones idempotentes', async t => {
    const h = harness();
    const app = createApp({ config: h.config, logger: quiet, scan: (config, options) => runScan(config, { ...h.options, ...options }) });
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/sendLego`)).status, 401);
    assert.equal((await fetch(`${base}/sendLego?secret=secret`)).status, 401);
    const headers = { authorization: 'Bearer secret' };
    const preview = await fetch(`${base}/sendLego?dryRun=true`, { headers });
    assert.equal(preview.status, 200);
    assert.equal((await preview.json()).events.length, 1);
    assert.equal(h.calls.mail.length, 0);
    const first = await fetch(`${base}/sendLego`, { headers });
    assert.equal(first.status, 200);
    assert.equal((await first.json()).calendarSynced, 1);
    const next = await (await fetch(`${base}/sendLego`, { headers })).json();
    assert.equal(next.emailsSent, 0);
});

test('HTTP distingue el bloqueo, los errores de fuentes y los fallos internos', async t => {
    let fail = 'busy';
    const app = createApp({ config: getConfig({ CRON_SECRET: 'secret' }), logger: quiet, scan: async () => {
        if (fail === 'busy') throw new BusyError();
        if (fail === 'internal') throw new Error('secret-internal-data');
        return { failures: [{ message: 'LEGO inaccesible' }] };
    } });
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const url = `http://127.0.0.1:${server.address().port}/sendLego`;
    const options = { headers: { authorization: 'Bearer secret' } };
    assert.equal((await fetch(url, options)).status, 409);
    fail = 'source'; assert.equal((await fetch(url, options)).status, 502);
    fail = 'internal'; const response = await fetch(url, options);
    assert.equal(response.status, 500);
    assert.ok(!(await response.text()).includes('secret-internal-data'));
});

test('Cada correo se envía individualmente y añadir uno no reenvía a los anteriores', async () => {
    const h = harness();
    await runScan(h.config, h.options);
    const state = h.readState();
    state.preferences = { revision: 1, emailEnabled: true, recipients: [{ address: 'test@example.com', enabled: true }, { address: 'new@example.com', enabled: true }, { address: 'paused@example.com', enabled: false }] };
    await h.options.store.write(state);
    const result = await runScan(h.config, h.options);
    assert.equal(result.emailsSent, 1);
    assert.equal(h.calls.mail.length, 2);
    assert.equal(h.calls.mail[0].opts.recipient, 'test@example.com');
    assert.equal(h.calls.mail[1].opts.recipient, 'new@example.com');
    assert.equal((await runScan(h.config, h.options)).emailsSent, 0);
});

test('Un fallo parcial reintenta solo el destinatario pendiente', async () => {
    const h = harness();
    h.config.email.to.push('second@example.com');
    const send = h.options.email.send;
    h.options.email.send = async (event, options) => { if (options.recipient === 'second@example.com') throw new Error('rechazado'); return send(event, options); };
    assert.equal((await runScan(h.config, h.options)).emailsSent, 1);
    h.options.email.send = send;
    assert.equal((await runScan(h.config, h.options)).emailsSent, 1);
    assert.deepEqual(h.calls.mail.map(c => c.opts.recipient), ['test@example.com', 'second@example.com']);
});

test('La migración de un envío anterior a toda la lista evita repetirlo', async () => {
    const h = harness();
    await runScan(h.config, h.options);
    const state = h.readState();
    const { hash } = require('../lib/calendar');
    for (const record of Object.values(state.events)) { delete record.deliveries; record.email[hash('test@example.com')] = record.fingerprint; }
    state.preferences = { revision: 1, emailEnabled: true, recipients: [{ address: 'test@example.com', enabled: true }, { address: 'new@example.com', enabled: true }] };
    await h.options.store.write(state);
    assert.equal((await runScan(h.config, h.options)).emailsSent, 1);
    assert.equal(h.calls.mail[1].opts.recipient, 'new@example.com');
});

test('Pausar y reactivar correos conserva las entregas y el calendario', async () => {
    const h = harness();
    await runScan(h.config, h.options);
    const state = h.readState(); state.preferences = { revision: 1, emailEnabled: false, recipients: [{ address: 'test@example.com', enabled: true }] };
    await h.options.store.write(state);
    assert.equal((await runScan(h.config, h.options)).emailsSent, 0);
    state.preferences.emailEnabled = true; await h.options.store.write({ ...h.readState(), preferences: state.preferences });
    assert.equal((await runScan(h.config, h.options)).emailsSent, 0);
});
