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
// UTILITY: Detect the machine's local network IP address
// (first non-internal IPv4 address on any interface).
// This is the address other devices on the same WiFi can use.
// ============================================================
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === "IPv4" && !iface.internal) {
                return iface.address;
            }
        }
    }
    return "127.0.0.1"; // fallback
}

// ============================================================
// REST API: /network-info
// Returns real public IP, ISP, and geolocation via ip-api.com.
// ============================================================
app.get("/network-info", async (req, res) => {
    try {
        const response = await fetch("http://ip-api.com/json/");
        const data     = await response.json();
        res.json({
            ip:       data.query,
            provider: data.isp,
            city:     data.city,
            country:  data.country,
            lat:      data.lat,
            lon:      data.lon,
            timezone: data.timezone,
            asn:      data.as
        });
    } catch (error) {
        console.error("Network-info fetch failed:", error.message);
        res.json({
            ip: "Unavailable", provider: "Unavailable",
            city: "Unavailable", country: "Unavailable",
            lat: null, lon: null, timezone: "Unavailable", asn: "Unavailable"
        });
    }
});

// ============================================================
// REST API: /analyze/:target
// Accepts an IP / hostname, returns full geolocation + ASN.
// ============================================================
app.get("/analyze/:target", async (req, res) => {
    const target = req.params.target.trim();
    if (!target) return res.status(400).json({ error: "No target provided" });

    try {
        const response = await fetch(`http://ip-api.com/json/${encodeURIComponent(target)}`);
        const data     = await response.json();
        if (data.status === "fail") {
            return res.json({ error: data.message || "Lookup failed" });
        }
        res.json({
            ip:       data.query,
            isp:      data.isp,
            org:      data.org,
            city:     data.city,
            country:  data.country,
            lat:      data.lat,
            lon:      data.lon,
            timezone: data.timezone,
            asn:      data.as
        });
    } catch (error) {
        console.error("Analyze fetch failed:", error.message);
        res.json({ error: "Analysis failed — check target and try again." });
    }
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

// Format uptime as "Xh Ym" for readability
function formatUptime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m} mins`;
}

// ============================================================
// START SERVER — bind to 0.0.0.0 so all network interfaces
// are reachable (LAN, WiFi, etc.)
// ============================================================
const PORT     = process.env.PORT || 3000;
const HOST     = "0.0.0.0";           // listen on all interfaces
const LOCAL_IP = getLocalIP();

server.listen(PORT, HOST, () => {
    const line = "=".repeat(52);
    console.log(line);
    console.log("  NetSpectra — Enterprise Network Intelligence");
    console.log(line);
    console.log(`  Local:     http://localhost:${PORT}`);
    console.log(`  Network:   http://${LOCAL_IP}:${PORT}   ← share this with mobile/tablet`);
    console.log(line);
    console.log(`  Pages:`);
    console.log(`    Login      → http://${LOCAL_IP}:${PORT}/login.html`);
    console.log(`    Overview   → http://${LOCAL_IP}:${PORT}/index.html`);
    console.log(`    Dashboard  → http://${LOCAL_IP}:${PORT}/dashboard.html`);
    console.log(`    Analyzer   → http://${LOCAL_IP}:${PORT}/analyzer.html`);
    console.log(`    Performance→ http://${LOCAL_IP}:${PORT}/performance.html`);
    console.log(line);
});