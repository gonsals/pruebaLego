const { DateTime } = require('luxon');
const { normalize } = require('./classify');

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const TIME = '(\\d{1,2})(?:[:.](\\d{2})\\s*h?|\\s*h)';

function resolveDate(day, month, year, now) {
    const years = year ? [Number(year)] : [now.year - 1, now.year, now.year + 1];
    const dates = years.map(y => DateTime.fromObject({ year: y, month: Number(month), day: Number(day) }, { zone: now.zoneName })).filter(d => d.isValid);
    dates.sort((a, b) => Math.abs(a.diff(now.startOf('day'), 'days').days) - Math.abs(b.diff(now.startOf('day'), 'days').days));
    const result = dates[0];
    // Un anuncio antiguo no debe convertirse en un evento del año siguiente.
    if (!result || (!year && (result < now.minus({ days: 45 }).startOf('day') || result > now.plus({ days: 180 })))) return null;
    return result;
}

function datesInLine(line, now) {
    const result = [];
    // Los rangos necesitan interpretación distinta; no convertir extremos en dos sesiones.
    if (/\bdel?\s+\d{1,2}(?:\/\d{1,2})?\s+(?:al|hasta)\s+\d{1,2}/.test(line)) return { dates: [], range: true };
    for (const match of line.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/g)) {
        result.push(resolveDate(match[1], match[2], match[3], now));
    }
    const monthPattern = new RegExp(`\\b(\\d{1,2}(?:\\s*(?:y|,)\\s*\\d{1,2})*)\\s+de\\s+(${MONTHS.join('|')})(?:\\s+de\\s+(\\d{4}))?\\b`, 'g');
    for (const match of line.matchAll(monthPattern)) {
        for (const day of match[1].match(/\d{1,2}/g)) result.push(resolveDate(day, MONTHS.indexOf(match[2]) + 1, match[3], now));
    }
    return { dates: result.filter(Boolean), invalid: result.some(d => !d), range: false };
}

function parseSchedule(event, { now = new Date(), timeZone = 'Europe/Madrid' } = {}) {
    const current = now instanceof Date ? DateTime.fromJSDate(now, { zone: timeZone }) : DateTime.fromISO(now, { zone: timeZone });
    if (!current.isValid) throw new Error('Fecha de referencia no válida');
    const lines = `${event.subHeading || ''}\n${event.description || ''}`.split(/\n+/).map(normalize).filter(Boolean);
    const sessions = new Map();
    const issues = new Set();
    let carriedDates = [];
    for (const line of lines) {
        const parsed = datesInLine(line, current);
        if (parsed.range || parsed.invalid) {
            carriedDates = [];
            issues.add('La fecha publicada necesita revisión');
            continue;
        }
        if (parsed.dates.length) carriedDates = parsed.dates;
        const timeRanges = [...line.matchAll(new RegExp(`${TIME}\\s*(?:a|hasta|[-–—])\\s*${TIME}`, 'g'))];
        if (!timeRanges.length) continue;
        if (!carriedDates.length) {
            issues.add('No se pudo asociar una fecha al horario');
            continue;
        }
        for (const day of carriedDates) {
            for (const match of timeRanges) {
                const startHour = Number(match[1]), startMinute = Number(match[2] || 0);
                const endHour = Number(match[3]), endMinute = Number(match[4] || 0);
                const start = day.set({ hour: startHour, minute: startMinute });
                const end = day.set({ hour: endHour, minute: endMinute });
                if (!start.isValid || !end.isValid || start.hour !== startHour || start.minute !== startMinute || end.hour !== endHour || end.minute !== endMinute || end <= start || start.getPossibleOffsets().length > 1 || end.getPossibleOffsets().length > 1) {
                    issues.add('El horario publicado no es válido o es ambiguo');
                    continue;
                }
                const session = { start: start.toISO({ suppressMilliseconds: true }), end: end.toISO({ suppressMilliseconds: true }), timeZone };
                sessions.set(`${session.start}/${session.end}`, session);
            }
        }
    }
    const all = [...sessions.values()].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    all.forEach((session, slot) => { session.slot = slot; });
    const future = all.filter(s => Date.parse(s.end) > current.toMillis());
    if (!all.length) issues.add('No hay fecha y horario completos; consulta el enlace oficial');
    return { sessions: future, allSessions: all, expired: all.length > 0 && !future.length, issues: [...issues] };
}

module.exports = { parseSchedule };
