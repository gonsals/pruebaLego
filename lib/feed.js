const { createIcs, hash } = require('./calendar');

function updateFeed(state, found, config, now) {
    const events = new Map((state.feed?.events || [])
        .filter(event => config.stores.includes(event.store.slug))
        .map(event => [event.url, event]));
    // La ausencia de un anuncio no demuestra una cancelación. Conservamos
    // los eventos confirmados hasta que terminen o cambien sus condiciones.
    for (const decision of found.decisions) {
        if (['excluded', 'expired', 'review'].includes(decision.status)) events.delete(decision.url);
    }
    for (const event of found.events) {
        if (event.sessions.length && !event.scheduleIssues.length) events.set(event.url, event);
        else events.delete(event.url);
    }
    const upcoming = [...events.values()].map(event => ({
        ...event, sessions: event.sessions.filter(session => Date.parse(session.end) > now.getTime()),
    })).filter(event => event.sessions.length);
    upcoming.sort((a, b) => Date.parse(a.sessions[0].start) - Date.parse(b.sessions[0].start));
    state.feed = { updatedAt: now.toISOString(), events: upcoming };
}

function renderFeed(state, now = new Date()) {
    const timestamp = state.feed?.updatedAt ? new Date(state.feed.updatedAt) : now;
    const blocks = [];
    for (const event of state.feed?.events || []) {
        const sessions = event.sessions.filter(session => Date.parse(session.end) > now.getTime());
        if (!sessions.length) continue;
        const revision = state.events[`${event.store.slug}:${event.id}`]?.revision || 0;
        const ics = createIcs({ ...event, sessions }, { now: timestamp, sequence: revision });
        const start = ics.indexOf('BEGIN:VEVENT\r\n');
        const end = ics.lastIndexOf('END:VCALENDAR');
        if (start >= 0) blocks.push(ics.slice(start, end));
    }
    const content = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//LEGO Free Build Alerts//ES\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:LEGO gratis\r\nX-WR-TIMEZONE:Europe/Madrid\r\n' + blocks.join('') + 'END:VCALENDAR\r\n';
    return { content, etag: `"${hash(content)}"` };
}

module.exports = { updateFeed, renderFeed };
