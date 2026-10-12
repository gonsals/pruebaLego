const cheerio = require('cheerio');
const { request } = require('./http');

const ORIGIN = 'https://www.lego.com';
const EVENT_FIELDS = 'eventId urlKey heading subHeading';

function plainText(html = '') {
    const $ = cheerio.load(html);
    $('br').replaceWith('\n');
    $('p,h1,h2,h3,li').append('\n');
    $('script,style').remove();
    return $.root().text().replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
}

function validateEvent(event) {
    if (!event || typeof event.heading !== 'string' || !/^[a-z0-9-]+$/.test(event.urlKey || '')) {
        throw new Error('LEGO: el formato de un evento ha cambiado');
    }
    return event;
}

class LegoClient {
    constructor(config, { fetchImpl = fetch, logger = console, signal } = {}) {
        this.config = config;
        this.fetchImpl = fetchImpl;
        this.logger = logger;
        this.signal = signal;
    }

    async graphql(query) {
        const response = await request(`${ORIGIN}/api/graphql`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-locale': this.config.locale },
            body: JSON.stringify({ query }),
            signal: this.signal,
        }, { service: 'LEGO GraphQL', fetchImpl: this.fetchImpl });
        const result = await response.json();
        if (result.errors?.length || !result.data) throw new Error('LEGO: la consulta GraphQL no devolvió datos válidos');
        return result.data;
    }

    async pageData(url, queryPrefix) {
        const response = await request(url, { signal: this.signal }, { service: 'LEGO HTML', fetchImpl: this.fetchImpl });
        const $ = cheerio.load(await response.text());
        const raw = $('#__NEXT_DATA__').text();
        if (!raw) throw new Error('LEGO: no se encontró el JSON de la página');
        const root = JSON.parse(raw).props?.pageProps?.__APOLLO_STATE__?.ROOT_QUERY;
        const entry = Object.entries(root || {}).find(([key]) => key.startsWith(`${queryPrefix}(`));
        if (!entry?.[1]) throw new Error('LEGO: el formato del JSON de la página ha cambiado');
        return entry[1];
    }

    async store(slug) {
        let store;
        let source = 'graphql';
        try {
            store = (await this.graphql(`{ storeInfo(urlKey: ${JSON.stringify(slug)}) { name streetAddress city postalCode events { ${EVENT_FIELDS} thumbnailImage { large { url } } } } }`)).storeInfo;
            if (!store || !Array.isArray(store.events)) throw new Error('LEGO: tienda no encontrada');
        } catch {
            this.logger.warn(JSON.stringify({ level: 'warn', message: 'Usando el JSON del HTML de LEGO', store: slug }));
            source = 'html';
            store = await this.pageData(`${ORIGIN}/${this.config.urlLocale}/stores/store/${slug}`, 'storeInfo');
        }
        if (typeof store.name !== 'string' || !Array.isArray(store.events)) throw new Error('LEGO: información de tienda no válida');
        store.events.forEach(validateEvent);
        return { ...store, slug, source };
    }

    async event(event) {
        let details;
        try {
            details = (await this.graphql(`{ storeEvent(urlKey: ${JSON.stringify(event.urlKey)}) { ${EVENT_FIELDS} body primaryImage { large { url } } } }`)).storeEvent;
            if (typeof details?.body !== 'string') throw new Error('LEGO: descripción no disponible');
        } catch {
            details = await this.pageData(`${ORIGIN}/${this.config.urlLocale}/stores/events/${event.urlKey}`, 'storeEvent');
        }
        validateEvent(details);
        if (typeof details.body !== 'string') throw new Error('LEGO: descripción no válida');
        return {
            ...event, ...details,
            description: plainText(details.body),
            url: `${ORIGIN}/${this.config.urlLocale}/stores/events/${event.urlKey}`,
            image: details.primaryImage?.large?.url || event.thumbnailImage?.large?.url || null,
        };
    }
}

module.exports = { LegoClient, plainText };
