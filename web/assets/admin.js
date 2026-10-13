"use strict";
const $ = (selector) => document.querySelector(selector);
let csrf,
    data,
    draft,
    dirty = false,
    busy = false;
const today = new Date();
let month = new Date(today.getFullYear(), today.getMonth(), 1),
    selectedDay;
const dates = new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Madrid",
});
const time = (value) =>
    value ? dates.format(new Date(value)) : "Sin consulta todavía";
const dateKey = (value) =>
    new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid" }).format(
        new Date(value),
    );
const localKey = (year, monthIndex, day) =>
    `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}
function link(text, href) {
    const element = node("a", "", text);
    try {
        const url = new URL(href);
        if (url.protocol === "https:") {
            element.href = url.href;
            element.target = "_blank";
            element.rel = "noopener noreferrer";
        }
    } catch {
        /* URL ausente */
    }
    return element;
}
function notice(message, kind = "") {
    $("#notice").hidden = !message;
    $("#notice").textContent = message;
    $("#notice").className = `notice ${kind}`;
}
async function api(path, { method = "GET", body } = {}) {
    const response = await fetch(`/api/admin/${path}`, {
        method,
        cache: "no-store",
        headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrf || "",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 401 && path !== "session") {
        location.assign("/login");
        throw new Error("La sesión ha terminado");
    }
    const result = await response.json();
    if (!response.ok)
        throw new Error(result.error || "No se pudo completar la operación");
    return result;
}
function sessions() {
    return data.events
        .flatMap((event) =>
            event.sessions.map((session) => ({ event, session })),
        )
        .sort(
            (a, b) => Date.parse(a.session.start) - Date.parse(b.session.start),
        );
}
function sessionText(session) {
    return `${new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", month: "long", timeZone: "Europe/Madrid" }).format(new Date(session.start))} · ${new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" }).format(new Date(session.start))}–${new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" }).format(new Date(session.end))}`;
}
function renderEvents() {
    const list = $("#event-list");
    list.replaceChildren();
    if (!data.events.length)
        list.append(
            node(
                "p",
                "empty",
                "Ahora mismo no hay construcciones gratuitas confirmadas. Volveremos a consultar la tienda en la próxima revisión.",
            ),
        );
    for (const event of data.events) {
        const card = node("article", "event-card"),
            badge = node("div", "event-date"),
            content = node("div");
        const first = event.sessions[0];
        badge.append(
            node(
                "strong",
                "",
                first
                    ? new Intl.DateTimeFormat("es-ES", {
                          day: "numeric",
                          timeZone: "Europe/Madrid",
                      }).format(new Date(first.start))
                    : "?",
            ),
            node(
                "span",
                "",
                first
                    ? new Intl.DateTimeFormat("es-ES", {
                          month: "short",
                          timeZone: "Europe/Madrid",
                      }).format(new Date(first.start))
                    : "fecha",
            ),
        );
        content.append(
            node("h3", "", event.heading),
            node("p", "", event.location),
        );
        for (const session of event.sessions)
            content.append(node("span", "session-line", sessionText(session)));
        for (const issue of event.scheduleIssues)
            content.append(node("p", "error-text", issue));
        const actions = node("div", "event-actions");
        actions.append(link("Ver anuncio oficial ↗", event.url));
        content.append(actions);
        const details = node("details");
        details.append(
            node("summary", "", "Leer condiciones del evento"),
            node("p", "event-description", event.description),
        );
        content.append(details);
        card.append(badge, content);
        list.append(card);
    }
}
function renderCalendar() {
    $("#calendar-month").textContent = new Intl.DateTimeFormat("es-ES", {
        month: "long",
        year: "numeric",
    }).format(month);
    const grid = $("#calendar-grid");
    grid.replaceChildren();
    for (const name of ["L", "M", "X", "J", "V", "S", "D"])
        grid.append(node("div", "weekday", name));
    const offset = (month.getDay() + 6) % 7;
    for (let i = 0; i < offset; i++) grid.append(node("div", "day blank"));
    const all = sessions(),
        year = month.getFullYear(),
        monthIndex = month.getMonth();
    for (
        let day = 1;
        day <= new Date(year, monthIndex + 1, 0).getDate();
        day++
    ) {
        const key = localKey(year, monthIndex, day),
            matches = all.filter((s) => dateKey(s.session.start) === key);
        const button = node(
            "button",
            `day${key === dateKey(today) ? " today" : ""}${matches.length ? " has-event" : ""}${selectedDay === key ? " selected" : ""}`,
            String(day),
        );
        button.type = "button";
        button.setAttribute(
            "aria-label",
            `${day} de ${$("#calendar-month").textContent}, ${matches.length} sesiones`,
        );
        button.setAttribute("aria-pressed", String(selectedDay === key));
        if (matches.length)
            button.append(
                node(
                    "span",
                    "day-count",
                    `${matches.length} plan${matches.length === 1 ? "" : "es"}`,
                ),
            );
        button.addEventListener("click", () => {
            selectedDay = key;
            renderCalendar();
        });
        grid.append(button);
    }
    const selected = $("#calendar-selected");
    selected.replaceChildren();
    if (selectedDay) {
        const matches = all.filter(
            (s) => dateKey(s.session.start) === selectedDay,
        );
        if (!matches.length)
            selected.append(
                node("p", "", "Sin sesiones confirmadas para este día."),
            );
        for (const match of matches)
            selected.append(
                link(
                    `${match.event.heading} · ${sessionText(match.session)}`,
                    match.event.url,
                ),
            );
    } else
        selected.append(
            node("p", "", "Selecciona un día para ver sus sesiones."),
        );
}
function markDirty() {
    dirty = true;
    $("#save-preferences").disabled = busy;
}
function renderRecipients() {
    $("#email-enabled").checked = draft.emailEnabled;
    $("#mail-warning").textContent = data.channels.mailConfigured
        ? "Gmail configurado. Usa «Probar correo» para comprobar el envío."
        : "Faltan las credenciales de Gmail en Vercel. El calendario sigue funcionando.";
    const list = $("#recipient-list");
    list.replaceChildren();
    for (const recipient of draft.recipients) {
        const row = node("div", "recipient-row"),
            top = node("div", "recipient-top"),
            checkbox = node("input"),
            label = node("label", "", recipient.address);
        checkbox.type = "checkbox";
        checkbox.checked = recipient.enabled;
        checkbox.id = `recipient-${draft.recipients.indexOf(recipient)}`;
        label.htmlFor = checkbox.id;
        checkbox.addEventListener("change", () => {
            recipient.enabled = checkbox.checked;
            markDirty();
        });
        top.append(checkbox, label);
        const actions = node("div", "recipient-actions"),
            test = node("button", "link-button", "Probar correo"),
            remove = node("button", "link-button remove", "Eliminar");
        test.type = remove.type = "button";
        test.disabled =
            busy ||
            !data.preferences.recipients.some(
                (r) => r.address === recipient.address,
            ) ||
            !data.channels.mailConfigured;
        test.addEventListener("click", () =>
            action(async () => {
                await api("test-email", {
                    method: "POST",
                    body: { address: recipient.address },
                });
                await load({ preserveDraft: true });
                notice(
                    `Gmail aceptó la prueba para ${recipient.address}. Comprueba también la carpeta de spam.`,
                    "success",
                );
            }),
        );
        remove.addEventListener("click", () => {
            draft.recipients = draft.recipients.filter((r) => r !== recipient);
            markDirty();
            renderRecipients();
        });
        actions.append(test, remove);
        row.append(top, actions);
        list.append(row);
    }
    if (!draft.recipients.length)
        list.append(node("p", "empty", "Añade tu primer destinatario."));
    $("#save-preferences").disabled = busy || !dirty;
}
function render() {
    $("#last-update").textContent =
        `Último intento: ${time(data.lastRun?.at)}. Actualización automática diaria y consulta manual cuando la necesites.`;
    $("#stat-sessions").textContent = sessions().length;
    $("#stat-recipients").textContent = data.preferences.recipients.filter(
        (r) => r.enabled,
    ).length;
    $("#mail-state").textContent = data.preferences.emailEnabled
        ? "Avisos activados"
        : "Avisos en pausa";
    const ok = data.sources.every((s) => s.ok),
        attempted = data.sources.some((s) => s.attemptedAt);
    $("#stat-source").textContent = !attempted
        ? "Pendiente"
        : ok
          ? "Correcta"
          : "Incompleta";
    $("#source-detail").textContent = !data.lastRun
        ? "Pendiente de la primera consulta"
        : data.lastRun.failures
          ? `${data.lastRun.failures} fallos en la última ejecución`
          : "Sin fallos en la última ejecución";
    renderEvents();
    renderCalendar();
    renderRecipients();
    const sources = $("#sources");
    sources.replaceChildren();
    for (const source of data.sources) {
        const item = node("div", "source-item");
        item.append(
            node("strong", "", source.slug),
            node(
                "small",
                "",
                `Última consulta correcta: ${time(source.successAt)}`,
            ),
        );
        if (source.ok === false)
            item.append(
                node(
                    "small",
                    "error-text",
                    "Falló el último intento. Conservamos los eventos anteriores.",
                ),
            );
        sources.append(item);
    }
    const decisions = $("#decisions");
    decisions.replaceChildren();
    for (const decision of data.decisions.filter(
        (d) => d.status !== "confirmed",
    )) {
        const item = node("div", "decision");
        item.append(
            link(decision.title, decision.url),
            node(
                "p",
                "",
                `${decision.status === "review" ? "Por revisar" : decision.status === "expired" ? "Terminado" : "Descartado"} · ${decision.reason}`,
            ),
        );
        decisions.append(item);
    }
    if (!decisions.children.length)
        decisions.append(
            node("p", "micro", "Sin anuncios descartados registrados."),
        );
    const history = $("#activity-list");
    history.replaceChildren();
    for (const entry of data.activity) {
        const row = node("div", "activity-row"),
            info = node("div");
        info.append(
            node(
                "strong",
                "",
                entry.type === "scan"
                    ? entry.trigger === "manual"
                        ? "Consulta manual de LEGO"
                        : "Consulta automática de LEGO"
                    : entry.type === "preferences"
                      ? "Preferencias guardadas"
                      : "Prueba de correo",
            ),
        );
        info.append(
            node(
                "p",
                "",
                entry.type === "scan"
                    ? `${entry.found} eventos · ${entry.emailsSent} avisos enviados · ${entry.failures} fallos`
                    : entry.type === "preferences"
                      ? `${entry.recipients} destinatarios · ${entry.emailEnabled ? "Avisos activados" : "Avisos en pausa"}`
                      : entry.ok
                        ? "Mensaje aceptado por Gmail"
                        : "Gmail no aceptó el mensaje",
            ),
        );
        row.append(info, node("time", "", time(entry.at)));
        history.append(row);
    }
    if (!data.activity.length)
        history.append(
            node(
                "p",
                "empty",
                "Aquí aparecerán las próximas consultas y cambios.",
            ),
        );
    $("#copy-calendar").disabled = !data.subscriptionUrl || busy;
    $("#refresh").disabled = busy;
}
async function load({ preserveDraft = false } = {}) {
    data = await api("dashboard");
    if (!preserveDraft) {
        draft = structuredClone(data.preferences);
        dirty = false;
    }
    render();
}
async function action(work) {
    if (busy) return;
    busy = true;
    notice("Procesando…");
    document.querySelectorAll("button").forEach((button) => {
        button.disabled = true;
    });
    try {
        await work();
    } catch (error) {
        notice(error.message, "error");
    } finally {
        busy = false;
        $("#logout").disabled = false;
        $("#add-recipient").disabled = false;
        $("#prev-month").disabled = false;
        $("#next-month").disabled = false;
        if (data) render();
        else $("#refresh").disabled = false;
    }
}
$("#email-enabled").addEventListener("change", (event) => {
    draft.emailEnabled = event.target.checked;
    markDirty();
});
$("#add-recipient").addEventListener("click", () => {
    const input = $("#new-recipient"),
        address = input.value.trim().toLowerCase();
    if (!address || !input.checkValidity()) {
        input.reportValidity();
        return;
    }
    if (draft.recipients.some((r) => r.address === address)) {
        notice("Este correo ya está en la lista", "error");
        return;
    }
    if (draft.recipients.length >= 50) {
        notice("Puedes guardar hasta 50 destinatarios", "error");
        return;
    }
    draft.recipients.push({ address, enabled: true });
    input.value = "";
    markDirty();
    renderRecipients();
    notice("Destinatario añadido. Guarda los cambios para aplicarlo.");
});
$("#new-recipient").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        event.preventDefault();
        $("#add-recipient").click();
    }
});
$("#preferences-form").addEventListener("submit", (event) => {
    event.preventDefault();
    action(async () => {
        await api("preferences", { method: "PUT", body: draft });
        await load();
        notice(
            "Preferencias guardadas. Se aplicarán en la próxima consulta de LEGO.",
            "success",
        );
    });
});
$("#refresh").addEventListener("click", () =>
    action(async () => {
        if (dirty)
            throw new Error(
                "Guarda los cambios de destinatarios antes de actualizar LEGO",
            );
        const result = await api("refresh", { method: "POST", body: {} });
        await load();
        notice(
            `Consulta completada: ${result.found} eventos y ${result.emailsSent} avisos enviados.${result.failures ? ` Hubo ${result.failures} fallos; conservamos la información anterior disponible.` : ""}`,
            result.failures ? "error" : "success",
        );
    }),
);
$("#logout").addEventListener("click", () =>
    action(async () => {
        await api("logout", { method: "POST", body: {} });
        location.assign("/login");
    }),
);
$("#prev-month").addEventListener("click", () => {
    month = new Date(month.getFullYear(), month.getMonth() - 1, 1);
    selectedDay = undefined;
    renderCalendar();
});
$("#next-month").addEventListener("click", () => {
    month = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    selectedDay = undefined;
    renderCalendar();
});
$("#copy-calendar").addEventListener("click", async () => {
    try {
        await navigator.clipboard.writeText(data.subscriptionUrl);
        notice(
            "URL privada copiada. Pégala en Google Calendar → Otros calendarios → Desde URL.",
            "success",
        );
    } catch {
        notice(
            "No se pudo copiar. Permite el acceso al portapapeles e inténtalo de nuevo.",
            "error",
        );
    }
});
document.querySelectorAll(".tabs a").forEach((tab) =>
    tab.addEventListener("click", () => {
        document
            .querySelectorAll(".tabs a")
            .forEach((t) => t.classList.toggle("active", t === tab));
    }),
);
async function init() {
    const session = await api("session");
    if (!session.authenticated) {
        location.assign("/login");
        return;
    }
    csrf = session.csrf;
    await load();
}
init().catch((error) => notice(error.message, "error"));
// Actualizar el estado visible sin sobrescribir cambios de destinatarios sin guardar.
setInterval(() => {
    if (!busy && !dirty && data && document.visibilityState === "visible")
        load().catch((error) => notice(error.message, "error"));
}, 60000);
