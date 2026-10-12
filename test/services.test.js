const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const fixture = require('./fixtures/barcelona.json');
const { LegoClient } = require('../lib/lego');
const { getConfig } = require('../lib/config');
const { GoogleCalendar, calendarEventId } = require('../lib/calendar');
const { EmailNotifier } = require('../lib/email');
const { FileStore, RedisStore, BusyError } = require('../lib/state');
const { discover } = require('../lib/scan');

const quiet = { log() {}, warn() {}, error() {} };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const html = (key, data) => new Response(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { __APOLLO_STATE__: { ROOT_QUERY: { [key]: data } } } } })}</script>`);

test('La API de LEGO utiliza es-ES y devuelve los campos necesarios', async () => {
    const client = new LegoClient(getConfig({}), { fetchImpl: async (url, options) => {
        assert.equal(options.headers['x-locale'], 'es-ES');
        assert.ok(JSON.parse(options.body).query.includes('storeInfo'));
        return json({ data: { storeInfo: fixture.store } });
    } });
    assert.equal((await client.store('barcelona')).events.length, 5);
});

test('Fallback al JSON del HTML cuando la API devuelve error', async () => {
    let warnings = 0;
    const client = new LegoClient(getConfig({}), {
        logger: { warn() { warnings++; } },
        fetchImpl: async url => url.endsWith('/graphql') ? json({ errors: [{ message: 'error' }] }) : html('storeInfo({"urlKey":"barcelona"})', fixture.store),
    });
    const store = await client.store('barcelona');
    assert.equal(store.source, 'html');
    assert.equal(store.events.length, 5);
    assert.equal(warnings, 1);
});

test('Fallback también para la descripción y las condiciones', async () => {
    const model = fixture.events.find(e => e.urlKey === 'ghost-street-barcelona');
    const client = new LegoClient(getConfig({}), { logger: quiet, fetchImpl: async url => url.endsWith('/graphql') ? json({}, 403) : html('storeEvent({"urlKey":"ghost-street-barcelona"})', model) });
    assert.ok((await client.event(model)).description.includes('por orden de llegada'));
});

test('Un cambio de esquema no se interpreta como una lista vacía', async () => {
    const client = new LegoClient(getConfig({}), { logger: quiet, fetchImpl: async url => url.endsWith('/graphql') ? json({ data: { storeInfo: {} } }) : new Response('<html>error</html>') });
    await assert.rejects(client.store('barcelona'), /JSON/);
});

test('Google crea un evento y recupera un conflicto de inserción sin duplicar', async () => {
    const { events: [event] } = await discover(getConfig({}), { now: new Date('2026-10-12T08:00:00Z'), client: { store: async () => fixture.store, event: async card => fixture.events.find(e => e.urlKey === card.urlKey) } });
    const calls = [];
    const api = new GoogleCalendar({ clientId: 'client', clientSecret: 'secret', refreshToken: 'refresh', calendarId: 'lego@example.com' }, { fetchImpl: async (url, options) => {
        if (url.includes('/token')) return json({ access_token: 'token', expires_in: 3600 });
        calls.push({ url, method: options.method, body: JSON.parse(options.body) });
        if (calls.length === 1) return json({}, 404);
        if (calls.length === 2) return json({}, 409);
        return json({ id: calendarEventId(event, 0), htmlLink: 'https://calendar.google.com/event' });
    } });
    await api.upsert(event, event.sessions[0], 0);
    assert.deepEqual(calls.map(c => c.method), ['PATCH', 'POST', 'PATCH']);
    assert.equal(calls[1].body.id, calendarEventId(event, 0));
    assert.equal(calls[0].body.start.timeZone, 'Europe/Madrid');
    assert.equal(calls[0].body.start.dateTime, '2026-10-24T10:00:00+02:00');
    assert.equal(calls[0].body.attendees, undefined);
    assert.ok(calls[0].url.includes('lego%40example.com'));
});

test('Google propaga errores de permisos sin revelar respuestas o secretos', async () => {
    const api = new GoogleCalendar({ clientId: 'client', clientSecret: 'secret', refreshToken: 'refresh', calendarId: 'primary' }, { fetchImpl: async () => json({ error: 'secret' }, 403) });
    await assert.rejects(api.accessToken(), error => error.message === 'Google OAuth: respuesta HTTP 403');
});

test('Los correos rechazados no se registran como entregados', async () => {
    const email = new EmailNotifier({ user: 'test@example.com', to: ['test@example.com'] }, { transporter: { sendMail: async () => ({ rejected: ['test@example.com'] }) } });
    const { events: [event] } = await discover(getConfig({}), { now: new Date('2026-10-12T08:00:00Z'), client: { store: async () => fixture.store, event: async card => fixture.events.find(e => e.urlKey === card.urlKey) } });
    await assert.rejects(email.send(event, { fingerprint: 'hash' }), /rechaz/);
});

test('El estado local se conserva y bloquea dos ejecuciones concurrentes', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lego-free-build-test-'));
    const file = path.join(directory, 'state.json');
    t.after(async () => { await fs.rm(file, { force: true }); await fs.rmdir(directory); });
    const store = new FileStore(file);
    await store.withLock(async assertLock => {
        await assert.rejects(new FileStore(file).withLock(async () => {}), BusyError);
        await assertLock();
        await store.write({ version: 1, events: { model: { email: true } } });
    });
    assert.equal((await new FileStore(file).read()).events.model.email, true);
    await new FileStore(file).withLock(async () => {});
});

test('El estado corrupto se rechaza y no se reinicia silenciosamente', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lego-free-build-test-'));
    const file = path.join(directory, 'state.json');
    t.after(async () => { await fs.rm(file, { force: true }); await fs.rmdir(directory); });
    await fs.writeFile(file, '{bad');
    await assert.rejects(new FileStore(file).read());
    assert.equal(await fs.readFile(file, 'utf8'), '{bad');
});

test('El bloqueo Redis solo lo puede liberar quien lo adquirió', async () => {
    let lock, released;
    const redis = {
        async set(key, token, opts) { assert.equal(opts.nx, true); assert.equal(opts.ex, 600); lock = token; return 'OK'; },
        async get() { return lock; },
        async eval(script, keys, args) { assert.ok(script.includes('ARGV[1]')); assert.deepEqual(keys, ['test:lock']); released = args[0]; },
    };
    await new RedisStore(redis, 'test').withLock(async assertLock => {
        await assertLock();
        lock = 'another-owner';
        await assert.rejects(assertLock(), /bloqueo/);
    });
    assert.notEqual(released, 'another-owner');
});
