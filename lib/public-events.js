const { googleCalendarLink } = require("./calendar");

function officialUrl(value, image = false) {
    try {
        const url = new URL(value);
        const allowed = image
            ? ["www.lego.com", "assets.lego.com"]
            : ["www.lego.com"];
        return url.protocol === "https:" &&
            allowed.includes(url.hostname) &&
            !url.username &&
            !url.password
            ? url.href
            : null;
    } catch {
        return null;
    }
}

function publicEvents(state, config, now = new Date()) {
    const catalog = state.catalog || state.feed?.events;
    if (!catalog) return null;
    const events = catalog
        .filter((event) => config.stores.includes(event.store?.slug))
        .flatMap((event) => {
            const url = officialUrl(event.url);
            if (!url) return [];
            const sessions = (event.sessions || [])
                .filter(
                    (session) =>
                        Number.isFinite(Date.parse(session.start)) &&
                        Date.parse(session.end) > now.getTime() &&
                        Date.parse(session.end) > Date.parse(session.start),
                )
                .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
                .map((session) => ({
                    start: session.start,
                    end: session.end,
                    timeZone: "Europe/Madrid",
                    calendarUrl: googleCalendarLink(event, {
                        ...session,
                        timeZone: "Europe/Madrid",
                    }),
                }));
            if (
                !sessions.length &&
                ((event.sessions || []).length ||
                    !(event.scheduleIssues || []).length)
            )
                return [];
            return [
                {
                    title: event.heading,
                    description: event.description,
                    image: officialUrl(event.image, true),
                    store: event.store.name,
                    location: event.location,
                    url,
                    sessions,
                    scheduleIssues: (event.scheduleIssues || []).map(String),
                },
            ];
        })
        .sort(
            (a, b) =>
                (Date.parse(a.sessions[0]?.start) || Infinity) -
                (Date.parse(b.sessions[0]?.start) || Infinity),
        );
    const sources = config.stores.map((slug) => state.sources?.[slug]);
    const successes = sources
        .map((s) => s?.successAt)
        .filter((date) => Number.isFinite(Date.parse(date)));
    const timestamp =
        successes.length === config.stores.length
            ? successes.sort((a, b) => Date.parse(a) - Date.parse(b))[0]
            : state.feed?.updatedAt;
    const updatedAt = Number.isFinite(Date.parse(timestamp)) ? timestamp : null;
    return {
        events,
        updatedAt,
        sourceStatus: sources.some((s) => s?.ok === false)
            ? "incomplete"
            : "ok",
        stale:
            !updatedAt || now.getTime() - Date.parse(updatedAt) > 48 * 3600000,
    };
}

module.exports = { publicEvents, officialUrl };
