const express = require('express');
const { timingSafeEqual } = require('node:crypto');
const { loadEnvironment, getConfig } = require('./lib/config');
const { runScan } = require('./lib/scan');
const { BusyError, createStore } = require('./lib/state');
const { renderFeed } = require('./lib/feed');

loadEnvironment();

function createApp({ config = getConfig(), scan = runScan, logger = console, store } = {}) {
    const app = express();
    app.disable('x-powered-by');
    app.get('/health', (req, res) => res.json({ status: 'ok', service: 'lego-free-builds' }));
    app.get('/', (req, res) => res.json({ service: 'Avisos de construcciones LEGO gratuitas', health: '/health' }));
    app.get('/calendar/:token', async (req, res) => {
        const supplied = Buffer.from(req.params.token);
        const expected = Buffer.from(`${config.feedToken || ''}.ics`);
        if (!config.feedEnabled || !config.feedToken || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
            return res.status(404).send('Calendario no encontrado');
        }
        try {
            const state = await (store || createStore(config)).read();
            if (!state.feed) return res.status(503).set('Retry-After', '300').send('El calendario todavía no se ha sincronizado');
            const feed = renderFeed(state);
            res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=300', ETag: feed.etag });
            if (req.get('if-none-match') === feed.etag) return res.status(304).end();
            res.send(feed.content);
        } catch {
            logger.error(JSON.stringify({ level: 'error', message: 'No se pudo leer el calendario de suscripción' }));
            res.status(503).send('El calendario no está disponible temporalmente');
        }
    });
    const authorize = (req, res, next) => {
        const expected = Buffer.from(`Bearer ${config.cronSecret || ''}`);
        const actual = Buffer.from(req.get('authorization') || '');
        if (!config.cronSecret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
            return res.status(401).json({ error: 'No autorizado' });
        }
        next();
    };
    app.get('/sendLego', authorize, async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            const result = await scan(config, { dryRun: req.query.dryRun === 'true', logger });
            res.status(result.failures.length ? 502 : 200).json(result);
        } catch (error) {
            if (error instanceof BusyError) return res.status(409).json({ error: error.message });
            logger.error(JSON.stringify({ level: 'error', message: error.message }));
            res.status(500).json({ error: 'No se pudo completar la sincronización; consulta los registros del servidor' });
        }
    });
    return app;
}

const app = createApp();
module.exports = app;
module.exports.createApp = createApp;

if (require.main === module) {
    app.listen(Number(process.env.PORT || 3000), () => console.log('Servidor LEGO disponible en http://localhost:' + (process.env.PORT || 3000)));
}
