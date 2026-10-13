const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../index");
const { getConfig } = require("../lib/config");
const {
    passwordHash,
    verifyPassword,
    RedisSessionStore,
} = require("../lib/admin");
const { validatePreferences } = require("../lib/preferences");
const quiet = { log() {}, error() {} };

async function harness(t, overrides = {}) {
    const config = getConfig({
        EMAIL_ENABLED: "false",
        GMAIL_USER: "sender@example.com",
        GMAIL_PASSWORD: "smtp-private",
        CALENDAR_FEED_ENABLED: "true",
        CALENDAR_FEED_TOKEN: "f".repeat(64),
        CRON_SECRET: "cron-private",
        SESSION_SECRET: "s".repeat(64),
        ADMIN_PASSWORD_HASH: await passwordHash("test-password"),
        APP_URL: "https://radar.example.com",
    });
    let state = { version: 1, events: {} },
        calls = { refresh: 0, mail: 0 };
    const store = {
        withLock: async (fn) => fn(async () => {}),
        read: async () => structuredClone(state),
        write: async (value) => {
            state = structuredClone(value);
        },
    };
    const app = createApp({
        config,
        store,
        logger: quiet,
        scan: async (c, opts) => {
            assert.equal(opts.store, store);
            assert.equal(opts.trigger, "manual");
            calls.refresh++;
            return { found: 1, emailsSent: 0, failures: [] };
        },
        emailFactory: () => ({
            test: async (address) => {
                assert.equal(address, "sender@example.com");
                calls.mail++;
            },
        }),
        ...overrides,
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    let cookie = "",
        csrf;
    async function request(
        path,
        { method = "GET", body, headers = {}, redirect = "manual" } = {},
    ) {
        const requestHeaders = new Headers({
            cookie,
            origin: base,
            "Content-Type": "application/json",
            "X-CSRF-Token": csrf || "",
        });
        for (const [key, value] of Object.entries(headers))
            requestHeaders.set(key, value);
        const response = await fetch(base + path, {
            method,
            redirect,
            headers: requestHeaders,
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const cookies = response.headers.getSetCookie();
        if (cookies.length)
            cookie = cookies.map((c) => c.split(";")[0]).join("; ");
        return response;
    }
    async function login() {
        csrf = (await (await request("/api/admin/session")).json()).csrf;
        const response = await request("/api/admin/login", {
            method: "POST",
            body: { password: "test-password" },
        });
        assert.equal(response.status, 200);
        csrf = (await response.json()).csrf;
    }
    return {
        request,
        login,
        calls,
        config,
        read: () => structuredClone(state),
        cookie: () => cookie,
    };
}

test("El acceso usa hash con sal y rechaza contraseña incorrecta o excesiva", async () => {
    const first = await passwordHash("password"),
        second = await passwordHash("password");
    assert.notEqual(first, second);
    assert.equal(await verifyPassword("password", first), true);
    assert.equal(await verifyPassword("wrong", first), false);
    assert.equal(await verifyPassword("a".repeat(257), first), false);
    assert.equal(await verifyPassword("password", "invalid"), false);
});

test("La portada es pública; panel, datos y acciones requieren sesión; al cerrar se revoca", async (t) => {
    const h = await harness(t);
    const landing = await h.request("/");
    assert.equal(landing.status, 200);
    assert.match(await landing.text(), /Cero compras/);
    assert.equal((await h.request("/admin")).headers.get("location"), "/login");
    assert.equal((await h.request("/api/admin/dashboard")).status, 401);
    assert.equal(
        (await h.request("/api/admin/refresh", { method: "POST", body: {} }))
            .status,
        401,
    );
    const anonymous = await h.request("/api/admin/session");
    assert.match(anonymous.headers.get("set-cookie"), /HttpOnly/);
    assert.match(anonymous.headers.get("set-cookie"), /SameSite=Strict/);
    const previous = h.cookie();
    await h.login();
    assert.notEqual(h.cookie(), previous);
    const panel = await h.request("/admin");
    assert.equal(panel.status, 200);
    assert.equal(panel.headers.get("cache-control"), "no-store");
    const dashboard = await h.request("/api/admin/dashboard");
    const text = await dashboard.text();
    assert.ok(
        !text.includes("smtp-private") &&
            !text.includes("cron-private") &&
            !text.includes(h.config.adminPasswordHash) &&
            !text.includes(h.config.sessionSecret),
    );
    assert.equal(
        JSON.parse(text).subscriptionUrl,
        `https://radar.example.com/calendar/${h.config.feedToken}.ics`,
    );
    assert.equal(
        (await h.request("/api/admin/logout", { method: "POST", body: {} }))
            .status,
        200,
    );
    assert.equal(
        (
            await h.request("/api/admin/dashboard", {
                headers: { cookie: previous },
            })
        ).status,
        401,
    );
    assert.equal((await h.request("/api/admin/dashboard")).status, 401);
});

test("El inicio de sesión y las escrituras rechazan otro origen y tokens CSRF ausentes", async (t) => {
    const h = await harness(t);
    assert.equal(
        (
            await h.request("/api/admin/login", {
                method: "POST",
                body: { password: "test-password" },
            })
        ).status,
        403,
    );
    await h.login();
    assert.equal(
        (
            await h.request("/api/admin/refresh", {
                method: "POST",
                body: {},
                headers: { "x-csrf-token": "" },
            })
        ).status,
        403,
    );
    assert.equal(
        (
            await h.request("/api/admin/refresh", {
                method: "POST",
                body: {},
                headers: { origin: "https://attacker.example" },
            })
        ).status,
        403,
    );
    assert.equal(h.calls.refresh, 0);
});

test("Preferencias persistentes normalizadas; guardados antiguos y correos inválidos se rechazan", async (t) => {
    const h = await harness(t);
    await h.login();
    const body = {
        revision: 0,
        emailEnabled: true,
        recipients: [{ address: " NEW@EXAMPLE.COM ", enabled: true }],
    };
    assert.equal(
        (await h.request("/api/admin/preferences", { method: "PUT", body }))
            .status,
        200,
    );
    assert.equal(h.read().preferences.recipients[0].address, "new@example.com");
    assert.equal(
        (await h.request("/api/admin/preferences", { method: "PUT", body }))
            .status,
        409,
    );
    assert.equal(
        (
            await h.request("/api/admin/preferences", {
                method: "PUT",
                body: {
                    ...body,
                    revision: 1,
                    recipients: [{ address: "bad", enabled: true }],
                },
            })
        ).status,
        400,
    );
    assert.equal(h.read().preferences.revision, 1);
    assert.equal(
        (await (await h.request("/api/admin/dashboard")).json()).activity[0]
            .type,
        "preferences",
    );
});

test("Actualizar y probar correo requieren sesión y se limitan; no hay envíos al guardar", async (t) => {
    const h = await harness(t);
    await h.login();
    assert.equal(
        (await h.request("/api/admin/refresh", { method: "POST", body: {} }))
            .status,
        200,
    );
    assert.equal(
        (await h.request("/api/admin/refresh", { method: "POST", body: {} }))
            .status,
        429,
    );
    assert.equal(h.calls.refresh, 1);
    assert.equal(
        (
            await h.request("/api/admin/test-email", {
                method: "POST",
                body: { address: "unlisted@example.com" },
            })
        ).status,
        400,
    );
    assert.equal(
        (
            await h.request("/api/admin/test-email", {
                method: "POST",
                body: { address: "sender@example.com" },
            })
        ).status,
        200,
    );
    assert.equal(
        (
            await h.request("/api/admin/test-email", {
                method: "POST",
                body: { address: "sender@example.com" },
            })
        ).status,
        429,
    );
    assert.equal(h.calls.mail, 1);
});

test("Intentos incorrectos de acceso terminan limitados", async (t) => {
    const h = await harness(t);
    const csrf = (await (await h.request("/api/admin/session")).json()).csrf;
    for (let i = 0; i < 10; i++)
        assert.equal(
            (
                await h.request("/api/admin/login", {
                    method: "POST",
                    body: { password: "bad" },
                    headers: { "x-csrf-token": csrf },
                })
            ).status,
            401,
        );
    assert.equal(
        (
            await h.request("/api/admin/login", {
                method: "POST",
                body: { password: "test-password" },
                headers: { "x-csrf-token": csrf },
            })
        ).status,
        429,
    );
});

test("No se exponen detalles internos al fallar la persistencia", async (t) => {
    const h = await harness(t, {
        store: {
            read: async () => {
                throw new Error("private-token");
            },
        },
    });
    await h.login();
    const response = await h.request("/api/admin/dashboard");
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes("private-token"));
});

test("La sesión en Redis comparte datos entre instancias y conserva caducidad y revocación", async () => {
    const values = new Map(),
        calls = [];
    const redis = {
        get: async (key) => values.get(key),
        set: async (key, value, opts) => {
            values.set(key, value);
            calls.push(opts);
        },
        del: async (key) => values.delete(key),
        expire: async (key, ttl) => {
            calls.push({ key, ttl });
        },
    };
    const a = new RedisSessionStore(redis, "session:"),
        b = new RedisSessionStore(redis, "session:");
    const value = {
        admin: true,
        cookie: { expires: new Date(Date.now() + 60000).toISOString() },
    };
    await new Promise((resolve, reject) =>
        a.set("one", value, (error) => (error ? reject(error) : resolve())),
    );
    const stored = await new Promise((resolve, reject) =>
        b.get("one", (error, result) =>
            error ? reject(error) : resolve(result),
        ),
    );
    assert.equal(stored.admin, true);
    assert.ok(calls[0].ex > 0 && calls[0].ex <= 60);
    await new Promise((resolve) => b.touch("one", value, resolve));
    assert.ok(calls[1].ttl <= 60);
    await new Promise((resolve) => b.destroy("one", resolve));
    assert.equal(await redis.get("session:one"), undefined);
});

test("Validación de destinatarios impide duplicados y envíos sin destinatarios activos", () => {
    assert.throws(
        () => validatePreferences({ emailEnabled: true, recipients: [] }),
        /activo/,
    );
    assert.throws(
        () =>
            validatePreferences({
                emailEnabled: false,
                recipients: [
                    { address: "a@example.com", enabled: true },
                    { address: "A@example.com", enabled: false },
                ],
            }),
        /repetidas/,
    );
    assert.throws(
        () =>
            validatePreferences({
                emailEnabled: false,
                recipients: Array(51).fill({
                    address: "a@example.com",
                    enabled: true,
                }),
            }),
        /50/,
    );
});
