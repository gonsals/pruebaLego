const express = require("express");
const session = require("express-session");
const path = require("node:path");
const {
    randomBytes,
    scrypt,
    timingSafeEqual,
    createHash,
} = require("node:crypto");
const { promisify } = require("node:util");
const { createStore, BusyError } = require("./state");
const { preferences, validatePreferences, activity } = require("./preferences");
const { EmailNotifier } = require("./email");

const derive = promisify(scrypt);
const HASH = /^scrypt:([a-f0-9]{32}):([a-f0-9]{64})$/;
const equal = (a, b) => {
    const x = Buffer.from(a || ""),
        y = Buffer.from(b || "");
    return x.length === y.length && timingSafeEqual(x, y);
};
async function passwordHash(password) {
    const salt = randomBytes(16).toString("hex");
    return `scrypt:${salt}:${(await derive(password, salt, 32)).toString("hex")}`;
}
async function verifyPassword(password, encoded) {
    const match = HASH.exec(encoded || "");
    if (
        !match ||
        typeof password !== "string" ||
        !password.length ||
        password.length > 256
    )
        return false;
    return timingSafeEqual(
        await derive(password, match[1], 32),
        Buffer.from(match[2], "hex"),
    );
}

class RedisSessionStore extends session.Store {
    constructor(redis, prefix) {
        super();
        this.redis = redis;
        this.prefix = prefix;
    }
    ttl(value) {
        return Math.max(
            1,
            Math.ceil(
                (new Date(value.cookie.expires).getTime() - Date.now()) / 1000,
            ),
        );
    }
    get(sid, callback) {
        this.redis
            .get(this.prefix + sid)
            .then((value) => callback(null, value || null), callback);
    }
    set(sid, value, callback = () => {}) {
        this.redis
            .set(this.prefix + sid, value, { ex: this.ttl(value) })
            .then(() => callback(), callback);
    }
    destroy(sid, callback = () => {}) {
        this.redis.del(this.prefix + sid).then(() => callback(), callback);
    }
    touch(sid, value, callback = () => {}) {
        this.redis
            .expire(this.prefix + sid, this.ttl(value))
            .then(() => callback(), callback);
    }
}

function createLimiter(getStore, prefix) {
    const memory = new Map();
    return async (name, seconds, max) => {
        const key = `${prefix}:rate:${createHash("sha256").update(name).digest("hex")}`;
        const redis = getStore().redis;
        let count;
        if (redis)
            count = await redis.eval(
                'local n=redis.call("INCR",KEYS[1]); if n==1 then redis.call("EXPIRE",KEYS[1],ARGV[1]) end; return n',
                [key],
                [seconds],
            );
        else {
            const now = Date.now();
            for (const [id, item] of memory)
                if (item.expires <= now) memory.delete(id);
            const item = memory.get(key) || {
                count: 0,
                expires: now + seconds * 1000,
            };
            count = ++item.count;
            memory.set(key, item);
        }
        return count <= max;
    };
}

function dashboard(state, config) {
    const now = Date.now();
    const events = (state.catalog || state.feed?.events || [])
        .map((event) => ({
            id: `${event.store.slug}:${event.id}`,
            heading: event.heading,
            description: event.description,
            location: event.location,
            store: event.store.name,
            url: event.url,
            sessions: event.sessions.filter((s) => Date.parse(s.end) > now),
            scheduleIssues: event.scheduleIssues,
        }))
        .filter((e) => e.sessions.length || e.scheduleIssues.length);
    let subscriptionUrl = null;
    if (config.feedEnabled && config.feedToken && config.publicUrl) {
        const url = new URL(config.publicUrl);
        if (["http:", "https:"].includes(url.protocol))
            subscriptionUrl = `${url.origin}/calendar/${config.feedToken}.ics`;
    }
    return {
        preferences: preferences(state, config),
        events,
        sources: config.stores.map((slug) => ({
            slug,
            ...state.sources?.[slug],
        })),
        lastRun: state.lastRun || null,
        feedUpdatedAt: state.feed?.updatedAt || null,
        activity: (state.activity || []).slice(0, 50),
        decisions: (state.decisions || []).map((d) => ({
            title: d.title,
            status: d.status,
            reason: d.reason,
            url: d.url,
            store: d.store,
        })),
        channels: {
            mailConfigured: Boolean(config.email.user && config.email.password),
            calendarSubscription: config.feedEnabled,
            googleDirect: config.calendarEnabled,
        },
        subscriptionUrl,
    };
}

function createAdminRouter({
    config,
    scan,
    logger,
    store,
    emailFactory = (c) => new EmailNotifier(c),
    sessionStore,
}) {
    const router = express.Router();
    let stateStore;
    const getStore = () => store || (stateStore ||= createStore(config));
    const enabled =
        HASH.test(config.adminPasswordHash || "") &&
        config.sessionSecret?.length >= 32;
    const limiter = createLimiter(getStore, config.stateKey);
    router.use((req, res, next) => {
        res.set("Cache-Control", "no-store");
        if (!enabled)
            return res
                .status(503)
                .send(
                    "El panel necesita configurar ADMIN_PASSWORD_HASH y SESSION_SECRET.",
                );
        next();
    });
    // El almacenamiento se crea solo al usar el panel, evitando conexiones durante el build.
    let sessions;
    router.use((req, res, next) => {
        if (!sessions) {
            const persistence =
                sessionStore ||
                (getStore().redis
                    ? new RedisSessionStore(
                          getStore().redis,
                          `${config.stateKey}:session:`,
                      )
                    : undefined);
            if (config.isVercel && !persistence)
                return next(new Error("Sesiones persistentes no disponibles"));
            sessions = session({
                name: config.isVercel ? "__Host-lego_admin" : "lego_admin",
                secret: config.sessionSecret,
                store: persistence,
                resave: false,
                saveUninitialized: false,
                cookie: {
                    httpOnly: true,
                    sameSite: "strict",
                    secure: config.isVercel,
                    maxAge: 6 * 60 * 60 * 1000,
                    path: "/",
                },
            });
        }
        sessions(req, res, next);
    });
    router.use(express.json({ limit: "20kb" }));
    const authenticated = (req, res, next) =>
        req.session.admin
            ? next()
            : res.status(401).json({ error: "Inicia sesión para continuar" });
    const csrf = (req, res, next) => {
        const expectedOrigin = `${req.protocol}://${req.get("host")}`;
        if (
            req.get("origin") !== expectedOrigin ||
            !req.session.csrf ||
            !equal(req.get("x-csrf-token"), req.session.csrf)
        )
            return res
                .status(403)
                .json({ error: "Solicitud no válida. Recarga la página." });
        next();
    };
    router.get("/login", (req, res) =>
        req.session.admin
            ? res.redirect("/admin")
            : res.sendFile(path.resolve(__dirname, "../web/login.html")),
    );
    router.get("/admin", (req, res) =>
        req.session.admin
            ? res.sendFile(path.resolve(__dirname, "../web/admin.html"))
            : res.redirect("/login"),
    );
    router.get("/api/admin/session", (req, res) => {
        req.session.csrf ||= randomBytes(32).toString("hex");
        res.json({
            authenticated: Boolean(req.session.admin),
            csrf: req.session.csrf,
        });
    });
    router.post("/api/admin/login", csrf, async (req, res) => {
        if (!(await limiter(`login:${req.ip}`, 900, 10)))
            return res
                .status(429)
                .set("Retry-After", "900")
                .json({ error: "Demasiados intentos. Vuelve en 15 minutos." });
        if (
            !(await verifyPassword(
                req.body?.password,
                config.adminPasswordHash,
            ))
        )
            return res.status(401).json({ error: "Contraseña incorrecta" });
        await new Promise((resolve, reject) =>
            req.session.regenerate((error) =>
                error ? reject(error) : resolve(),
            ),
        );
        req.session.admin = true;
        req.session.csrf = randomBytes(32).toString("hex");
        res.json({ authenticated: true, csrf: req.session.csrf });
    });
    router.post("/api/admin/logout", authenticated, csrf, async (req, res) => {
        await new Promise((resolve, reject) =>
            req.session.destroy((error) => (error ? reject(error) : resolve())),
        );
        res.clearCookie(config.isVercel ? "__Host-lego_admin" : "lego_admin", {
            path: "/",
            httpOnly: true,
            sameSite: "strict",
            secure: config.isVercel,
        }).json({ ok: true });
    });
    router.get("/api/admin/dashboard", authenticated, async (req, res) =>
        res.json(dashboard(await getStore().read(), config)),
    );
    router.put(
        "/api/admin/preferences",
        authenticated,
        csrf,
        async (req, res) => {
            let input;
            try {
                input = validatePreferences(req.body);
            } catch (error) {
                return res.status(400).json({ error: error.message });
            }
            if (
                input.emailEnabled &&
                (!config.email.user || !config.email.password)
            )
                return res
                    .status(400)
                    .json({
                        error: "Primero configura las credenciales de Gmail en el servidor",
                    });
            if (
                !input.emailEnabled &&
                !config.feedEnabled &&
                !config.calendarEnabled
            )
                return res
                    .status(400)
                    .json({
                        error: "Mantén activo al menos un canal de avisos",
                    });
            const result = await getStore().withLock(async (assert) => {
                const state = await getStore().read();
                const current = preferences(state, config);
                if (req.body.revision !== current.revision) return null;
                state.preferences = {
                    ...input,
                    revision: current.revision + 1,
                };
                activity(state, {
                    type: "preferences",
                    recipients: input.recipients.length,
                    emailEnabled: input.emailEnabled,
                });
                await assert();
                await getStore().write(state);
                return state.preferences;
            });
            if (!result)
                return res
                    .status(409)
                    .json({
                        error: "La configuración cambió en otra sesión. Recarga antes de guardar.",
                    });
            res.json(result);
        },
    );
    router.post("/api/admin/refresh", authenticated, csrf, async (req, res) => {
        if (!(await limiter("refresh", 60, 1)))
            return res
                .status(429)
                .set("Retry-After", "60")
                .json({
                    error: "Espera un minuto antes de volver a consultar LEGO",
                });
        const result = await scan(config, {
            store: getStore(),
            logger,
            trigger: "manual",
        });
        res.json({
            found: result.found,
            emailsSent: result.emailsSent,
            failures: result.failures.length,
        });
    });
    router.post(
        "/api/admin/test-email",
        authenticated,
        csrf,
        async (req, res) => {
            const address =
                typeof req.body?.address === "string"
                    ? req.body.address.trim().toLowerCase()
                    : "";
            const settings = preferences(await getStore().read(), config);
            if (!settings.recipients.some((r) => r.address === address))
                return res
                    .status(400)
                    .json({ error: "Guarda primero este destinatario" });
            if (!config.email.user || !config.email.password)
                return res
                    .status(400)
                    .json({
                        error: "Faltan las credenciales de Gmail en el servidor",
                    });
            if (!(await limiter("test-email", 60, 1)))
                return res
                    .status(429)
                    .json({
                        error: "Espera un minuto entre pruebas de correo",
                    });
            let ok = true;
            try {
                await emailFactory(config.email).test(address);
            } catch {
                ok = false;
            }
            await getStore().withLock(async (assert) => {
                const state = await getStore().read();
                activity(state, { type: "test-email", ok });
                await assert();
                await getStore().write(state);
            });
            if (!ok)
                return res
                    .status(502)
                    .json({
                        error: "Gmail no aceptó el mensaje. Revisa la contraseña de aplicación y la dirección del remitente.",
                    });
            res.json({ ok: true });
        },
    );
    router.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        if (error instanceof BusyError)
            return res
                .status(409)
                .json({
                    error: "Hay una actualización en curso. Espera y recarga.",
                });
        if (
            error.type === "entity.parse.failed" ||
            error.type === "entity.too.large"
        )
            return res.status(400).json({ error: "Solicitud no válida" });
        logger.error(
            JSON.stringify({
                level: "error",
                message: "Falló una operación del panel",
                operation: req.method,
            }),
        );
        res.status(503).json({
            error: "No se pudo completar la operación. Inténtalo de nuevo.",
        });
    });
    return router;
}

module.exports = {
    createAdminRouter,
    RedisSessionStore,
    passwordHash,
    verifyPassword,
    dashboard,
};
