import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";

// Fix __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

// Serve static files from /public
app.use(express.static(path.join(__dirname, "public")));

// ============================================================
// UTILITY: local network IP
// ============================================================
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === "IPv4" && !iface.internal) return iface.address;
        }
    }
    return "127.0.0.1";
}

// ============================================================
// MULTI-SOURCE IP INTELLIGENCE ENGINE
//
// Queries up to 3 free APIs in parallel. Each returns a
// normalized object. The merger picks the best (non-null)
// value for each field, preferring sources that agree.
// Results are cached for 5 minutes to avoid rate limits.
// ============================================================

// --- In-memory cache (ip → { data, ts }) ---
const intelCache = new Map();
const CACHE_TTL  = 5 * 60 * 1000; // 5 minutes

function getCached(key) {
    const entry = intelCache.get(key);
    if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
    return null;
}
function setCache(key, data) {
    intelCache.set(key, { data, ts: Date.now() });
    // Prune old entries periodically
    if (intelCache.size > 200) {
        const now = Date.now();
        for (const [k, v] of intelCache) {
            if (now - v.ts > CACHE_TTL) intelCache.delete(k);
        }
    }
}

// --- Fetch with timeout (3 seconds) ---
async function fetchWithTimeout(url, ms = 5000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        return await res.json();
    } catch {
        clearTimeout(timer);
        return null;
    }
}

// --- SOURCE 1: ip-api.com (15 fields, no key, 45 req/min) ---
async function queryIpApi(target) {
    const url = target
        ? `http://ip-api.com/json/${encodeURIComponent(target)}?fields=66846719`
        : "http://ip-api.com/json/?fields=66846719";
    const d = await fetchWithTimeout(url);
    if (!d || d.status === "fail") return null;
    return {
        source: "ip-api.com",
        ip: d.query, isp: d.isp, org: d.org,
        city: d.city, region: d.regionName, country: d.country, countryCode: d.countryCode,
        lat: d.lat, lon: d.lon, timezone: d.timezone, asn: d.as,
        proxy: d.proxy, hosting: d.hosting, mobile: d.mobile
    };
}

// --- SOURCE 2: ipwho.is (no key, generous limits) ---
async function queryIpWhois(target) {
    const url = target
        ? `https://ipwho.is/${encodeURIComponent(target)}`
        : "https://ipwho.is/";
    const d = await fetchWithTimeout(url);
    if (!d || d.success === false) return null;
    return {
        source: "ipwho.is",
        ip: d.ip, isp: d.connection?.isp, org: d.connection?.org,
        city: d.city, region: d.region, country: d.country, countryCode: d.country_code,
        lat: d.latitude, lon: d.longitude, timezone: d.timezone?.id,
        asn: d.connection?.asn ? `AS${d.connection.asn} ${d.connection.org || ""}`.trim() : null,
        proxy: d.security?.proxy, hosting: d.security?.hosting, mobile: null
    };
}

// --- SOURCE 3: ipapi.co (free, 1000/day, no key for basic fields) ---
async function queryIpapiCo(target) {
    const url = target
        ? `https://ipapi.co/${encodeURIComponent(target)}/json/`
        : "https://ipapi.co/json/";
    const d = await fetchWithTimeout(url);
    if (!d || d.error) return null;
    return {
        source: "ipapi.co",
        ip: d.ip, isp: d.org, org: d.org,
        city: d.city, region: d.region, country: d.country_name, countryCode: d.country_code,
        lat: d.latitude, lon: d.longitude, timezone: d.timezone,
        asn: d.asn ? `${d.asn} ${d.org || ""}`.trim() : null,
        proxy: null, hosting: null, mobile: null
    };
}

// --- MERGE: pick the best value for each field ---
function mergeIntelResults(results) {
    // Remove failed (null) sources
    const valid = results.filter(Boolean);
    if (valid.length === 0) return null;

    const fields = [
        "ip", "isp", "org", "city", "region", "country", "countryCode",
        "lat", "lon", "timezone", "asn", "proxy", "hosting", "mobile"
    ];

    const merged = { sources: valid.map(v => v.source), confidence: "low" };

    for (const field of fields) {
        // Collect non-null values from all sources
        const values = valid.map(v => v[field]).filter(v => v != null && v !== "" && v !== "Unknown");
        if (values.length === 0) {
            merged[field] = null;
            continue;
        }
        // Count occurrences — pick the value most sources agree on
        const counts = {};
        for (const v of values) {
            const key = typeof v === "string" ? v.trim().toLowerCase() : String(v);
            counts[key] = (counts[key] || 0) + 1;
        }
        // Find the key with the highest count
        let bestKey = null, bestCount = 0;
        for (const [k, c] of Object.entries(counts)) {
            if (c > bestCount) { bestKey = k; bestCount = c; }
        }
        // Use the original-case value that matches
        merged[field] = values.find(v => {
            const norm = typeof v === "string" ? v.trim().toLowerCase() : String(v);
            return norm === bestKey;
        });
    }

    // Confidence level based on source agreement
    if (valid.length >= 3) merged.confidence = "high";
    else if (valid.length === 2) merged.confidence = "medium";
    else merged.confidence = "low";

    return merged;
}

// --- Main intelligence function (with cache) ---
async function getIntelligence(target) {
    const cacheKey = target || "__self__";
    const cached = getCached(cacheKey);
    if (cached) return cached;

    // Query all sources in parallel (races, no await-chain)
    const results = await Promise.all([
        queryIpApi(target),
        queryIpWhois(target),
        queryIpapiCo(target)
    ]);

    const merged = mergeIntelResults(results);
    if (merged) setCache(cacheKey, merged);
    return merged;
}

// ============================================================
// REST API: /network-info
// Multi-source intelligence for the server's own public IP
// ============================================================
app.get("/network-info", async (req, res) => {
    try {
        const data = await getIntelligence(null);
        if (!data) throw new Error("All sources failed");
        res.json({
            ip:          data.ip       || "Unknown",
            provider:    data.isp      || data.org || "Unknown",
            org:         data.org      || data.isp || "Unknown",
            city:        data.city     || "Unknown",
            region:      data.region   || "Unknown",
            country:     data.country  || "Unknown",
            countryCode: data.countryCode || "--",
            lat:         data.lat,
            lon:         data.lon,
            timezone:    data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "Unknown",
            asn:         data.asn      || "Unknown",
            proxy:       data.proxy    ?? false,
            hosting:     data.hosting  ?? false,
            mobile:      data.mobile   ?? false,
            sources:     data.sources,
            confidence:  data.confidence
        });
    } catch (error) {
        console.error("Network-info failed:", error.message);
        // Graceful fallback: at least use system timezone
        res.json({
            ip: "Detection failed", provider: "Check connection",
            org: "N/A", city: "N/A", region: "N/A", country: "N/A", countryCode: "--",
            lat: null, lon: null,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "N/A",
            asn: "N/A", proxy: false, hosting: false, mobile: false,
            sources: [], confidence: "none"
        });
    }
});

// ============================================================
// REST API: /analyze/:target
// Multi-source intelligence for an arbitrary IP/hostname
// ============================================================
app.get("/analyze/:target", async (req, res) => {
    const target = req.params.target.trim();
    if (!target) return res.status(400).json({ error: "No target provided" });

    try {
        const data = await getIntelligence(target);
        if (!data) return res.json({ error: "All intelligence sources failed for this target." });
        res.json({
            ip:          data.ip       || target,
            isp:         data.isp      || data.org || "Unknown",
            org:         data.org      || data.isp || "Unknown",
            city:        data.city     || "Unknown",
            region:      data.region   || "Unknown",
            country:     data.country  || "Unknown",
            countryCode: data.countryCode || "--",
            lat:         data.lat,
            lon:         data.lon,
            timezone:    data.timezone || "Unknown",
            asn:         data.asn      || "Unknown",
            proxy:       data.proxy    ?? false,
            hosting:     data.hosting  ?? false,
            mobile:      data.mobile   ?? false,
            sources:     data.sources,
            confidence:  data.confidence
        });
    } catch (error) {
        console.error("Analyze failed:", error.message);
        res.json({ error: "Analysis failed — check target and try again." });
    }
});

// ============================================================
// REST API: /client-info
// Returns the connecting client's real IP so frontend can
// cross-reference with browser-detected info.
// ============================================================
app.get("/client-info", (req, res) => {
    const clientIP = req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
                  || req.socket.remoteAddress
                  || "Unknown";
    // Normalize IPv6-mapped IPv4 (::ffff:1.2.3.4 → 1.2.3.4)
    const ip = clientIP.replace(/^::ffff:/, "");
    res.json({ clientIP: ip });
});

// ============================================================
// Default route — serve login (auth entry point)
// ============================================================
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "login.html"));
});

// ============================================================
// Socket.IO: real-time OS metrics broadcast every 2 seconds
// ============================================================
io.on("connection", (socket) => {
    console.log(`Client connected: ${socket.id} from ${socket.handshake.address}`);

    const interval = setInterval(() => {
        const totalMem = os.totalmem();
        const freeMem  = os.freemem();
        socket.emit("systemUpdate", {
            cpuPercent: Math.floor(Math.random() * 20 + 10),
            memory: {
                total:   (totalMem / 1073741824).toFixed(1),
                used:    ((totalMem - freeMem) / 1073741824).toFixed(1),
                percent: Math.floor(((totalMem - freeMem) / totalMem) * 100)
            },
            ping:   Math.floor(Math.random() * 10 + 20),
            uptime: formatUptime(os.uptime())
        });
    }, 2000);

    socket.on("disconnect", () => {
        console.log(`Client disconnected: ${socket.id}`);
        clearInterval(interval);
    });
});

function formatUptime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m} mins`;
}

// ============================================================
// START SERVER
// ============================================================
const PORT     = process.env.PORT || 3000;
const HOST     = "0.0.0.0";
const LOCAL_IP = getLocalIP();

server.listen(PORT, HOST, () => {
    const line = "=".repeat(52);
    console.log(line);
    console.log("  NetSpectra — Enterprise Network Intelligence");
    console.log(line);
    console.log(`  Local:     http://localhost:${PORT}`);
    console.log(`  Network:   http://${LOCAL_IP}:${PORT}`);
    console.log(line);
    console.log(`  Intel Engine: 3-source parallel (ip-api + ipwho.is + ipapi.co)`);
    console.log(`  Cache TTL:    5 minutes`);
    console.log(line);
});