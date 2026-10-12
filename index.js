const express = require('express');
const { timingSafeEqual } = require('node:crypto');
const { loadEnvironment, getConfig } = require('./lib/config');
const { runScan } = require('./lib/scan');
const { BusyError } = require('./lib/state');

loadEnvironment();

function createApp({ config = getConfig(), scan = runScan, logger = console } = {}) {
    const app = express();
    app.disable('x-powered-by');
    app.get('/health', (req, res) => res.json({ status: 'ok', service: 'lego-free-builds' }));
    app.get('/', (req, res) => res.json({ service: 'Avisos de construcciones LEGO gratuitas', health: '/health' }));
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
