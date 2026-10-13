"use strict";
const eventList = document.querySelector("#public-events");
const freshness = document.querySelector("#public-freshness");
const retry = document.querySelector("#retry-events");
let pending = false,
    previous;
const date = new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Madrid",
});
const time = new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Madrid",
});
function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}
function externalLink(text, value, hosts) {
    const node = element("a", "", text);
    try {
        const url = new URL(value);
        if (url.protocol === "https:" && hosts.includes(url.hostname)) {
            node.href = url.href;
            node.target = "_blank";
            node.rel = "noopener noreferrer";
        }
    } catch {
        /* No crear enlaces no válidos. */
    }
    return node;
}
function placeholder(title, description) {
    const box = element("div", "public-placeholder");
    box.append(
        element("span", "loading-brick"),
        element("h3", "", title),
        element("p", "", description),
    );
    return box;
}
function eventCard(event) {
    const card = element("article", "public-event");
    const visual = element("div", "public-event-visual"),
        fallback = element("div", "model-fallback");
    fallback.setAttribute("aria-hidden", "true");
    fallback.append(element("span"), element("span"), element("span"));
    visual.append(fallback);
    if (event.image) {
        const image = element("img");
        image.src = event.image;
        image.alt = event.title;
        image.loading = "lazy";
        image.decoding = "async";
        image.width = 640;
        image.height = 400;
        image.addEventListener("error", () => image.remove(), { once: true });
        visual.append(image);
    }
    visual.append(
        element("span", "model-badge", "PARA LLEVAR A CASA"),
        element("span", "price-badge", "0 €"),
    );
    const content = element("div", "public-event-content");
    const store = element("p", "event-store", event.store);
    content.append(
        store,
        element("h3", "", event.title),
        element("p", "public-location", event.location),
    );
    const schedule = element("div", "public-sessions");
    for (const session of event.sessions) {
        const row = element("div", "public-session"),
            info = element("div");
        info.append(
            element("strong", "", date.format(new Date(session.start))),
            element(
                "span",
                "",
                `${time.format(new Date(session.start))}–${time.format(new Date(session.end))} · Hora de Madrid`,
            ),
        );
        const calendar = externalLink(
            "+ Google Calendar",
            session.calendarUrl,
            ["calendar.google.com"],
        );
        calendar.setAttribute(
            "aria-label",
            `Añadir a Google Calendar: ${event.title}, ${date.format(new Date(session.start))}`,
        );
        row.append(info, calendar);
        schedule.append(row);
    }
    if (!event.sessions.length)
        schedule.append(
            element(
                "p",
                "date-pending",
                "Fecha por confirmar. Consulta el anuncio oficial.",
            ),
        );
    content.append(schedule);
    if (event.scheduleIssues.length)
        content.append(
            element(
                "p",
                "public-schedule-warning",
                event.scheduleIssues.join(". "),
            ),
        );
    const details = element("details", "public-conditions");
    details.append(
        element("summary", "", "Ver condiciones del evento"),
        element("p", "", event.description),
    );
    content.append(details);
    const official = externalLink("Ver evento en LEGO ↗", event.url, [
        "www.lego.com",
    ]);
    official.className = "button official-event";
    content.append(official);
    card.append(visual, content);
    return card;
}
function render(data) {
    const count = document.querySelector("#event-count");
    count.hidden = false;
    count.textContent = `${data.events.length} evento${data.events.length === 1 ? "" : "s"} confirmado${data.events.length === 1 ? "" : "s"}`;
    freshness.classList.toggle(
        "outdated",
        data.stale || data.sourceStatus === "incomplete",
    );
    freshness.textContent = data.updatedAt
        ? `Última consulta de LEGO: ${new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" }).format(new Date(data.updatedAt))} · Consulta automática diaria.`
        : "Todavía no disponemos de una fecha de consulta completa.";
    if (data.sourceStatus === "incomplete")
        freshness.append(
            element(
                "span",
                "",
                " Falló la última consulta. Mostramos la información anterior disponible.",
            ),
        );
    else if (data.stale)
        freshness.append(
            element(
                "span",
                "",
                " Estos datos necesitan una nueva comprobación. Revisa el anuncio antes de ir.",
            ),
        );
    const open = new Set(
        [...eventList.querySelectorAll("details[open]")].map(
            (d) => d.closest("article").querySelector(".official-event").href,
        ),
    );
    eventList.replaceChildren();
    for (const event of data.events) {
        const card = eventCard(event);
        if (open.has(event.url)) card.querySelector("details").open = true;
        eventList.append(card);
    }
    if (!data.events.length)
        eventList.append(
            placeholder(
                "El siguiente modelo aún está por llegar",
                "Ahora no hay construcciones gratuitas confirmadas. Volveremos a revisar los anuncios de la tienda; puedes consultar el panel para gestionar tus avisos.",
            ),
        );
    const next = data.events.find((e) => e.sessions.length);
    const plan = document.querySelector("#next-plan");
    plan.querySelector("strong").textContent = next
        ? next.title
        : "Siempre listos para el próximo modelo";
    plan.querySelector("div").querySelector("span").textContent = next
        ? `${date.format(new Date(next.sessions[0].start))} · ${time.format(new Date(next.sessions[0].start))} · ${next.store}`
        : "Los próximos eventos confirmados aparecerán aquí.";
}
async function loadEvents() {
    if (pending) return;
    pending = true;
    retry.disabled = true;
    eventList.setAttribute("aria-busy", "true");
    try {
        const response = await fetch("/api/events", {
            cache: "no-store",
            signal: AbortSignal.timeout(15000),
        });
        const data = await response.json();
        if (!response.ok)
            throw new Error(
                data.error || "No podemos cargar los eventos ahora.",
            );
        const signature = JSON.stringify(data);
        if (signature !== previous || !retry.hidden) render(data);
        previous = signature;
        retry.hidden = true;
    } catch (error) {
        freshness.textContent = previous
            ? "No se pudo refrescar la lista. Mostramos la información que ya habías cargado; revisa el anuncio oficial."
            : "Los eventos no están disponibles temporalmente.";
        freshness.classList.add("outdated");
        if (!previous) {
            eventList.replaceChildren(
                placeholder(
                    "Vamos a necesitar otro intento",
                    error.name === "TimeoutError"
                        ? "La consulta está tardando más de lo esperado. Vuelve a intentarlo en unos minutos."
                        : error.message,
                ),
            );
            document.querySelector("#event-count").hidden = true;
        }
        retry.hidden = false;
    } finally {
        pending = false;
        retry.disabled = false;
        eventList.setAttribute("aria-busy", "false");
    }
}
retry.addEventListener("click", loadEvents);
loadEvents();
setInterval(() => {
    if (document.visibilityState === "visible") loadEvents();
}, 60000);
