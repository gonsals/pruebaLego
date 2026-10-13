const fs = require('node:fs');
const path = require('node:path');

function loadEnvironment() {
    for (const file of ['.env.local', '.env']) {
        if (fs.existsSync(file)) process.loadEnvFile(file);
    }
}

function boolean(value, fallback) {
    if (!value) return fallback;
    if (!['true', 'false'].includes(value)) throw new Error('Las opciones booleanas deben ser true o false');
    return value === 'true';
}

function getConfig(env = process.env) {
    const stores = [...new Set((env.LEGO_STORES || 'barcelona').split(',').map(s => s.trim()).filter(Boolean))];
    if (!stores.length || stores.some(s => !/^[a-z0-9-]+$/.test(s))) throw new Error('LEGO_STORES no es válido');
    const google = {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        refreshToken: env.GOOGLE_REFRESH_TOKEN,
        calendarId: env.GOOGLE_CALENDAR_ID || 'primary',
    };
    return {
        stores,
        locale: 'es-ES',
        urlLocale: 'es-es',
        timeZone: 'Europe/Madrid',
        cronSecret: env.CRON_SECRET,
        isVercel: Boolean(env.VERCEL),
        publicUrl: env.APP_URL || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : ''),
        adminPasswordHash: env.ADMIN_PASSWORD_HASH,
        sessionSecret: env.SESSION_SECRET,
        stateFile: path.resolve(env.STATE_FILE || '.data/state.json'),
        stateKey: env.STATE_KEY || 'lego-free-builds:v1',
        redisUrl: env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL,
        redisToken: env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN,
        feedEnabled: boolean(env.CALENDAR_FEED_ENABLED, false),
        feedToken: env.CALENDAR_FEED_TOKEN,
        emailEnabled: boolean(env.EMAIL_ENABLED, true),
        email: {
            user: env.GMAIL_USER,
            password: env.GMAIL_PASSWORD,
            to: [...new Set((env.EMAIL_TO || env.GMAIL_USER || '').split(',').map(s => s.trim()).filter(Boolean))],
        },
        calendarEnabled: boolean(env.GOOGLE_CALENDAR_ENABLED, Boolean(google.clientId && google.clientSecret && google.refreshToken)),
        google,
    };
}

function validateDelivery(config) {
    if (config.emailEnabled && (!config.email.user || !config.email.password || !config.email.to.length)) {
        throw new Error('Configura GMAIL_USER, GMAIL_PASSWORD y EMAIL_TO, o EMAIL_ENABLED=false');
    }
    if (config.emailEnabled && config.email.to.some(s => !/^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(s))) {
        throw new Error('EMAIL_TO contiene una dirección no válida');
    }
    if (config.calendarEnabled && (!config.google.clientId || !config.google.clientSecret || !config.google.refreshToken)) {
        throw new Error('Conecta Google Calendar con npm run calendar:connect');
    }
    if (config.feedEnabled && (!config.feedToken || config.feedToken.length < 32)) {
        throw new Error('CALENDAR_FEED_TOKEN debe tener al menos 32 caracteres aleatorios');
    }
    if (!config.emailEnabled && !config.calendarEnabled && !config.feedEnabled) throw new Error('Activa al menos un canal de avisos; para consultar utiliza npm run scan');
    if (config.isVercel && (!config.redisUrl || !config.redisToken)) {
        throw new Error('Vercel necesita UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN para guardar el estado');
    }
}

module.exports = { loadEnvironment, getConfig, validateDelivery };
