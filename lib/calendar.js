const { createHash } = require('node:crypto');
const { DateTime } = require('luxon');
const { request, HttpError } = require('./http');

function hash(value) {
    return createHash('sha256').update(value).digest('hex');
}

function calendarEventId(event, index) {
    return hash(`lego-free-build:${event.store.slug}:${event.id}:${index}`);
}

function description(event) {
    return `${event.description}\n\nTienda: ${event.store.name}\nHorario publicado: ${event.subHeading || 'Consultar la página oficial'}\n\nInformación oficial: ${event.url}\n\nEl aviso no reserva piezas ni garantiza existencias.`;
}

function googleCalendarLink(event, session) {
    const utc = value => DateTime.fromISO(value).toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
    const params = new URLSearchParams({
        action: 'TEMPLATE', text: event.heading,
        dates: `${utc(session.start)}/${utc(session.end)}`,
        ctz: session.timeZone, location: event.location, details: description(event),
    });
    return `https://calendar.google.com/calendar/render?${params}`;
}

function icsEscape(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
}

function foldLine(line) {
    let output = '', part = '';
    for (const character of line) {
        if (Buffer.byteLength(part + character, 'utf8') > 75) {
            output += `${part}\r\n`;
            part = ' ';
        }
        part += character;
    }
    return output + part;
}

function createIcs(event, { now = new Date(), sequence = 0 } = {}) {
    const utc = value => DateTime.fromISO(value).toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
    const stamp = DateTime.fromJSDate(now).toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LEGO Free Build Alerts//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    event.sessions.forEach((session, index) => lines.push(
        'BEGIN:VEVENT', `UID:${calendarEventId(event, session.slot ?? index)}@lego-free-builds.local`,
        `DTSTAMP:${stamp}`, `SEQUENCE:${sequence}`, `DTSTART:${utc(session.start)}`, `DTEND:${utc(session.end)}`,
        `SUMMARY:${icsEscape(event.heading)}`, `DESCRIPTION:${icsEscape(description(event))}`,
        `LOCATION:${icsEscape(event.location)}`, `URL:${event.url}`, 'STATUS:CONFIRMED', 'END:VEVENT',
    ));
    lines.push('END:VCALENDAR');
    return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

class GoogleCalendar {
    constructor(config, { fetchImpl = fetch, signal } = {}) {
        this.config = config;
        this.fetchImpl = fetchImpl;
        this.signal = signal;
        this.target = hash(`${config.calendarId}:${config.refreshToken}`);
    }

    async accessToken() {
        if (this.token && this.expires > Date.now() + 60000) return this.token;
        const response = await request('https://oauth2.googleapis.com/token', {
            method: 'POST', signal: this.signal,
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, refresh_token: this.config.refreshToken, grant_type: 'refresh_token' }),
        }, { service: 'Google OAuth', fetchImpl: this.fetchImpl });
        const data = await response.json();
        if (!data.access_token) throw new Error('Google OAuth: no se recibió un token de acceso');
        this.token = data.access_token;
        this.expires = Date.now() + Number(data.expires_in || 3600) * 1000;
        return this.token;
    }

    async api(path, method, body) {
        const token = await this.accessToken();
        return request(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.config.calendarId)}/events${path}`, {
            method, signal: this.signal,
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            ...(body ? { body: JSON.stringify(body) } : {}),
        }, { service: 'Google Calendar', fetchImpl: this.fetchImpl });
    }

    async upsert(event, session, index) {
        const id = calendarEventId(event, index);
        const body = {
            summary: event.heading, location: event.location, description: description(event),
            start: { dateTime: session.start, timeZone: session.timeZone },
            end: { dateTime: session.end, timeZone: session.timeZone },
            source: { title: 'Evento oficial LEGO', url: event.url },
            extendedProperties: { private: { legoEventId: event.id, legoStore: event.store.slug } },
            reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 1440 }, { method: 'popup', minutes: 60 }] },
        };
        try {
            return await (await this.api(`/${id}`, 'PATCH', body)).json();
        } catch (error) {
            if (!(error instanceof HttpError) || error.status !== 404) throw error;
        }
        try {
            return await (await this.api('', 'POST', { id, ...body })).json();
        } catch (error) {
            // Un reintento tras una respuesta perdida conserva el mismo identificador.
            if (!(error instanceof HttpError) || error.status !== 409) throw error;
            return (await this.api(`/${id}`, 'PATCH', body)).json();
        }
    }

    async remove(id) {
        try {
            await this.api(`/${encodeURIComponent(id)}`, 'DELETE');
        } catch (error) {
            if (!(error instanceof HttpError) || ![404, 410].includes(error.status)) throw error;
        }
    }
}

module.exports = { GoogleCalendar, googleCalendarLink, createIcs, calendarEventId, hash, description };
