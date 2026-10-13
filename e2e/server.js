const { createApp } = require("../index");
const { getConfig } = require("../lib/config");
const { passwordHash } = require("../lib/admin");
const { activity } = require("../lib/preferences");
async function main() {
    const start = new Date();
    start.setDate(start.getDate() + 10);
    start.setHours(10, 0, 0, 0);
    const end = new Date(start.getTime() + 4 * 3600000);
    const event = {
        id: "demo",
        heading: "Construye tu próximo modelo gratis",
        description:
            "Construye un modelo y llévatelo a casa gratis. Por orden de llegada y hasta agotar existencias.",
        location: "LEGO Store Barcelona",
        store: { name: "LEGO Store Barcelona", slug: "barcelona" },
        url: "https://www.lego.com/es-es/stores/store/barcelona",
        sessions: [
            { start: start.toISOString(), end: end.toISOString(), slot: 0 },
        ],
        scheduleIssues: [],
    };
    let state = {
        version: 1,
        events: {},
        catalog: [event],
        feed: { updatedAt: new Date().toISOString(), events: [event] },
    };
    const store = {
        read: async () => structuredClone(state),
        write: async (value) => {
            state = structuredClone(value);
        },
        withLock: async (fn) => fn(async () => {}),
    };
    const config = getConfig({
        EMAIL_ENABLED: "false",
        GMAIL_USER: "demo@example.com",
        GMAIL_PASSWORD: "not-a-real-password",
        CALENDAR_FEED_ENABLED: "true",
        CALENDAR_FEED_TOKEN: "demo".repeat(16),
        SESSION_SECRET: "demo".repeat(16),
        ADMIN_PASSWORD_HASH: await passwordHash("demo-password"),
        APP_URL: "http://127.0.0.1:3211",
    });
    createApp({
        config,
        store,
        emailFactory: () => ({ test: async () => {} }),
        scan: async () => {
            state.lastRun = {
                at: new Date().toISOString(),
                found: 1,
                failures: 0,
                emailsSent: 0,
            };
            state.sources = {
                barcelona: {
                    successAt: new Date().toISOString(),
                    attemptedAt: new Date().toISOString(),
                    ok: true,
                },
            };
            activity(state, {
                type: "scan",
                ...state.lastRun,
                trigger: "manual",
            });
            return { found: 1, failures: [], emailsSent: 0 };
        },
    }).listen(3211, "127.0.0.1");
}
main().catch(() => {
    process.exitCode = 1;
});
