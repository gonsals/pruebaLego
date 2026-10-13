const nodemailer = require('nodemailer');
const { DateTime } = require('luxon');
const { createIcs, googleCalendarLink, hash } = require('./calendar');

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function formatSession(session) {
    const start = DateTime.fromISO(session.start).setLocale('es');
    const end = DateTime.fromISO(session.end).setLocale('es');
    return `${start.toFormat('cccc d LLLL yyyy')} · ${start.toFormat('HH:mm')}–${end.toFormat('HH:mm')}`;
}

function buildMail(event, { to, from, fingerprint, revision = 0, calendarLinks = {}, now = new Date() }) {
    const sessionRows = event.sessions.map((session, index) => {
        const synced = calendarLinks[session.slot ?? index];
        const url = synced || googleCalendarLink(event, session);
        return `<p style="margin:16px 0"><strong>${escapeHtml(formatSession(session))}</strong><br><a href="${escapeHtml(url)}" style="color:#155eef">${synced ? 'Ver en Google Calendar' : 'Añadir a Google Calendar'}</a></p>`;
    }).join('');
    const image = /^https:\/\/(?:www\.lego\.com|assets\.lego\.com)\//.test(event.image || '')
        ? `<img src="${escapeHtml(event.image)}" alt="${escapeHtml(event.heading)}" width="560" style="max-width:100%;height:auto;border-radius:12px">` : '';
    const warnings = event.scheduleIssues.length ? `<p style="padding:12px;background:#fff4ce">${escapeHtml(event.scheduleIssues.join('. '))}. No se ha añadido una fecha incompleta al calendario.</p>` : '';
    const text = [event.heading, event.location, ...event.sessions.map(formatSession), ...event.scheduleIssues, '', event.description, '', event.url, ...event.sessions.map((session, index) => calendarLinks[session.slot ?? index] || googleCalendarLink(event, session))].join('\n');
    const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f3f4f6;font-family:Arial,sans-serif;color:#17212f"><div style="max-width:600px;margin:24px auto;background:white;border-radius:16px;overflow:hidden"><div style="background:#ffcf00;padding:22px 28px;font-size:14px;font-weight:bold">CONSTRUCCIONES GRATIS EN TU TIENDA LEGO</div><div style="padding:28px"><h1 style="font-size:25px;line-height:1.3;margin-top:0">${escapeHtml(event.heading)}</h1><p>${escapeHtml(event.location)}</p>${image}${sessionRows}${warnings}<h2 style="font-size:18px">Condiciones del evento</h2><p style="line-height:1.6;white-space:pre-line">${escapeHtml(event.description)}</p><p><a href="${escapeHtml(event.url)}" style="color:#155eef">Consultar el anuncio oficial</a></p><p style="font-size:12px;color:#667085;line-height:1.5">Este aviso no reserva piezas ni garantiza existencias. Servicio independiente de avisos; sin afiliación con LEGO.</p></div></div></body></html>`;
    return {
        from, to,
        subject: `${revision ? 'Actualización' : 'LEGO gratis'}: ${event.heading.replace(/[\r\n]/g, ' ')}`,
        text, html,
        messageId: `<${hash(`${event.store.slug}:${event.id}:${fingerprint}:${to.join(',')}`)}@lego-free-builds.local>`,
        attachments: event.sessions.length ? [{ filename: `${event.urlKey}.ics`, content: createIcs(event, { now, sequence: revision }), contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }] : [],
    };
}

class EmailNotifier {
    constructor(config, { transporter } = {}) {
        this.config = config;
        this.target = hash(config.to.slice().sort().join(','));
        this.transporter = transporter || nodemailer.createTransport({
            service: 'gmail', auth: { user: config.user, pass: config.password },
            connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
        });
    }
    async send(event, options) {
        const mail = buildMail(event, { ...options, to: options.recipient ? [options.recipient] : this.config.to, from: this.config.user });
        const result = await this.transporter.sendMail(mail);
        // Una aceptación parcial no debe marcar como avisados a los destinatarios rechazados.
        if (result.rejected?.length) throw new Error('Gmail rechazó uno o más destinatarios; revisa EMAIL_TO');
        return result;
    }
    async test(address) {
        const result = await this.transporter.sendMail({ from: this.config.user, to: [address], subject: 'Prueba de avisos LEGO', text: 'La conexión de correo funciona. Recibirás avisos de construcciones LEGO gratuitas cuando estén activados en el panel.' });
        if (result.rejected?.length) throw new Error('El servidor rechazó el destinatario');
        return result;
    }
}

module.exports = { EmailNotifier, buildMail, formatSession, escapeHtml };
