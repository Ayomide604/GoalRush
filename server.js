// ============================================================
// GOALRUSH SERVER
// Express + Football-Data.org + GNews + API-Football
// ============================================================

const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const app = express();

// ============================================================
// BASIC SETTINGS
// ============================================================

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname)));

// ============================================================
// ENVIRONMENT VARIABLES
// ============================================================

const FOOTBALL_API_TOKEN =
    process.env.FOOTBALL_API_TOKEN || "";

const GNEWS_API_KEY =
    process.env.GNEWS_API_KEY || "";

const API_FOOTBALL_KEY =
    process.env.API_FOOTBALL_KEY || "";

// ============================================================
// CONSTANTS
// ============================================================

const FOOTBALL_DATA_BASE =
    "https://api.football-data.org/v4";

const API_FOOTBALL_BASE =
    "https://v3.football.api-sports.io";

const REQUEST_TIMEOUT = 10000;

// ============================================================
// CACHE
// ============================================================

const cache = new Map();

function getCache(key) {
    const item = cache.get(key);

    if (!item) {
        return null;
    }

    if (Date.now() > item.expires) {
        cache.delete(key);
        return null;
    }

    return item.data;
}

function setCache(key, data, ttl = 30000) {
    cache.set(key, {
        data,
        expires: Date.now() + ttl
    });
}

// ============================================================
// FETCH WITH TIMEOUT
// ============================================================

async function fetchWithTimeout(
    url,
    options = {},
    timeout = REQUEST_TIMEOUT
) {
    const controller = new AbortController();

    const timer = setTimeout(() => {
        controller.abort();
    }, timeout);

    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal
        });
    } finally {
        clearTimeout(timer);
    }
}

// ============================================================
// FOOTBALL-DATA.ORG
// ============================================================

async function footballAPI(url) {
    if (!FOOTBALL_API_TOKEN) {
        throw new Error(
            "FOOTBALL_API_TOKEN is missing from environment variables."
        );
    }

    return fetchWithTimeout(
        url,
        {
            method: "GET",
            headers: {
                "X-Auth-Token": FOOTBALL_API_TOKEN,
                "Accept": "application/json"
            }
        },
        REQUEST_TIMEOUT
    );
}

// ============================================================
// API-FOOTBALL
// ============================================================

async function apiFootballRequest(endpoint) {
    if (!API_FOOTBALL_KEY) {
        return null;
    }

    try {
        const response = await fetchWithTimeout(
            `${API_FOOTBALL_BASE}${endpoint}`,
            {
                method: "GET",
                headers: {
                    "x-apisports-key":
                        API_FOOTBALL_KEY,
                    "Accept":
                        "application/json"
                }
            },
            REQUEST_TIMEOUT
        );

        const text = await response.text();

        let data = null;

        try {
            data = text
                ? JSON.parse(text)
                : null;
        } catch {
            return null;
        }

        if (!response.ok) {
            console.error(
                "API-FOOTBALL ERROR:",
                response.status,
                text
            );

            return null;
        }

        return data;

    } catch (error) {
        console.error(
            "API-FOOTBALL REQUEST ERROR:",
            error.message
        );

        return null;
    }
}

// ============================================================
// SAFE JSON
// ============================================================

async function readJSON(response) {
    const text = await response.text();

    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

// ============================================================
// HELPERS
// ============================================================

function normalizeTeamName(name) {
    return String(name || "")
        .toLowerCase()
        .replace(/\bfootball club\b/g, "")
        .replace(/\bfc\b/g, "")
        .replace(/\bafc\b/g, "")
        .replace(/\bsc\b/g, "")
        .replace(/\bac\b/g, "")
        .replace(/\bss\b/g, "")
        .replace(/\bclub\b/g, "")
        .replace(/[^a-z0-9]/g, "")
        .trim();
}

function isValidWatchUrl(url) {
    try {
        const parsed = new URL(url);

        return (
            parsed.protocol === "http:" ||
            parsed.protocol === "https:"
        );
    } catch {
        return false;
    }
}

function getDateOnly(utcDate) {
    if (!utcDate) {
        return null;
    }

    try {
        return new Date(utcDate)
            .toISOString()
            .slice(0, 10);
    } catch {
        return null;
    }
}

// ============================================================
// OFFICIAL WATCH LINKS
// ============================================================
//
// Only put official broadcaster links here.
// Do not add unofficial streams.
// ============================================================

const WATCH_LINKS = {};

// ============================================================
// FIND API-FOOTBALL FIXTURE
// ============================================================
//
// Football-Data.org and API-Football use different IDs.
// We therefore find the API-Football fixture using:
// - match date
// - home team
// - away team
// ============================================================

async function findApiFootballFixture(match) {
    if (!API_FOOTBALL_KEY) {
        console.log(
            "API-FOOTBALL KEY NOT CONFIGURED"
        );

        return null;
    }

    const homeName =
        match?.homeTeam?.name ||
        match?.homeTeam?.shortName ||
        "";

    const awayName =
        match?.awayTeam?.name ||
        match?.awayTeam?.shortName ||
        "";

    const date =
        getDateOnly(match?.utcDate);

    if (!homeName || !awayName || !date) {
        return null;
    }

    const cacheKey =
        `api-fixture-${date}`;

    let fixtures =
        getCache(cacheKey);

    if (!fixtures) {
        console.log(
            "API-FOOTBALL FIXTURE SEARCH:",
            date
        );

        const data =
            await apiFootballRequest(
                `/fixtures?date=${encodeURIComponent(
                    date
                )}`
            );

        fixtures =
            Array.isArray(data?.response)
                ? data.response
                : [];

        setCache(
            cacheKey,
            fixtures,
            10 * 60 * 1000
        );
    }

    const normalizedHome =
        normalizeTeamName(homeName);

    const normalizedAway =
        normalizeTeamName(awayName);

    // Exact normalized match
    let found =
        fixtures.find(fixture => {
            const apiHome =
                normalizeTeamName(
                    fixture?.teams?.home?.name
                );

            const apiAway =
                normalizeTeamName(
                    fixture?.teams?.away?.name
                );

            return (
                apiHome === normalizedHome &&
                apiAway === normalizedAway
            );
        });

    // Partial fallback
    if (!found) {
        found =
            fixtures.find(fixture => {
                const apiHome =
                    normalizeTeamName(
                        fixture?.teams?.home?.name
                    );

                const apiAway =
                    normalizeTeamName(
                        fixture?.teams?.away?.name
                    );

                return (
                    (
                        apiHome.includes(
                            normalizedHome
                        ) ||
                        normalizedHome.includes(
                            apiHome
                        )
                    ) &&
                    (
                        apiAway.includes(
                            normalizedAway
                        ) ||
                        normalizedAway.includes(
                            apiAway
                        )
                    )
                );
            });
    }

    if (found) {
        console.log(
            "API-FOOTBALL FIXTURE FOUND:",
            found.fixture?.id
        );
    } else {
        console.log(
            "API-FOOTBALL FIXTURE NOT FOUND:",
            homeName,
            "vs",
            awayName,
            date
        );
    }

    return found || null;
}

// ============================================================
// GET API-FOOTBALL EXTRA MATCH DATA
// ============================================================

async function getApiFootballExtras(match) {
    if (!API_FOOTBALL_KEY) {
        return {
            fixture: null,
            events: [],
            lineups: []
        };
    }

    try {
        const fixture =
            await findApiFootballFixture(match);

        if (!fixture?.fixture?.id) {
            return {
                fixture: null,
                events: [],
                lineups: []
            };
        }

        const fixtureId =
            fixture.fixture.id;

        // ----------------------------------------------------
        // EVENTS
        // ----------------------------------------------------

        const eventsCacheKey =
            `api-events-${fixtureId}`;

        let events =
            getCache(eventsCacheKey);

        if (!events) {
            const eventData =
                await apiFootballRequest(
                    `/fixtures/events?fixture=${encodeURIComponent(
                        fixtureId
                    )}`
                );

            events =
                Array.isArray(
                    eventData?.response
                )
                    ? eventData.response
                    : [];

            // Live events change frequently.
            setCache(
                eventsCacheKey,
                events,
                30 * 1000
            );
        }

        // ----------------------------------------------------
        // LINEUPS
        // ----------------------------------------------------

        const lineupsCacheKey =
            `api-lineups-${fixtureId}`;

        let lineups =
            getCache(lineupsCacheKey);

        if (!lineups) {
            const lineupData =
                await apiFootballRequest(
                    `/fixtures/lineups?fixture=${encodeURIComponent(
                        fixtureId
                    )}`
                );

            lineups =
                Array.isArray(
                    lineupData?.response
                )
                    ? lineupData.response
                    : [];

            setCache(
                lineupsCacheKey,
                lineups,
                10 * 60 * 1000
            );
        }

        return {
            fixture,
            events,
            lineups
        };

    } catch (error) {
        console.error(
            "API-FOOTBALL EXTRAS ERROR:",
            error.message
        );

        return {
            fixture: null,
            events: [],
            lineups: []
        };
    }
}

// ============================================================
// ROOT
// ============================================================

app.get("/", (req, res) => {
    res.json({
        name: "GoalRush API",
        status: "online",
        message:
            "GoalRush API is running.",

        endpoints: {
            fixtures: "/api/fixtures",
            live: "/api/live",
            results: "/api/results",
            matches: "/api/matches",
            teams: "/api/teams",
            standings: "/api/standings",
            news: "/api/news",
            match: "/api/match/:id"
        }
    });
});

// ============================================================
// HEALTH
// ============================================================

app.get("/api/health", (req, res) => {
    res.json({
        status: "ok",

        footballApiConfigured:
            Boolean(
                FOOTBALL_API_TOKEN
            ),

        gnewsConfigured:
            Boolean(
                GNEWS_API_KEY
            ),

        apiFootballConfigured:
            Boolean(
                API_FOOTBALL_KEY
            ),

        time:
            new Date().toISOString()
    });
});

// ============================================================
// TEAMS
// ============================================================

app.get("/api/teams", async (req, res) => {
    try {
        const competition =
            req.query.competition ||
            "PL";

        const cacheKey =
            `teams-${competition}`;

        const cached =
            getCache(cacheKey);

        if (cached) {
            return res.json(cached);
        }

        const response =
            await footballAPI(
                `${FOOTBALL_DATA_BASE}/competitions/${encodeURIComponent(
                    competition
                )}/teams`
            );

        const data =
            await readJSON(response);

        if (!response.ok) {
            return res.status(
                response.status
            ).json({
                error:
                    "Could not load teams",
                details:
                    data
            });
        }

        const result = {
            teams:
                data?.teams || []
        };

        setCache(
            cacheKey,
            result,
            10 * 60 * 1000
        );

        return res.json(result);

    } catch (error) {
        console.error(
            "TEAMS ERROR:",
            error
        );

        return res.status(500).json({
            error:
                "Could not load teams",
            message:
                error.message
        });
    }
});

// ============================================================
// ALL MATCHES
// ============================================================

app.get("/api/matches", async (req, res) => {
    try {
        const dateFrom =
            req.query.dateFrom ||
            new Date()
                .toISOString()
                .slice(0, 10);

        const dateTo =
            req.query.dateTo ||
            dateFrom;

        const competition =
            req.query.competition ||
            "";

        let url =
            `${FOOTBALL_DATA_BASE}/matches` +
            `?dateFrom=${encodeURIComponent(
                dateFrom
            )}` +
            `&dateTo=${encodeURIComponent(
                dateTo
            )}`;

        if (competition) {
            url +=
                `&competitions=${encodeURIComponent(
                    competition
                )}`;
        }

        const cacheKey =
            `matches-${url}`;

        const cached =
            getCache(cacheKey);

        if (cached) {
            return res.json(cached);
        }

        const response =
            await footballAPI(url);

        const data =
            await readJSON(response);

        if (!response.ok) {
            return res.status(
                response.status
            ).json({
                error:
                    "Could not load matches",
                details:
                    data
            });
        }

        const result = {
            matches:
                data?.matches || []
        };

        setCache(
            cacheKey,
            result,
            30 * 1000
        );

        return res.json(result);

    } catch (error) {
        console.error(
            "MATCHES ERROR:",
            error
        );

        return res.status(500).json({
            error:
                "Could not load matches",
            message:
                error.message
        });
    }
});

// ============================================================
// UPCOMING FIXTURES
// ============================================================

app.get("/api/fixtures", async (req, res) => {
    try {
        const today =
            new Date();

        const fromDate =
            req.query.dateFrom ||
            today
                .toISOString()
                .slice(0, 10);

        const futureDate =
            new Date(today);

        futureDate.setDate(
            futureDate.getDate() + 10
        );

        const toDate =
            req.query.dateTo ||
            futureDate
                .toISOString()
                .slice(0, 10);

        const competition =
            req.query.competition ||
            "";

        let url =
            `${FOOTBALL_DATA_BASE}/matches` +
            `?dateFrom=${encodeURIComponent(
                fromDate
            )}` +
            `&dateTo=${encodeURIComponent(
                toDate
            )}`;

        if (competition) {
            url +=
                `&competitions=${encodeURIComponent(
                    competition
                )}`;
        }

        const cacheKey =
            `fixtures-${url}`;

        const cached =
            getCache(cacheKey);

        if (cached) {
            return res.json(cached);
        }

        console.log(
            "FIXTURES REQUEST:",
            url
        );

        const response =
            await footballAPI(url);

        const body =
            await response.text();

        console.log(
            "FOOTBALL-DATA FIXTURES STATUS:",
            response.status
        );

        let data = null;

        try {
            data =
                body
                    ? JSON.parse(body)
                    : null;
        } catch {
            data = null;
        }

        if (!response.ok) {
            console.error(
                "FIXTURES API ERROR:",
                response.status,
                body
            );

            return res.status(
                response.status
            ).json({
                error:
                    "Could not load upcoming fixtures",
                details:
                    data || body
            });
        }

        const matches =
            Array.isArray(
                data?.matches
            )
                ? data.matches
                : [];

        const result = {
            matches
        };

        setCache(
            cacheKey,
            result,
            5 * 60 * 1000
        );

        console.log(
            "FIXTURES FOUND:",
            matches.length
        );

        return res.json(result);

    } catch (error) {
        console.error(
            "FIXTURES ERROR:",
            error
        );

        return res.status(500).json({
            error:
                "Could not load upcoming fixtures",

            message:
                error?.message ||
                "Unknown server error"
        });
    }
});

// ============================================================
// LIVE MATCHES
// ============================================================

app.get("/api/live", async (req, res) => {
    try {
        const statuses = [
            "IN_PLAY",
            "PAUSED"
        ];

        let allMatches = [];

        for (const status of statuses) {
            try {
                const response =
                    await footballAPI(
                        `${FOOTBALL_DATA_BASE}/matches?status=${status}`
                    );

                const data =
                    await readJSON(response);

                if (
                    response.ok &&
                    Array.isArray(
                        data?.matches
                    )
                ) {
                    allMatches =
                        allMatches.concat(
                            data.matches
                        );
                }

            } catch (error) {
                console.error(
                    `LIVE ${status} ERROR:`,
                    error.message
                );
            }
        }

        const seen = new Set();

        const matches =
            allMatches.filter(match => {
                if (
                    seen.has(match.id)
                ) {
                    return false;
                }

                seen.add(match.id);

                return true;
            });

        return res.json({
            matches
        });

    } catch (error) {
        console.error(
            "LIVE ERROR:",
            error
        );

        return res.status(500).json({
            error:
                "Could not load live matches",
            message:
                error.message
        });
    }
});

// ============================================================
// RECENT RESULTS
// ============================================================

app.get("/api/results", async (req, res) => {
    try {
        const today =
            new Date();

        const pastDate =
            new Date(today);

        pastDate.setDate(
            pastDate.getDate() - 7
        );

        const dateFrom =
            req.query.dateFrom ||
            pastDate
                .toISOString()
                .slice(0, 10);

        const dateTo =
            req.query.dateTo ||
            today
                .toISOString()
                .slice(0, 10);

        const url =
            `${FOOTBALL_DATA_BASE}/matches` +
            `?dateFrom=${encodeURIComponent(
                dateFrom
            )}` +
            `&dateTo=${encodeURIComponent(
                dateTo
            )}` +
            `&status=FINISHED`;

        const response =
            await footballAPI(url);

        const data =
            await readJSON(response);

        if (!response.ok) {
            return res.status(
                response.status
            ).json({
                error:
                    "Could not load recent results",
                details:
                    data
            });
        }

        return res.json({
            matches:
                data?.matches || []
        });

    } catch (error) {
        console.error(
            "RESULTS ERROR:",
            error
        );

        return res.status(500).json({
            error:
                "Could not load recent results",
            message:
                error.message
        });
    }
});

// ============================================================
// MATCH CENTRE
// ============================================================

app.get("/api/match/:id", async (req, res) => {
    const matchId =
        String(
            req.params.id || ""
        ).trim();

    if (!matchId) {
        return res.status(400).json({
            error:
                "Match ID is required"
        });
    }

    try {
        console.log(
            "MATCH REQUEST:",
            matchId
        );

        // ----------------------------------------------------
        // FOOTBALL-DATA MATCH
        // ----------------------------------------------------

        const response =
            await footballAPI(
                `${FOOTBALL_DATA_BASE}/matches/${encodeURIComponent(
                    matchId
                )}`
            );

        const body =
            await response.text();

        console.log(
            "FOOTBALL-DATA MATCH STATUS:",
            response.status
        );

        if (!response.ok) {
            let details;

            try {
                details =
                    JSON.parse(body);
            } catch {
                details = body;
            }

            return res.status(
                response.status
            ).json({
                error:
                    "Could not get match details",
                details
            });
        }

        let data;

        try {
            data =
                JSON.parse(body);
        } catch {
            return res.status(502).json({
                error:
                    "Football API returned invalid JSON"
            });
        }

        // ----------------------------------------------------
        // BASIC LIVE INFORMATION
        // ----------------------------------------------------

        const originalStatus =
            String(
                data.status || ""
            ).toUpperCase();

        let liveMinute =
            typeof data.minute ===
            "number"
                ? data.minute
                : null;

        let liveText =
            "NOT LIVE";

        if (
            originalStatus ===
            "IN_PLAY"
        ) {
            liveText =
                liveMinute !== null
                    ? `${liveMinute}'`
                    : "LIVE";
        } else if (
            originalStatus ===
            "PAUSED"
        ) {
            liveText = "HT";
        } else if (
            originalStatus ===
            "FINISHED"
        ) {
            liveText = "FT";
        } else if (
            originalStatus ===
            "POSTPONED"
        ) {
            liveText =
                "POSTPONED";
        } else if (
            originalStatus ===
            "CANCELLED"
        ) {
            liveText =
                "CANCELLED";
        } else if (
            originalStatus ===
            "SUSPENDED"
        ) {
            liveText =
                "SUSPENDED";
        }

        // ----------------------------------------------------
        // GET API-FOOTBALL DATA
        // ----------------------------------------------------

        const extras =
            await getApiFootballExtras(
                data
            );

        const apiFixture =
            extras.fixture;

        // ----------------------------------------------------
        // VENUE
        // ----------------------------------------------------

        let venue =
            data.venue || null;

        if (
            !venue &&
            apiFixture?.fixture?.venue
        ) {
            venue =
                apiFixture.fixture.venue;
        }

        // ----------------------------------------------------
        // EVENTS
        // ----------------------------------------------------

        const footballDataEvents =
            Array.isArray(
                data.events
            )
                ? data.events
                : [];

        const apiFootballEvents =
            Array.isArray(
                extras.events
            )
                ? extras.events
                : [];

        const events =
            apiFootballEvents.length > 0
                ? apiFootballEvents
                : footballDataEvents;

        // ----------------------------------------------------
        // LINEUPS
        // ----------------------------------------------------

        const lineups =
            Array.isArray(
                extras.lineups
            )
                ? extras.lineups
                : [];

        // ----------------------------------------------------
        // API-FOOTBALL RAW DATA
        // ----------------------------------------------------

        let apiFootball = null;

        if (apiFixture) {
            apiFootball = {
                fixture:
                    apiFixture.fixture ||
                    null,

                teams:
                    apiFixture.teams ||
                    null,

                goals:
                    apiFixture.goals ||
                    null,

                score:
                    apiFixture.score ||
                    null
            };
        }

        // ----------------------------------------------------
        // BUILD RESPONSE
        // ----------------------------------------------------

        const match = {
            ...data,

            venue,

            liveMinute,

            liveText,

            isLive:
                originalStatus ===
                "IN_PLAY",

            isHalfTime:
                originalStatus ===
                "PAUSED",

            isFinished:
                originalStatus ===
                "FINISHED",

            events,

            lineups,

            apiFootball
        };

        // ----------------------------------------------------
        // WATCH
        // ----------------------------------------------------

        const watch =
            WATCH_LINKS[matchId];

        if (
            watch &&
            watch.url &&
            isValidWatchUrl(
                watch.url
            )
        ) {
            match.streamUrl =
                watch.url;

            match.watchUrl =
                watch.url;

            match.broadcastUrl =
                watch.url;

            match.watch = {
                available: true,

                broadcaster:
                    watch.broadcaster ||
                    "Official Broadcaster",

                url:
                    watch.url
            };

        } else {
            match.watch = {
                available: false,

                broadcaster:
                    null,

                url:
                    null
            };
        }

        console.log(
            "MATCH SUCCESS:",
            matchId,

            "| API-FOOTBALL FIXTURE:",
            apiFixture?.fixture?.id ||
                "none",

            "| EVENTS:",
            events.length,

            "| LINEUPS:",
            lineups.length,

            "| VENUE:",
            venue
                ? "yes"
                : "no"
        );

        return res.json(match);

    } catch (error) {
        console.error(
            "MATCH DETAILS ERROR:",
            error
        );

        return res.status(500).json({
            error:
                "Could not contact football API",

            message:
                error?.message ||
                "Unknown server error"
        });
    }
});

// ============================================================
// MATCH LIVE DATA
// ============================================================

app.get(
    "/api/match/:id/live",
    async (req, res) => {
        const matchId =
            String(
                req.params.id || ""
            ).trim();

        if (!matchId) {
            return res.status(400).json({
                error:
                    "Match ID is required"
            });
        }

        try {
            const response =
                await footballAPI(
                    `${FOOTBALL_DATA_BASE}/matches/${encodeURIComponent(
                        matchId
                    )}`
                );

            const data =
                await readJSON(response);

            if (!response.ok) {
                return res.status(
                    response.status
                ).json({
                    error:
                        "Could not load live match",
                    details:
                        data
                });
            }

            const status =
                String(
                    data?.status || ""
                ).toUpperCase();

            return res.json({
                id:
                    data?.id ||
                    matchId,

                status,

                utcDate:
                    data?.utcDate ||
                    null,

                homeTeam:
                    data?.homeTeam ||
                    null,

                awayTeam:
                    data?.awayTeam ||
                    null,

                score:
                    data?.score ||
                    null,

                liveMinute:
                    typeof data?.minute ===
                    "number"
                        ? data.minute
                        : null,

                isLive:
                    status ===
                        "IN_PLAY" ||
                    status ===
                        "PAUSED"
            });

        } catch (error) {
            console.error(
                "MATCH LIVE ERROR:",
                error
            );

            return res.status(500).json({
                error:
                    "Could not load live match",

                message:
                    error.message
            });
        }
    }
);

// ============================================================
// MATCH LINEUPS
// ============================================================

app.get(
    "/api/match/:id/lineups",
    async (req, res) => {
        const matchId =
            String(
                req.params.id || ""
            ).trim();

        if (!matchId) {
            return res.status(400).json({
                error:
                    "Match ID is required"
            });
        }

        try {
            const response =
                await footballAPI(
                    `${FOOTBALL_DATA_BASE}/matches/${encodeURIComponent(
                        matchId
                    )}`
                );

            const match =
                await readJSON(response);

            if (!response.ok) {
                return res.status(
                    response.status
                ).json({
                    error:
                        "Could not load match",
                    details:
                        match
                });
            }

            const extras =
                await getApiFootballExtras(
                    match
                );

            return res.json({
                response:
                    extras.lineups || []
            });

        } catch (error) {
            console.error(
                "LINEUPS ERROR:",
                error
            );

            return res.json({
                response: []
            });
        }
    }
);

// ============================================================
// MATCH EVENTS
// ============================================================

app.get(
    "/api/match/:id/events",
    async (req, res) => {
        const matchId =
            String(
                req.params.id || ""
            ).trim();

        if (!matchId) {
            return res.status(400).json({
                error:
                    "Match ID is required"
            });
        }

        try {
            const response =
                await footballAPI(
                    `${FOOTBALL_DATA_BASE}/matches/${encodeURIComponent(
                        matchId
                    )}`
                );

            const match =
                await readJSON(response);

            if (!response.ok) {
                return res.status(
                    response.status
                ).json({
                    error:
                        "Could not load match",
                    details:
                        match
                });
            }

            const extras =
                await getApiFootballExtras(
                    match
                );

            return res.json({
                response:
                    extras.events || []
            });

        } catch (error) {
            console.error(
                "EVENTS ERROR:",
                error
            );

            return res.json({
                response: []
            });
        }
    }
);

// ============================================================
// WATCH MATCH
// ============================================================

app.get(
    "/api/match/:id/watch",
    async (req, res) => {
        const matchId =
            String(
                req.params.id || ""
            ).trim();

        if (!matchId) {
            return res.status(400).json({
                error:
                    "Match ID is required"
            });
        }

        const watch =
            WATCH_LINKS[matchId];

        if (
            !watch ||
            !watch.url ||
            !isValidWatchUrl(
                watch.url
            )
        ) {
            return res.status(404).json({
                available: false,

                message:
                    "No official stream is configured for this match."
            });
        }

        return res.json({
            available: true,

            broadcaster:
                watch.broadcaster ||
                "Official Broadcaster",

            url:
                watch.url
        });
    }
);

// ============================================================
// STANDINGS
// ============================================================

app.get(
    "/api/standings",
    async (req, res) => {
        try {
            const competition =
                req.query.competition ||
                "PL";

            const url =
                `${FOOTBALL_DATA_BASE}/competitions/${encodeURIComponent(
                    competition
                )}/standings`;

            const cacheKey =
                `standings-${competition}`;

            const cached =
                getCache(cacheKey);

            if (cached) {
                return res.json(cached);
            }

            const response =
                await footballAPI(url);

            const data =
                await readJSON(response);

            if (!response.ok) {
                return res.status(
                    response.status
                ).json({
                    error:
                        "Could not load standings",
                    details:
                        data
                });
            }

            const result = {
                competition:
                    data?.competition ||
                    null,

                standings:
                    data?.standings ||
                    []
            };

            setCache(
                cacheKey,
                result,
                10 * 60 * 1000
            );

            return res.json(result);

        } catch (error) {
            console.error(
                "STANDINGS ERROR:",
                error
            );

            return res.status(500).json({
                error:
                    "Could not load standings",

                message:
                    error.message
            });
        }
    }
);

// ============================================================
// NEWS
// ============================================================

app.get(
    "/api/news",
    async (req, res) => {
        try {
            if (!GNEWS_API_KEY) {
                return res.status(500).json({
                    error:
                        "GNEWS_API_KEY is missing from environment variables."
                });
            }

            const search =
                String(
                    req.query.search ||
                    "football"
                ).trim();

            const max =
                Math.min(
                    Math.max(
                        Number(
                            req.query.max ||
                            10
                        ),
                        1
                    ),
                    10
                );

            const url =
                `https://gnews.io/api/v4/search` +
                `?q=${encodeURIComponent(
                    search
                )}` +
                `&lang=en` +
                `&max=${max}` +
                `&apikey=${encodeURIComponent(
                    GNEWS_API_KEY
                )}`;

            const cacheKey =
                `news-${search}-${max}`;

            const cached =
                getCache(cacheKey);

            if (cached) {
                return res.json(cached);
            }

            const response =
                await fetchWithTimeout(
                    url,
                    {
                        method:
                            "GET",

                        headers: {
                            "Accept":
                                "application/json"
                        }
                    },
                    REQUEST_TIMEOUT
                );

            const data =
                await readJSON(response);

            if (!response.ok) {
                console.error(
                    "GNEWS ERROR:",
                    response.status,
                    data
                );

                return res.status(
                    response.status
                ).json({
                    error:
                        "Could not load football news",

                    details:
                        data
                });
            }

            const result = {
                totalArticles:
                    data?.totalArticles ||
                    0,

                articles:
                    Array.isArray(
                        data?.articles
                    )
                        ? data.articles
                        : []
            };

            setCache(
                cacheKey,
                result,
                10 * 60 * 1000
            );

            return res.json(result);

        } catch (error) {
            console.error(
                "NEWS ERROR:",
                error
            );

            return res.status(500).json({
                error:
                    "Could not load football news",

                message:
                    error?.message ||
                    "Unknown server error"
            });
        }
    }
);

// ============================================================
// AI
// ============================================================

app.post(
    "/api/ai",
    async (req, res) => {
        try {
            const apiKey =
                process.env.OPENAI_API_KEY ||
                "";

            if (!apiKey) {
                return res.status(503).json({
                    error:
                        "AI service is not configured."
                });
            }

            const prompt =
                String(
                    req.body?.prompt ||
                    ""
                ).trim();

            if (!prompt) {
                return res.status(400).json({
                    error:
                        "Prompt is required."
                });
            }

            const response =
                await fetchWithTimeout(
                    "https://api.openai.com/v1/responses",
                    {
                        method:
                            "POST",

                        headers: {
                            "Content-Type":
                                "application/json",

                            "Authorization":
                                `Bearer ${apiKey}`
                        },

                        body:
                            JSON.stringify({
                                model:
                                    "gpt-4.1-mini",

                                input:
                                    prompt
                            })
                    },

                    REQUEST_TIMEOUT
                );

            const data =
                await readJSON(response);

            if (!response.ok) {
                return res.status(
                    response.status
                ).json({
                    error:
                        "AI request failed",

                    details:
                        data
                });
            }

            let text = "";

            if (
                typeof data?.output_text ===
                "string"
            ) {
                text =
                    data.output_text;

            } else if (
                Array.isArray(
                    data?.output
                )
            ) {
                for (
                    const item
                    of data.output
                ) {
                    if (
                        Array.isArray(
                            item?.content
                        )
                    ) {
                        for (
                            const content
                            of item.content
                        ) {
                            if (
                                typeof content?.text ===
                                "string"
                            ) {
                                text +=
                                    content.text;
                            }
                        }
                    }
                }
            }

            return res.json({
                response:
                    text.trim()
            });

        } catch (error) {
            console.error(
                "AI ERROR:",
                error
            );

            return res.status(500).json({
                error:
                    "AI request failed",

                message:
                    error?.message ||
                    "Unknown server error"
            });
        }
    }
);

// ============================================================
// 404 API HANDLER
// ============================================================

app.use(
    "/api",
    (req, res) => {
        res.status(404).json({
            error:
                "GoalRush API endpoint not found",

            path:
                req.originalUrl
        });
    }
);

// ============================================================
// FRONTEND FALLBACK
// ============================================================

app.use(
    (req, res, next) => {
        if (
            req.path.startsWith(
                "/api/"
            )
        ) {
            return next();
        }

        const indexPath =
            path.join(
                __dirname,
                "index.html"
            );

        res.sendFile(
            indexPath,
            error => {
                if (error) {
                    next(error);
                }
            }
        );
    }
);

// ============================================================
// ERROR HANDLER
// ============================================================

app.use(
    (error, req, res, next) => {
        console.error(
            "UNHANDLED SERVER ERROR:",
            error
        );

        if (res.headersSent) {
            return next(error);
        }

        res.status(500).json({
            error:
                "GoalRush server error",

            message:
                error?.message ||
                "Unknown server error"
        });
    }
);

// ============================================================
// LOCAL SERVER
// ============================================================

if (require.main === module) {
    app.listen(
        PORT,
        () => {
            console.log(
                `GoalRush server running on port ${PORT}`
            );
        }
    );
}

// ============================================================
// VERCEL
// ============================================================

module.exports = app;