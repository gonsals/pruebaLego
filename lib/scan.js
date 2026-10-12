const { LegoClient } = require('./lego');
const { classifyEvent } = require('./classify');
const { parseSchedule } = require('./dates');
const { GoogleCalendar, hash, calendarEventId } = require('./calendar');
const { EmailNotifier } = require('./email');
const { createStore } = require('./state');
const { validateDelivery } = require('./config');
const { updateFeed } = require('./feed');

async function discover(config, { client, now = new Date(), logger = console, signal } = {}) {
    client ||= new LegoClient(config, { logger, signal });
    const events = [], decisions = [], failures = [];
    for (const slug of config.stores) {
        let store;
        try { store = await client.store(slug); }
        catch (error) { failures.push({ store: slug, message: error.message }); continue; }
        for (const card of store.events) {
            if (signal?.aborted) throw new Error('Tiempo máximo de ejecución agotado');
            try {
                const details = await client.event(card);
                const classification = classifyEvent(details);
                const decision = { store: slug, title: details.heading, url: details.url, ...classification };
                if (classification.status !== 'confirmed') { decisions.push(decision); continue; }
                const schedule = parseSchedule(details, { now, timeZone: config.timeZone });
                if (schedule.expired) { decisions.push({ ...decision, status: 'expired', reason: 'Todas las sesiones han terminado' }); continue; }
                const location = [store.name, store.streetAddress, store.postalCode, store.city].filter(Boolean).join(', ');
                const event = {
                    ...details, id: details.eventId || details.urlKey,
                    store: { slug, name: store.name }, location,
                    sessions: schedule.sessions, scheduleIssues: schedule.issues,
                };
                event.fingerprint = hash(JSON.stringify({ heading: event.heading, description: event.description, subHeading: event.subHeading, sessions: schedule.allSessions, location, image: event.image }));
                events.push(event);
                decisions.push({ ...decision, sessions: event.sessions, scheduleIssues: event.scheduleIssues });
            } catch (error) { failures.push({ store: slug, event: card.urlKey, message: error.message }); }
        }
    }
    return { events, decisions, failures };
}

async function runScan(config, options = {}) {
    const { dryRun = false, now = new Date(), logger = console } = options;
    const signal = options.signal || AbortSignal.timeout(240000);
    if (dryRun) return { dryRun: true, ...await discover(config, { ...options, now, logger, signal }) };
    validateDelivery(config);
    const store = options.store || createStore(config);
    const calendar = config.calendarEnabled ? options.calendar || new GoogleCalendar(config.google, { signal }) : null;
    const email = config.emailEnabled ? options.email || new EmailNotifier(config.email) : null;
    return store.withLock(async assertLock => {
        const state = await store.read();
        const found = await discover(config, { ...options, now, logger, signal });
        const summary = { dryRun: false, found: found.events.length, emailsSent: 0, calendarSynced: 0, unchanged: 0, decisions: found.decisions, failures: [...found.failures] };
        const save = async () => { await assertLock(); await store.write(state); };
        for (const event of found.events) {
            const key = `${event.store.slug}:${event.id}`;
            const record = state.events[key] ||= { firstSeen: now.toISOString(), email: {}, calendar: {}, revision: -1 };
            if (record.fingerprint !== event.fingerprint) {
                record.revision++;
                record.fingerprint = event.fingerprint;
            }
            const calendarLinks = {};
            let changed = false;
            if (calendar) {
                const entries = record.calendar[calendar.target] ||= {};
                let complete = true;
                for (const session of event.sessions) {
                    const slot = session.slot;
                    const fingerprint = hash(JSON.stringify({ title: event.heading, description: event.description, location: event.location, session }));
                    try {
                        if (entries[slot]?.fingerprint !== fingerprint) {
                            await assertLock();
                            if (signal.aborted) throw new Error('Tiempo máximo de ejecución agotado');
                            const result = await calendar.upsert(event, session, slot);
                            entries[slot] = { fingerprint, id: result.id || calendarEventId(event, slot), htmlLink: result.htmlLink, end: session.end };
                            await save();
                            summary.calendarSynced++;
                            changed = true;
                        }
                        calendarLinks[slot] = entries[slot]?.htmlLink;
                    } catch (error) {
                        complete = false;
                        summary.failures.push({ store: event.store.slug, event: event.urlKey, channel: 'calendar', message: error.message });
                    }
                }
                // Solo eliminar sesiones futuras que el anuncio confirmado haya quitado.
                // La desaparición de un anuncio completo no prueba que se haya cancelado.
                if (complete && event.sessions.length && !event.scheduleIssues.length) {
                    for (const [slot, entry] of Object.entries(entries)) {
                        if (!event.sessions.some(s => String(s.slot) === slot) && Date.parse(entry.end) > now.getTime()) {
                            try { await assertLock(); await calendar.remove(entry.id); delete entries[slot]; await save(); }
                            catch (error) { summary.failures.push({ event: event.urlKey, channel: 'calendar', message: error.message }); }
                        }
                    }
                }
            }
            if (email && record.email[email.target] !== event.fingerprint) {
                try {
                    await assertLock();
                    if (signal.aborted) throw new Error('Tiempo máximo de ejecución agotado');
                    await email.send(event, { fingerprint: event.fingerprint, revision: record.revision, calendarLinks, now });
                    record.email[email.target] = event.fingerprint;
                    await save();
                    summary.emailsSent++;
                    changed = true;
                } catch (error) { summary.failures.push({ store: event.store.slug, event: event.urlKey, channel: 'email', message: error.message }); }
            }
            if (!changed) summary.unchanged++;
        }
        if (config.feedEnabled) {
            updateFeed(state, found, config, now);
            summary.feedSessions = state.feed.events.reduce((count, event) => count + event.sessions.length, 0);
        }
        state.lastRun = { at: now.toISOString(), found: summary.found, failures: summary.failures.length };
        await save();
        logger.log(JSON.stringify({ level: 'info', message: 'Sincronización terminada', found: summary.found, emailsSent: summary.emailsSent, calendarSynced: summary.calendarSynced, failures: summary.failures.length }));
        return summary;
    });
}

module.exports = { discover, runScan };
