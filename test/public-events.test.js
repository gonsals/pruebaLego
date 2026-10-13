const test = require("node:test");
const assert = require("node:assert/strict");
const { publicEvents, officialUrl } = require("../lib/public-events");
const { createApp } = require("../index");
const { getConfig } = require("../lib/config");
const config = getConfig({
    EMAIL_ENABLED: "false",
    CALENDAR_FEED_ENABLED: "true",
    CALENDAR_FEED_TOKEN: "private-feed-token".repeat(4),
    CRON_SECRET: "private-cron",
    GMAIL_PASSWORD: "private-gmail",
});
const now = new Date("2026-10-13T08:00:00Z");
function model(overrides = {}) {
    return {
        id: "demo",
        heading: "Un modelo para casa",
        description: "Construye y llévatelo gratis.",
        image: "https://www.lego.com/cdn/model.jpg",
        store: { slug: "barcelona", name: "LEGO Barcelona" },
        location: "Barcelona",
        url: "https://www.lego.com/es-es/stores/events/demo",
        sessions: [
            {
                start: "2026-10-24T10:00:00+02:00",
                end: "2026-10-24T14:00:00+02:00",
                slot: 0,
                privateValue: "not-public",
            },
        ],
        scheduleIssues: [],
        secret: "not-public",
        ...overrides,
    };
}
test("La lista pública elige campos explícitos y genera enlaces de sesión, sin secretos ni preferencias", () => {
    const state = {
        catalog: [model()],
        preferences: { recipients: ["private@example.com"] },
        activity: [{ secret: "private-activity" }],
        sources: {
            barcelona: {
                ok: true,
                successAt: now.toISOString(),
                secret: "private-source",
            },
        },
    };
    const result = publicEvents(state, config, now);
    assert.deepEqual(Object.keys(result).sort(), [
        "events",
        "sourceStatus",
        "stale",
        "updatedAt",
    ]);
    assert.deepEqual(Object.keys(result.events[0]).sort(), [
        "description",
        "image",
        "location",
        "scheduleIssues",
        "sessions",
        "store",
        "title",
        "url",
    ]);
    assert.match(
        result.events[0].sessions[0].calendarUrl,
        /^https:\/\/calendar.google.com\/calendar\/render\?/,
    );
    assert.ok(
        result.events[0].sessions[0].calendarUrl.includes(
            "20261024T080000Z%2F20261024T120000Z",
        ),
    );
    for (const value of [
        "private@example.com",
        "private-activity",
        "private-source",
        "not-public",
        config.feedToken,
        config.cronSecret,
        config.email.password,
    ])
        assert.ok(!JSON.stringify(result).includes(value));
});
test("Solo hay sesiones vigentes de las tiendas configuradas, en orden; las fechas incompletas se indican", () => {
    const past = { start: "2026-10-01T08:00:00Z", end: "2026-10-01T12:00:00Z" };
    const state = {
        catalog: [
            model({
                heading: "Pendiente",
                sessions: [],
                scheduleIssues: ["Horario no publicado"],
            }),
            model({
                heading: "Pasado",
                sessions: [past],
                scheduleIssues: ["Aviso antiguo"],
            }),
            model({
                heading: "Otra tienda",
                store: { slug: "madrid", name: "Madrid" },
            }),
            model({ sessions: [past, ...model().sessions] }),
        ],
    };
    const result = publicEvents(state, config, now);
    assert.equal(result.events.length, 2);
    assert.equal(result.events[0].title, "Un modelo para casa");
    assert.equal(result.events[0].sessions.length, 1);
    assert.equal(result.events[1].title, "Pendiente");
});
test("Un estado sin primera consulta se distingue de cero eventos; mantiene compatibilidad con el feed", () => {
    assert.equal(publicEvents({ events: {} }, config, now), null);
    assert.deepEqual(publicEvents({ catalog: [] }, config, now).events, []);
    assert.equal(
        publicEvents(
            { feed: { events: [model()], updatedAt: now.toISOString() } },
            config,
            now,
        ).events.length,
        1,
    );
});
test("La fecha antigua y los fallos de fuente se comunican sin fingir una consulta nueva", () => {
    const successAt = "2026-10-10T08:00:00Z";
    const result = publicEvents(
        {
            catalog: [model()],
            sources: {
                barcelona: {
                    successAt,
                    attemptedAt: now.toISOString(),
                    ok: false,
                },
            },
        },
        config,
        now,
    );
    assert.equal(result.stale, true);
    assert.equal(result.sourceStatus, "incomplete");
    assert.equal(result.updatedAt, successAt);
    assert.equal(
        publicEvents(
            { catalog: [], feed: { updatedAt: "invalid" } },
            config,
            now,
        ).updatedAt,
        null,
    );
});
test("Se limitan las imágenes y los enlaces a hosts oficiales HTTPS", () => {
    for (const url of [
        "javascript:alert(1)",
        "https://evil.example/model.jpg",
        "https://www.lego.com.evil.example/model.jpg",
        "https://user:pass@www.lego.com/model.jpg",
        "http://www.lego.com/model.jpg",
    ])
        assert.equal(officialUrl(url, true), null);
    assert.equal(
        officialUrl("https://assets.lego.com/model.jpg", true),
        "https://assets.lego.com/model.jpg",
    );
    const result = publicEvents(
        {
            catalog: [
                model({ image: "https://evil.example/image.jpg" }),
                model({ url: "https://evil.example/event" }),
            ],
        },
        config,
        now,
    );
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].image, null);
});
test("HTTP público lee el estado sin sesiones ni acciones de administración", async (t) => {
    const session = {
        start: new Date(Date.now() + 86400000).toISOString(),
        end: new Date(Date.now() + 90000000).toISOString(),
    };
    let scans = 0;
    const app = createApp({
        config,
        store: {
            read: async () => ({
                catalog: [model({ sessions: [session] })],
                preferences: { recipients: ["private@example.com"] },
            }),
        },
        scan: async () => {
            scans++;
        },
        logger: { error() {} },
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(base + "/api/events");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("set-cookie"), null);
    const result = await response.text();
    assert.ok(
        !result.includes("private@example.com") &&
            !result.includes(config.feedToken),
    );
    assert.equal(scans, 0);
    assert.equal((await fetch(base + "/sendLego")).status, 401);
});
test("HTTP informa 503 cuando falta la primera consulta o falla Redis, sin revelar errores", async (t) => {
    let fail = false;
    const app = createApp({
        config,
        store: {
            read: async () => {
                if (fail) throw new Error("private-redis-token");
                return { events: {} };
            },
        },
        logger: { error() {} },
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const url = `http://127.0.0.1:${server.address().port}/api/events`;
    assert.equal((await fetch(url)).status, 503);
    fail = true;
    const response = await fetch(url);
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes("private-redis-token"));
});
