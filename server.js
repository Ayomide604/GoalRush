const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));


// ==================================================
// HELPER: FOOTBALL API REQUEST
// ==================================================

async function footballAPI(url) {
    return fetch(url, {
        headers: {
            "X-Auth-Token": process.env.FOOTBALL_API_TOKEN
        }
    });
}


// ==================================================
// SEARCH FOR TEAMS
// ==================================================

app.get("/api/teams", async (req, res) => {
    const search =
        req.query.search?.trim().toLowerCase();

    if (!search) {
        return res.status(400).json({
            error: "Enter a team name"
        });
    }

    try {
        const response = await footballAPI(
            "https://api.football-data.org/v4/teams?limit=100"
        );

        if (!response.ok) {
            const errorText = await response.text();

            console.error(
                "Football API error:",
                response.status,
                errorText
            );

            return res.status(response.status).json({
                error: "Football API request failed"
            });
        }

        const data = await response.json();

        const teams = (data.teams || []).filter(team =>
            (
                team.name &&
                team.name.toLowerCase().includes(search)
            ) ||
            (
                team.shortName &&
                team.shortName.toLowerCase().includes(search)
            ) ||
            (
                team.tla &&
                team.tla.toLowerCase().includes(search)
            )
        );

        res.json({
            teams: teams
        });

    } catch (error) {
        console.error("API ERROR:", error);

        res.status(500).json({
            error: "Could not contact football API"
        });
    }
});


// ==================================================
// GET TEAM MATCHES
// ==================================================

app.get("/api/matches", async (req, res) => {
    const teamId = req.query.teamId;

    if (!teamId) {
        return res.status(400).json({
            error: "Team ID is required"
        });
    }

    try {
        const response = await footballAPI(
            `https://api.football-data.org/v4/teams/${teamId}/matches?status=SCHEDULED&limit=10`
        );

        if (!response.ok) {
            const errorText = await response.text();

            console.error(
                "Matches API error:",
                response.status,
                errorText
            );

            return res.status(response.status).json({
                error: "Could not get matches"
            });
        }

        const data = await response.json();

        res.json(data);

    } catch (error) {
        console.error("MATCH API ERROR:", error);

        res.status(500).json({
            error: "Could not contact football API"
        });
    }
});


// ==================================================
// LIVE MATCHES
// ==================================================

app.get("/api/live", async (req, res) => {
    try {
        const response = await footballAPI(
            "https://api.football-data.org/v4/matches?status=LIVE"
        );

        if (!response.ok) {
            const errorText = await response.text();

            console.error(
                "Live API error:",
                response.status,
                errorText
            );

            return res.status(response.status).json({
                error: "Could not get live matches"
            });
        }

        const data = await response.json();

        res.json(data);

    } catch (error) {
        console.error("LIVE API ERROR:", error);

        res.status(500).json({
            error: "Could not contact football API"
        });
    }
});


// ==================================================
// RECENT RESULTS
// ==================================================

app.get("/api/results", async (req, res) => {
    try {
        const response = await footballAPI(
            "https://api.football-data.org/v4/matches?status=FINISHED&limit=10"
        );

        if (!response.ok) {
            const errorText = await response.text();

            console.error(
                "Results API error:",
                response.status,
                errorText
            );

            return res.status(response.status).json({
                error: "Could not get recent results"
            });
        }

        const data = await response.json();

        res.json(data);

    } catch (error) {
        console.error("RESULTS API ERROR:", error);

        res.status(500).json({
            error: "Could not contact football API"
        });
    }
});


// ==================================================
// MATCH DETAILS
// ==================================================

app.get("/api/match/:id", async (req, res) => {
    const matchId = req.params.id;

    try {
        const response = await footballAPI(
            `https://api.football-data.org/v4/matches/${matchId}`
        );

        if (!response.ok) {
            const errorText = await response.text();

            console.error(
                "Match details API error:",
                response.status,
                errorText
            );

            return res.status(response.status).json({
                error: "Could not get match details"
            });
        }

        const data = await response.json();

        res.json(data);

    } catch (error) {
        console.error("MATCH DETAILS ERROR:", error);

        res.status(500).json({
            error: "Could not contact football API"
        });
    }
});


// ==================================================
// LEAGUE STANDINGS
// ==================================================

app.get("/api/standings", async (req, res) => {
    const competition =
        req.query.competition || "PL";

    try {
        const response = await footballAPI(
            `https://api.football-data.org/v4/competitions/${encodeURIComponent(competition)}/standings`
        );

        if (!response.ok) {
            const errorText = await response.text();

            console.error(
                "Standings API error:",
                response.status,
                errorText
            );

            return res.status(response.status).json({
                error: "Could not get standings"
            });
        }

        const data = await response.json();

        res.json(data);

    } catch (error) {
        console.error("STANDINGS API ERROR:", error);

        res.status(500).json({
            error: "Could not contact football API"
        });
    }
});


// ==================================================
// FOOTBALL NEWS
// ==================================================

app.get("/api/news", async (req, res) => {
    const search =
        req.query.search?.trim() ||
        "football";

    try {
        const apiKey =
            process.env.GNEWS_API_KEY;

        if (!apiKey) {
            return res.status(500).json({
                error: "GNews API key is missing"
            });
        }

        const newsURL =
            "https://gnews.io/api/v4/search" +
            "?q=" +
            encodeURIComponent(search) +
            "&lang=en" +
            "&country=gb" +
            "&max=10" +
            "&apikey=" +
            encodeURIComponent(apiKey);

        const response = await fetch(newsURL);

        if (!response.ok) {
            const errorText = await response.text();

            console.error(
                "News API error:",
                response.status,
                errorText
            );

            return res.status(response.status).json({
                error: "Could not load football news"
            });
        }

        const data = await response.json();

        res.json(data);

    } catch (error) {
        console.error("NEWS API ERROR:", error);

        res.status(500).json({
            error: "Could not contact news server"
        });
    }
});


// ==================================================
// HOME ROUTE
// ==================================================

app.get("/", (req, res) => {
    res.json({
        message: "GoalRush server is running!",
        status: "online"
    });
});


// ==================================================
// START SERVER
// ==================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(
        `GoalRush server is running on port ${PORT}`
    );
});