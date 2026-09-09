const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const OpenAI = require("openai");
const fetch = require("node-fetch");

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));


// ==================================================
// OPENAI
// ==================================================

const openai = process.env.OPENAI_API_KEY
    ? new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
    })
    : null;


// ==================================================
// FOOTBALL-DATA.ORG HELPER
// ==================================================

async function footballAPI(url) {

    return fetch(url, {
        headers: {
            "X-Auth-Token":
                process.env.FOOTBALL_API_TOKEN
        }
    });

}


// ==================================================
// API-FOOTBALL
// ==================================================

const API_FOOTBALL_BASE =
    "https://v3.football.api-sports.io";

const apiFootballCache =
    new Map();


// ==================================================
// CACHE TIMES
// ==================================================

const CACHE_TIMES = {

    fixtureSearch:
        10 * 60 * 1000,

    match:
        30 * 1000,

    lineups:
        10 * 60 * 1000,

    events:
        30 * 1000

};


// ==================================================
// API-FOOTBALL HELPER
// ==================================================

async function apiFootball(path) {

    const key =
        process.env.API_FOOTBALL_KEY;

    if (!key) {

        throw new Error(
            "API_FOOTBALL_KEY is missing"
        );

    }

    const response =
        await fetch(
            `${API_FOOTBALL_BASE}${path}`,
            {
                method: "GET",

                headers: {
                    "x-apisports-key":
                        key,

                    "Accept":
                        "application/json"
                }
            }
        );

    const data =
        await response.json();

    if (!response.ok) {

        const message =
            data?.errors
                ? JSON.stringify(data.errors)
                : `HTTP ${response.status}`;

        throw new Error(
            `API-Football error: ${message}`
        );

    }

    if (
        data.errors &&
        Object.keys(data.errors).length > 0
    ) {

        throw new Error(
            `API-Football error: ${JSON.stringify(data.errors)}`
        );

    }

    return data;

}


// ==================================================
// CACHE HELPER
// ==================================================

function getCache(key) {

    const item =
        apiFootballCache.get(key);

    if (!item) {
        return null;
    }

    if (
        Date.now() - item.time >
        item.ttl
    ) {

        apiFootballCache.delete(key);

        return null;

    }

    return item.data;

}


function setCache(
    key,
    data,
    ttl
) {

    apiFootballCache.set(
        key,
        {
            data,
            time:
                Date.now(),
            ttl
        }
    );

}


// ==================================================
// NORMALIZE TEAM NAME
// ==================================================

function normalizeTeamName(name) {

    return String(name || "")
        .toLowerCase()
        .replace(
            /\b(fc|afc|cf|sc|club|football club)\b/g,
            ""
        )
        .replace(
            /[^a-z0-9]+/g,
            ""
        );

}


// ==================================================
// TEAM NAME MATCH
// ==================================================

function teamNamesMatch(
    nameA,
    nameB
) {

    const a =
        normalizeTeamName(nameA);

    const b =
        normalizeTeamName(nameB);

    if (!a || !b) {
        return false;
    }

    return (
        a === b ||
        a.includes(b) ||
        b.includes(a)
    );

}


// ==================================================
// FIND API-FOOTBALL FIXTURE
// ==================================================

async function findApiFootballFixture(
    footballDataMatch
) {

    const homeName =
        footballDataMatch
            ?.homeTeam
            ?.name;

    const awayName =
        footballDataMatch
            ?.awayTeam
            ?.name;

    const utcDate =
        footballDataMatch
            ?.utcDate;

    if (
        !homeName ||
        !awayName ||
        !utcDate
    ) {

        return null;

    }

    const date =
        new Date(utcDate)
            .toISOString()
            .slice(0, 10);

    const cacheKey =
        `fixture-search:${date}:${normalizeTeamName(homeName)}:${normalizeTeamName(awayName)}`;

    const cached =
        getCache(cacheKey);

    if (cached) {

        return cached;

    }

    const data =
        await apiFootball(
            `/fixtures?date=${encodeURIComponent(date)}`
        );

    const fixtures =
        data.response || [];

    let bestMatch =
        fixtures.find(
            fixture => {

                const apiHome =
                    fixture
                        ?.teams
                        ?.home
                        ?.name;

                const apiAway =
                    fixture
                        ?.teams
                        ?.away
                        ?.name;

                return (
                    teamNamesMatch(
                        homeName,
                        apiHome
                    ) &&
                    teamNamesMatch(
                        awayName,
                        apiAway
                    )
                );

            }
        );

    if (!bestMatch) {

        const original =
            new Date(utcDate);

        const nearbyDates = [

            new Date(
                original.getTime() -
                24 * 60 * 60 * 1000
            ),

            new Date(
                original.getTime() +
                24 * 60 * 60 * 1000
            )

        ];

        for (
            const nearbyDate
            of nearbyDates
        ) {

            const nearby =
                nearbyDate
                    .toISOString()
                    .slice(0, 10);

            const nearbyData =
                await apiFootball(
                    `/fixtures?date=${encodeURIComponent(nearby)}`
                );

            const nearbyFixtures =
                nearbyData.response || [];

            bestMatch =
                nearbyFixtures.find(
                    fixture => {

                        const apiHome =
                            fixture
                                ?.teams
                                ?.home
                                ?.name;

                        const apiAway =
                            fixture
                                ?.teams
                                ?.away
                                ?.name;

                        return (
                            teamNamesMatch(
                                homeName,
                                apiHome
                            ) &&
                            teamNamesMatch(
                                awayName,
                                apiAway
                            )
                        );

                    }
                );

            if (bestMatch) {
                break;
            }

        }

    }

    setCache(
        cacheKey,
        bestMatch || null,
        CACHE_TIMES.fixtureSearch
    );

    return bestMatch || null;

}


// ==================================================
// GET COMPLETE API-FOOTBALL FIXTURE
// ==================================================

async function getApiFootballFixture(
    fixtureId,
    cacheType = "match"
) {

    const cacheKey =
        `fixture:${fixtureId}`;

    const cached =
        getCache(cacheKey);

    if (cached) {

        return cached;

    }

    const data =
        await apiFootball(
            `/fixtures?id=${encodeURIComponent(fixtureId)}`
        );

    const fixture =
        data.response?.[0] ||
        null;

    if (fixture) {

        setCache(
            cacheKey,
            fixture,
            CACHE_TIMES[cacheType] ||
            CACHE_TIMES.match
        );

    }

    return fixture;

}


// ==================================================
// NORMALIZE API-FOOTBALL STATUS
// ==================================================

function normalizeApiFootballStatus(
    fixture
) {

    const short =
        String(
            fixture
                ?.fixture
                ?.status
                ?.short ||
            ""
        ).toUpperCase();

    const long =
        fixture
            ?.fixture
            ?.status
            ?.long ||
        "";

    const elapsed =
        fixture
            ?.fixture
            ?.status
            ?.elapsed;

    let live =
        false;

    let halfTime =
        false;

    let finished =
        false;

    if (
        [
            "1H",
            "2H",
            "ET",
            "BT",
            "P",
            "LIVE"
        ].includes(short)
    ) {

        live = true;

    }

    if (short === "HT") {

        halfTime = true;

    }

    if (
        [
            "FT",
            "AET",
            "PEN"
        ].includes(short)
    ) {

        finished = true;

    }

    let liveText =
        "NOT LIVE";

    if (live) {

        liveText =
            elapsed !== null &&
            typeof elapsed === "number"
                ? `${elapsed}'`
                : "LIVE";

    }

    else if (halfTime) {

        liveText =
            "HT";

    }

    else if (finished) {

        liveText =
            "FT";

    }

    else if (short) {

        liveText =
            long ||
            short;

    }

    return {

        status:
            short,

        statusLong:
            long,

        liveMinute:
            typeof elapsed === "number"
                ? elapsed
                : null,

        liveText,

        isLive:
            live,

        isHalfTime:
            halfTime,

        isFinished:
            finished

    };

}


// ==================================================
// NORMALIZE LINEUPS
// ==================================================

function normalizeLineups(
    fixture
) {

    const lineups =
        fixture?.lineups ||
        [];

    const homeTeamId =
        fixture
            ?.teams
            ?.home
            ?.id;

    const awayTeamId =
        fixture
            ?.teams
            ?.away
            ?.id;

    const home =
        lineups.find(
            lineup =>
                lineup?.team?.id ===
                homeTeamId
        );

    const away =
        lineups.find(
            lineup =>
                lineup?.team?.id ===
                awayTeamId
        );

    function players(
        lineup
    ) {

        return (
            lineup?.startXI ||
            []
        ).map(item => {

            return {

                id:
                    item?.player?.id ||
                    null,

                name:
                    item?.player?.name ||
                    "Unknown Player",

                number:
                    item?.player?.number ??
                    null,

                pos:
                    item?.player?.pos ||
                    "",

                grid:
                    item?.player?.grid ||
                    null

            };

        });

    }

    function bench(
        lineup
    ) {

        return (
            lineup?.substitutes ||
            []
        ).map(item => {

            return {

                id:
                    item?.player?.id ||
                    null,

                name:
                    item?.player?.name ||
                    "Unknown Player",

                number:
                    item?.player?.number ??
                    null,

                pos:
                    item?.player?.pos ||
                    ""

            };

        });

    }

    return {

        available:
            lineups.length > 0,

        home: {

            team:
                fixture
                    ?.teams
                    ?.home
                    ?.name ||
                "Home Team",

            teamId:
                homeTeamId ||
                null,

            crest:
                fixture
                    ?.teams
                    ?.home
                    ?.logo ||
                null,

            formation:
                home?.formation ||
                null,

            players:
                players(home),

            bench:
                bench(home)

        },

        away: {

            team:
                fixture
                    ?.teams
                    ?.away
                    ?.name ||
                "Away Team",

            teamId:
                awayTeamId ||
                null,

            crest:
                fixture
                    ?.teams
                    ?.away
                    ?.logo ||
                null,

            formation:
                away?.formation ||
                null,

            players:
                players(away),

            bench:
                bench(away)

        }

    };

}


// ==================================================
// NORMALIZE EVENTS
// ==================================================

function normalizeEvents(
    fixture
) {

    const events =
        fixture?.events ||
        [];

    return events.map(
        event => {

            return {

                time:
                    event?.time?.elapsed ??
                    null,

                extra:
                    event?.time?.extra ??
                    null,

                teamId:
                    event?.team?.id ||
                    null,

                team:
                    event?.team?.name ||
                    "",

                player:
                    event?.player?.name ||
                    "",

                playerId:
                    event?.player?.id ||
                    null,

                assist:
                    event?.assist?.name ||
                    "",

                type:
                    event?.type ||
                    "",

                detail:
                    event?.detail ||
                    "",

                comments:
                    event?.comments ||
                    ""

            };

        }
    );

}


// ==================================================
// GET API-FOOTBALL DATA FOR A GOALRUSH MATCH
// ==================================================

async function getApiFootballMatchData(
    footballDataMatch
) {

    if (
        !process.env.API_FOOTBALL_KEY
    ) {

        return {

            available:
                false,

            reason:
                "API_FOOTBALL_KEY is missing"

        };

    }

    try {

        const fixture =
            await findApiFootballFixture(
                footballDataMatch
            );

        if (!fixture) {

            return {

                available:
                    false,

                reason:
                    "No matching API-Football fixture found"

            };

        }

        const fixtureId =
            fixture.fixture.id;

        const complete =
            await getApiFootballFixture(
                fixtureId,
                "match"
            );

        if (!complete) {

            return {

                available:
                    false,

                reason:
                    "API-Football fixture details unavailable",

                fixtureId

            };

        }

        const status =
            normalizeApiFootballStatus(
                complete
            );

        const lineups =
            normalizeLineups(
                complete
            );

        const events =
            normalizeEvents(
                complete
            );

        return {

            available:
                true,

            provider:
                "API-Football",

            fixtureId,

            status,

            lineups,

            events,

            fixture:
                complete.fixture ||
                null,

            teams:
                complete.teams ||
                null,

            goals:
                complete.goals ||
                null,

            score:
                complete.score ||
                null

        };

    }

    catch (error) {

        console.error(
            "API-FOOTBALL MATCH ERROR:",
            error.message
        );

        return {

            available:
                false,

            reason:
                error.message

        };

    }

}


// ==================================================
// OFFICIAL MATCH WATCH LINKS
// ==================================================
//
// Add real, official, authorized match URLs here.
//
// IMPORTANT:
// The key is the GoalRush / football-data.org
// match ID.
//
// Example:
//
// const WATCH_LINKS = {
//
//     "12345": {
//
//         broadcaster:
//             "Official Broadcaster",
//
//         url:
//             "https://official-site.com/live-match"
//
//     }
//
// };
//
// Do NOT put fake or unofficial streaming links here.
//

const WATCH_LINKS = {};


// ==================================================
// WATCH URL SAFETY
// ==================================================

function isValidWatchUrl(url) {

    try {

        const parsed =
            new URL(url);

        return (
            parsed.protocol === "http:" ||
            parsed.protocol === "https:"
        );

    }

    catch {

        return false;

    }

}


// ==================================================
// HOME / API STATUS
// ==================================================

app.get("/", (req, res) => {

    res.json({

        message:
            "GoalRush API is running!",

        status:
            "online"

    });

});


// ==================================================
// TEAM SEARCH
// ==================================================

app.get("/api/teams", async (req, res) => {

    const search =
        req.query.search
            ?.trim()
            .toLowerCase();

    if (!search) {

        return res.status(400).json({

            error:
                "Enter a team name"

        });

    }

    try {

        const response =
            await footballAPI(
                "https://api.football-data.org/v4/teams?limit=100"
            );

        if (!response.ok) {

            console.error(
                "TEAM API ERROR:",
                response.status
            );

            return res.status(
                response.status
            ).json({

                error:
                    "Could not load teams"

            });

        }

        const data =
            await response.json();

        const teams =
            (data.teams || [])
                .filter(team =>

                    (
                        team.name &&
                        team.name
                            .toLowerCase()
                            .includes(search)
                    )

                    ||

                    (
                        team.shortName &&
                        team.shortName
                            .toLowerCase()
                            .includes(search)
                    )

                    ||

                    (
                        team.tla &&
                        team.tla
                            .toLowerCase()
                            .includes(search)
                    )

                );

        res.json({

            teams

        });

    }

    catch (error) {

        console.error(
            "TEAM SEARCH ERROR:",
            error
        );

        res.status(500).json({

            error:
                "Could not contact football API"

        });

    }

});


// ==================================================
// TEAM MATCHES
// ==================================================

app.get("/api/matches", async (req, res) => {

    const teamId =
        req.query.teamId;

    if (!teamId) {

        return res.status(400).json({

            error:
                "Team ID is required"

        });

    }

    try {

        const response =
            await footballAPI(
                `https://api.football-data.org/v4/teams/${encodeURIComponent(teamId)}/matches?status=SCHEDULED&limit=10`
            );

        if (!response.ok) {

            return res.status(
                response.status
            ).json({

                error:
                    "Could not get matches"

            });

        }

        const data =
            await response.json();

        res.json(data);

    }

    catch (error) {

        console.error(
            "MATCHES ERROR:",
            error
        );

        res.status(500).json({

            error:
                "Could not contact football API"

        });

    }

});


// ==================================================
// LIVE MATCHES
// ==================================================

app.get("/api/live", async (req, res) => {

    try {

        const response =
            await footballAPI(
                "https://api.football-data.org/v4/matches?status=LIVE"
            );

        if (!response.ok) {

            return res.status(
                response.status
            ).json({

                error:
                    "Could not get live matches"

            });

        }

        const data =
            await response.json();

        res.json(data);

    }

    catch (error) {

        console.error(
            "LIVE ERROR:",
            error
        );

        res.status(500).json({

            error:
                "Could not contact football API"

        });

    }

});


// ==================================================
// RECENT RESULTS
// ==================================================

app.get("/api/results", async (req, res) => {

    try {

        const response =
            await footballAPI(
                "https://api.football-data.org/v4/matches?status=FINISHED&limit=10"
            );

        if (!response.ok) {

            return res.status(
                response.status
            ).json({

                error:
                    "Could not get recent results"

            });

        }

        const data =
            await response.json();

        res.json(data);

    }

    catch (error) {

        console.error(
            "RESULTS ERROR:",
            error
        );

        res.status(500).json({

            error:
                "Could not contact football API"

        });

    }

});


// ==================================================
// MATCH CENTRE
// ==================================================

app.get("/api/match/:id", async (req, res) => {

    const matchId =
        req.params.id;

    if (!matchId) {

        return res.status(400).json({

            error:
                "Match ID is required"

        });

    }

    try {

        const response =
            await footballAPI(
                `https://api.football-data.org/v4/matches/${encodeURIComponent(matchId)}`
            );

        if (!response.ok) {

            console.error(
                "MATCH API ERROR:",
                response.status
            );

            return res.status(
                response.status
            ).json({

                error:
                    "Could not get match details"

            });

        }

        const data =
            await response.json();

        let liveMinute =
            null;

        if (
            typeof data.minute ===
            "number"
        ) {

            liveMinute =
                data.minute;

        }

        const originalStatus =
            String(
                data.status ||
                ""
            ).toUpperCase();

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

        }

        else if (
            originalStatus ===
            "PAUSED"
        ) {

            liveText =
                "HT";

        }

        else if (
            originalStatus ===
            "FINISHED"
        ) {

            liveText =
                "FT";

        }

        let apiFootballData =
            null;

        apiFootballData =
            await getApiFootballMatchData(
                data
            );

        if (
            apiFootballData?.available &&
            apiFootballData?.status
        ) {

            const apiStatus =
                apiFootballData.status;

            if (
                apiStatus.liveMinute !==
                null
            ) {

                liveMinute =
                    apiStatus.liveMinute;

            }

            liveText =
                apiStatus.liveText;

        }

        const match = {

            ...data,

            liveMinute,

            liveText,

            isLive:
                apiFootballData?.available
                    ? apiFootballData
                        .status
                        .isLive
                    : originalStatus ===
                      "IN_PLAY",

            isHalfTime:
                apiFootballData?.available
                    ? apiFootballData
                        .status
                        .isHalfTime
                    : originalStatus ===
                      "PAUSED",

            isFinished:
                apiFootballData?.available
                    ? apiFootballData
                        .status
                        .isFinished
                    : originalStatus ===
                      "FINISHED",

            apiFootball:
                apiFootballData,

            events:
                apiFootballData
                    ?.events ||
                data.events ||
                [],

            lineups:
                apiFootballData
                    ?.lineups ||
                null

        };

        res.json(match);

    }

    catch (error) {

        console.error(
            "MATCH DETAILS ERROR:",
            error
        );

        res.status(500).json({

            error:
                "Could not contact football API"

        });

    }

});


// ==================================================
// OFFICIAL MATCH WATCH
// ==================================================

app.get(
    "/api/match/:id/watch",
    async (req, res) => {

        const matchId =
            String(req.params.id);

        if (!matchId) {

            return res.status(400).json({

                error:
                    "Match ID is required"

            });

        }

        try {

            const watch =
                WATCH_LINKS[matchId] ||
                null;


            if (
                watch &&
                watch.url &&
                isValidWatchUrl(watch.url)
            ) {

                return res.json({

                    available:
                        true,

                    broadcaster:
                        watch.broadcaster ||
                        "Official Broadcaster",

                    url:
                        watch.url

                });

            }


            return res.json({

                available:
                    false,

                broadcaster:
                    null,

                url:
                    null,

                message:
                    "No official live stream has been configured for this match yet."

            });

        }

        catch (error) {

            console.error(
                "WATCH LINK ERROR:",
                error
            );

            return res.status(500).json({

                error:
                    "Could not load official watch information"

            });

        }

    }
);


// ==================================================
// MATCH LIVE STATUS
// ==================================================

app.get(
    "/api/match/:id/live",
    async (req, res) => {

        const matchId =
            req.params.id;

        try {

            const response =
                await footballAPI(
                    `https://api.football-data.org/v4/matches/${encodeURIComponent(matchId)}`
                );

            if (!response.ok) {

                return res.status(
                    response.status
                ).json({

                    error:
                        "Could not get live match"

                });

            }

            const data =
                await response.json();

            const originalStatus =
                String(
                    data.status ||
                    ""
                ).toUpperCase();

            let minute =
                typeof data.minute ===
                "number"
                    ? data.minute
                    : null;

            let status =
                originalStatus;

            let live =
                originalStatus ===
                "IN_PLAY";

            let halfTime =
                originalStatus ===
                "PAUSED";

            let finished =
                originalStatus ===
                "FINISHED";

            const apiData =
                await getApiFootballMatchData(
                    data
                );

            if (
                apiData?.available
            ) {

                status =
                    apiData
                        .status
                        .status;

                minute =
                    apiData
                        .status
                        .liveMinute;

                live =
                    apiData
                        .status
                        .isLive;

                halfTime =
                    apiData
                        .status
                        .isHalfTime;

                finished =
                    apiData
                        .status
                        .isFinished;

            }

            res.json({

                id:
                    data.id,

                status,

                minute,

                live,

                halfTime,

                finished,

                score:
                    data.score ||
                    apiData?.score ||
                    null,

                apiFootball:
                    apiData?.available
                        ? {

                            fixtureId:
                                apiData.fixtureId,

                            liveText:
                                apiData.status
                                    .liveText

                        }
                        : null

            });

        }

        catch (error) {

            console.error(
                "LIVE MATCH ERROR:",
                error
            );

            res.status(500).json({

                error:
                    "Could not contact football API"

            });

        }

    }
);


// ==================================================
// LINEUPS
// ==================================================

app.get(
    "/api/match/:id/lineups",
    async (req, res) => {

        const matchId =
            req.params.id;

        try {

            const response =
                await footballAPI(
                    `https://api.football-data.org/v4/matches/${encodeURIComponent(matchId)}`
            );

            if (!response.ok) {

                return res.status(
                    response.status
                ).json({

                    error:
                        "Could not get match"

                });

            }

            const match =
                await response.json();

            const apiData =
                await getApiFootballMatchData(
                    match
                );

            if (
                apiData?.available &&
                apiData?.lineups
            ) {

                return res.json({

                    matchId,

                    provider:
                        "API-Football",

                    fixtureId:
                        apiData.fixtureId,

                    ...apiData.lineups

                });

            }

            const home =
                match.homeTeam ||
                {};

            const away =
                match.awayTeam ||
                {};

            const homeLineup =
                home.lineup ||
                match.homeLineup ||
                [];

            const awayLineup =
                away.lineup ||
                match.awayLineup ||
                [];

            const homeBench =
                home.bench ||
                match.homeBench ||
                [];

            const awayBench =
                away.bench ||
                match.awayBench ||
                [];

            const homeFormation =
                home.formation ||
                match.homeFormation ||
                null;

            const awayFormation =
                away.formation ||
                match.awayFormation ||
                null;

            const hasLineups =
                homeLineup.length > 0 ||
                awayLineup.length > 0;

            res.json({

                matchId,

                provider:
                    "football-data.org",

                available:
                    hasLineups,

                home: {

                    team:
                        home.name ||
                        "Home Team",

                    teamId:
                        home.id ||
                        null,

                    crest:
                        home.crest ||
                        null,

                    formation:
                        homeFormation,

                    players:
                        homeLineup,

                    bench:
                        homeBench

                },

                away: {

                    team:
                        away.name ||
                        "Away Team",

                    teamId:
                        away.id ||
                        null,

                    crest:
                        away.crest ||
                        null,

                    formation:
                        awayFormation,

                    players:
                        awayLineup,

                    bench:
                        awayBench

                }

            });

        }

        catch (error) {

            console.error(
                "LINEUPS ERROR:",
                error
            );

            res.status(500).json({

                error:
                    "Could not contact football API"

            });

        }

    }
);


// ==================================================
// MATCH EVENTS
// ==================================================

app.get(
    "/api/match/:id/events",
    async (req, res) => {

        const matchId =
            req.params.id;

        try {

            const response =
                await footballAPI(
                    `https://api.football-data.org/v4/matches/${encodeURIComponent(matchId)}`
            );

            if (!response.ok) {

                return res.status(
                    response.status
                ).json({

                    error:
                        "Could not get match"

                });

            }

            const match =
                await response.json();

            const apiData =
                await getApiFootballMatchData(
                    match
                );

            if (
                apiData?.available
            ) {

                return res.json({

                    matchId,

                    provider:
                        "API-Football",

                    fixtureId:
                        apiData.fixtureId,

                    events:
                        apiData.events ||
                        []

                });

            }

            res.json({

                matchId,

                provider:
                    "football-data.org",

                events:
                    match.events ||
                    match.timeline ||
                    []

            });

        }

        catch (error) {

            console.error(
                "EVENTS ERROR:",
                error
            );

            res.status(500).json({

                error:
                    "Could not contact football API"

            });

        }

    }
);


// ==================================================
// API-FOOTBALL DIRECT MATCH DATA
// ==================================================

app.get(
    "/api/football/fixture/:fixtureId",
    async (req, res) => {

        const fixtureId =
            req.params.fixtureId;

        if (!fixtureId) {

            return res.status(400).json({

                error:
                    "API-Football fixture ID is required"

            });

        }

        try {

            const fixture =
                await getApiFootballFixture(
                    fixtureId
                );

            if (!fixture) {

                return res.status(404).json({

                    error:
                        "API-Football fixture not found"

                });

            }

            res.json({

                provider:
                    "API-Football",

                fixture

            });

        }

        catch (error) {

            console.error(
                "DIRECT API-FOOTBALL ERROR:",
                error
            );

            res.status(500).json({

                error:
                    error.message

            });

        }

    }
);


// ==================================================
// API-FOOTBALL LIVE
// ==================================================

app.get(
    "/api/football/live",
    async (req, res) => {

        try {

            const cacheKey =
                "api-football-live";

            const cached =
                getCache(cacheKey);

            if (cached) {

                return res.json({

                    provider:
                        "API-Football",

                    response:
                        cached

                });

            }

            const data =
                await apiFootball(
                    "/fixtures?live=all"
                );

            setCache(
                cacheKey,
                data.response ||
                [],
                30 * 1000
            );

            res.json({

                provider:
                    "API-Football",

                response:
                    data.response ||
                    []

            });

        }

        catch (error) {

            console.error(
                "API-FOOTBALL LIVE ERROR:",
                error
            );

            res.status(500).json({

                error:
                    error.message

            });

        }

    }
);


// ==================================================
// UPCOMING FIXTURES
// ==================================================

app.get(
    "/api/fixtures",
    async (req, res) => {

        try {

            const today =
                new Date();

            const futureDate =
                new Date(today);

            futureDate.setDate(
                today.getDate() + 10
            );

            const dateFrom =
                today
                    .toISOString()
                    .split("T")[0];

            const dateTo =
                futureDate
                    .toISOString()
                    .split("T")[0];

            const competition =
                String(
                    req.query.competition ||
                    ""
                ).toUpperCase();

            let url =
                "https://api.football-data.org/v4/matches" +
                `?dateFrom=${dateFrom}` +
                `&dateTo=${dateTo}` +
                "&status=SCHEDULED";

            if (competition) {

                url +=
                    `&competitions=${encodeURIComponent(competition)}`;

            }

            const response =
                await footballAPI(url);

            const body =
                await response.text();

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
                        body

                });

            }

            const data =
                JSON.parse(body);

            const matches =
                (data.matches || [])
                    .map(match => {

                        return {

                            id:
                                match.id,

                            utcDate:
                                match.utcDate,

                            status:
                                match.status,

                            homeTeam: {

                                id:
                                    match.homeTeam?.id ||
                                    null,

                                name:
                                    match.homeTeam?.name ||
                                    "Home Team",

                                crest:
                                    match.homeTeam?.crest ||
                                    null

                            },

                            awayTeam: {

                                id:
                                    match.awayTeam?.id ||
                                    null,

                                name:
                                    match.awayTeam?.name ||
                                    "Away Team",

                                crest:
                                    match.awayTeam?.crest ||
                                    null

                            },

                            competition: {

                                name:
                                    match.competition?.name ||
                                    "Football",

                                code:
                                    match.competition?.code ||
                                    ""

                            }

                        };

                    });

            console.log(
                "FIXTURES FOUND:",
                matches.length
            );

            res.json({

                matches

            });

        }

        catch (error) {

            console.error(
                "FIXTURES ERROR:",
                error
            );

            res.status(500).json({

                error:
                    "Could not contact football API"

            });

        }

    }
);


// ==================================================
// STANDINGS
// ==================================================

app.get(
    "/api/standings",
    async (req, res) => {

        const competition =
            req.query.competition ||
            "PL";

        try {

            const response =
                await footballAPI(
                    `https://api.football-data.org/v4/competitions/${encodeURIComponent(competition)}/standings`
                );

            if (!response.ok) {

                return res.status(
                    response.status
                ).json({

                    error:
                        "Could not get standings"

                });

            }

            const data =
                await response.json();

            res.json(data);

        }

        catch (error) {

            console.error(
                "STANDINGS ERROR:",
                error
            );

            res.status(500).json({

                error:
                    "Could not contact football API"

            });

        }

    }
);


// ==================================================
// NEWS
// ==================================================

app.get(
    "/api/news",
    async (req, res) => {

        const search =
            req.query.search
                ?.trim() ||
            "football";

        try {

            const apiKey =
                process.env.GNEWS_API_KEY;

            if (!apiKey) {

                return res.status(500).json({

                    error:
                        "GNEWS_API_KEY is missing"

                });

            }

            const newsURL =
                "https://gnews.io/api/v4/search" +
                "?q=" +
                encodeURIComponent(search) +
                "&lang=en" +
                "&max=10" +
                "&apikey=" +
                encodeURIComponent(apiKey);

            const response =
                await fetch(newsURL);

            const body =
                await response.text();

            if (!response.ok) {

                console.error(
                    "NEWS API ERROR:",
                    response.status,
                    body
                );

                return res.status(
                    response.status
                ).json({

                    error:
                        "Could not load football news",

                    details:
                        body

                });

            }

            const data =
                JSON.parse(body);

            res.json(data);

        }

        catch (error) {

            console.error(
                "NEWS ERROR:",
                error
            );

            res.status(500).json({

                error:
                    "Could not contact news server"

            });

        }

    }
);


// ==================================================
// GOALRUSH AI 🤖
// ==================================================

app.post(
    "/api/ai",
    async (req, res) => {

        const question =
            req.body
                ?.question
                ?.trim();

        if (!question) {

            return res.status(400).json({

                error:
                    "Please enter a question"

            });

        }

        if (!openai) {

            return res.status(500).json({

                error:
                    "OPENAI_API_KEY is missing"

            });

        }

        try {

            const response =
                await openai.responses.create({

                    model:
                        "gpt-5.6",

                    instructions:
                        "You are GoalRush AI, a football assistant. " +
                        "Answer football questions clearly and briefly. " +
                        "Be helpful and friendly. " +
                        "Do not invent current football information.",

                    input:
                        question

                });

            res.json({

                answer:
                    response.output_text ||
                    "Sorry, I couldn't answer that."

            });

        }

        catch (error) {

            console.error(
                "GOALRUSH AI ERROR:",
                error
            );

            res.status(500).json({

                error:
                    "Could not contact GoalRush AI"

            });

        }

    }
);


// ==================================================
// UNKNOWN API ROUTE
// ==================================================

app.use(
    "/api",
    (req, res) => {

        res.status(404).json({

            error:
                "GoalRush API endpoint not found"

        });

    }
);


// ==================================================
// VERCEL / LOCAL SERVER
// ==================================================

const PORT =
    process.env.PORT ||
    3000;


if (
    require.main === module
) {

    app.listen(
        PORT,
        () => {

            console.log(
                `GoalRush server is running on port ${PORT}`
            );

        }
    );

}


// ==================================================
// VERCEL EXPORT
// ==================================================

module.exports = app;
