const http = require('node:http');
const fs = require('node:fs/promises');
const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const { loadEnvironment, getConfig } = require('../lib/config');
const { request } = require('../lib/http');

async function connect() {
    loadEnvironment();
    const { google } = getConfig();
    if (!google.clientId || !google.clientSecret) throw new Error('Configura GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en .env.local (cliente OAuth de escritorio)');
    const state = randomBytes(32).toString('hex');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const server = http.createServer();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const redirectUri = `http://127.0.0.1:${server.address().port}/oauth/callback`;
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
        client_id: google.clientId, redirect_uri: redirectUri, response_type: 'code',
        scope: 'https://www.googleapis.com/auth/calendar.events',
        access_type: 'offline', prompt: 'consent', state,
        code_challenge: challenge, code_challenge_method: 'S256',
    }).toString();
    console.log('Abre esta dirección para autorizar la creación de eventos en tu calendario:');
    console.log(url.toString());
    console.log('El token se guardará en .env.local; no se mostrará en la terminal.');
    try {
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('La autorización caducó; ejecuta de nuevo npm run calendar:connect')), 600000);
            let consumed = false;
            server.on('request', async (req, res) => {
                const callback = new URL(req.url, redirectUri);
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                if (callback.pathname !== '/oauth/callback') { res.writeHead(404).end('No encontrado'); return; }
                const supplied = Buffer.from(callback.searchParams.get('state') || '');
                const expected = Buffer.from(state);
                if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { res.writeHead(400).end('Autorización no válida'); return; }
                if (consumed) { res.writeHead(409).end('Autorización ya procesada'); return; }
                consumed = true;
                try {
                    if (callback.searchParams.get('error') || !callback.searchParams.get('code')) throw new Error('No se concedió acceso a Google Calendar');
                    const response = await request('https://oauth2.googleapis.com/token', {
                        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({ client_id: google.clientId, client_secret: google.clientSecret, code: callback.searchParams.get('code'), code_verifier: verifier, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
                    }, { service: 'Google OAuth', retries: 0 });
                    const tokens = await response.json();
                    if (tokens.scope && !tokens.scope.split(' ').some(scope => ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/calendar.events'].includes(scope))) {
                        throw new Error('No se concedió el permiso para crear eventos; vuelve a conectar Google Calendar');
                    }
                    if (!tokens.refresh_token) throw new Error('Google no devolvió un token de acceso permanente; vuelve a autorizar con consentimiento');
                    const file = '.env.local';
                    let contents = '';
                    try { contents = await fs.readFile(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
                    for (const [key, value] of Object.entries({ GOOGLE_REFRESH_TOKEN: tokens.refresh_token, GOOGLE_CALENDAR_ENABLED: 'true' })) {
                        const line = `${key}=${JSON.stringify(value)}`;
                        const pattern = new RegExp(`^${key}=.*$`, 'm');
                        contents = pattern.test(contents) ? contents.replace(pattern, () => line) : `${contents.trimEnd()}\n${line}\n`;
                    }
                    await fs.writeFile(file, contents, { mode: 0o600 });
                    res.end('Google Calendar conectado. Puedes cerrar esta pestaña y volver a la terminal.');
                    clearTimeout(timeout);
                    resolve();
                } catch (error) {
                    res.writeHead(400).end('No se pudo conectar el calendario. Consulta la terminal.');
                    clearTimeout(timeout);
                    reject(error);
                }
            });
        });
        console.log('Calendario conectado. Ejecuta npm run scan y después npm run sync.');
    } finally { await new Promise(resolve => server.close(resolve)); }
}

if (require.main === module) connect().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { connect };
