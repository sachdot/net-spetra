/**
 * NETSPECTRA — Performance Intelligence Engine
 * Handles speed testing, traffic charting, and topology animation
 * for the Performance Metrics page.
 */

// ============================================================
// CONFIGURATION
// ============================================================
const CONFIG = {
    CHART_POINTS: 25,
    REFRESH_RATE: 2000,
    ACCENT_PRIMARY: "#06b6d4",
    ACCENT_SUCCESS: "#10b981",
    CANVAS_SUBTLE: "rgba(148, 163, 184, 0.07)",
    PARTICLE_COLOR: "rgba(6, 182, 212, 0.6)"
};

// State for speed test values
let networkState = {
    download: 0,
    upload: 0
};

// ============================================================
// SPEED TEST (Cloudflare edge download)
// ============================================================
async function testSpeed() {
    const dnElem = document.getElementById("download");
    const upElem = document.getElementById("upload");
    const btn = document.getElementById("speed-test-btn");

    // Guard against missing elements
    if (!dnElem || !upElem) {
        console.warn("Speed test DOM elements not found");
        return;
    }

    try {
        btn.disabled = true;
        btn.textContent = "Testing…";
        dnElem.classList.add("pulse-animate");
        dnElem.textContent = "…";

        const startTime = performance.now();
        const response = await fetch("https://speed.cloudflare.com/__down?bytes=5000000");
        const blob = await response.blob();
        const duration = (performance.now() - startTime) / 1000;

        // Calculate Mbps from bytes transferred
        const mbps = ((blob.size * 8) / (duration * 1024 * 1024)).toFixed(2);

        networkState.download = parseFloat(mbps);
        networkState.upload = parseFloat((mbps * 0.42).toFixed(2));

        dnElem.textContent = networkState.download + " Mbps";
        upElem.textContent = networkState.upload + " Mbps";

    } catch (err) {
        dnElem.textContent = "OFFLINE";
        upElem.textContent = "--";
        console.error("Speed test failed:", err);
    } finally {
        dnElem.classList.remove("pulse-animate");
        btn.disabled = false;
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Initiate Diagnostics`;
    }
}

// ============================================================
// TRAFFIC CHART (Chart.js line graph)
// ============================================================
Chart.defaults.color = "#64748b";
Chart.defaults.font.family = "'Inter', sans-serif";

const ctx = document.getElementById("trafficChart");
let trafficChart = null;

if (ctx) {
    const tCtx = ctx.getContext("2d");
    trafficChart = new Chart(tCtx, {
        type: "line",
        data: {
            labels: [],
            datasets: [{
                label: "Downlink",
                borderColor: CONFIG.ACCENT_PRIMARY,
                borderWidth: 2,
                pointRadius: 0,
                fill: true,
                backgroundColor: function (context) {
                    const grad = tCtx.createLinearGradient(0, 0, 0, 280);
                    grad.addColorStop(0, "rgba(6, 182, 212, 0.12)");
                    grad.addColorStop(1, "rgba(6, 182, 212, 0)");
                    return grad;
                },
                data: [],
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { display: false },
                y: {
                    grid: { color: "rgba(255,255,255,0.03)" },
                    ticks: {
                        maxTicksLimit: 5,
                        font: { family: "'Roboto Mono'", size: 10 },
                        color: "rgba(255,255,255,0.2)"
                    }
                }
            }
        }
    });

    // Update chart with telemetry data every REFRESH_RATE ms
    setInterval(() => {
        const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

        // Use real speed test result if available, else simulate
        const val = networkState.download > 0
            ? (networkState.download + (Math.random() * 4 - 2)).toFixed(2)
            : (Math.random() * 35 + 20).toFixed(2);

        trafficChart.data.labels.push(now);
        trafficChart.data.datasets[0].data.push(parseFloat(val));

        if (trafficChart.data.labels.length > CONFIG.CHART_POINTS) {
            trafficChart.data.labels.shift();
            trafficChart.data.datasets[0].data.shift();
        }

        trafficChart.update("none");
    }, CONFIG.REFRESH_RATE);
}

// ============================================================
// TOPOLOGY ENGINE (Canvas animation with flowing particles)
// ============================================================
const mapCanvas = document.getElementById("networkMap");

if (mapCanvas) {
    const mctx = mapCanvas.getContext("2d");

    const nodes = [
        { x: 0.1,  y: 0.5,  label: "Edge",       color: "#64748b" },
        { x: 0.3,  y: 0.3,  label: "ISP",        color: "#6366f1" },
        { x: 0.3,  y: 0.7,  label: "CDN",        color: "#38bdf8" },
        { x: 0.6,  y: 0.5,  label: "Core",       color: "#06b6d4" },
        { x: 0.9,  y: 0.5,  label: "DC-Chennai", color: "#10b981" }
    ];

    let particles = [];

    /** Spawn a particle that flows from one node to the next */
    function spawnParticle() {
        const srcIdx = Math.floor(Math.random() * (nodes.length - 1));
        particles.push({
            start: nodes[srcIdx],
            end: nodes[srcIdx + 1],
            progress: 0,
            speed: 0.005 + Math.random() * 0.01
        });
    }

    /** Main render loop for the topology canvas */
    function drawTopology() {
        const w = mapCanvas.width = mapCanvas.offsetWidth;
        const h = mapCanvas.height = mapCanvas.offsetHeight;
        mctx.clearRect(0, 0, w, h);

        // Draw static connection lines between nodes
        mctx.strokeStyle = CONFIG.CANVAS_SUBTLE;
        mctx.lineWidth = 1;
        nodes.forEach((node, i) => {
            nodes.slice(i + 1).forEach(target => {
                mctx.beginPath();
                mctx.moveTo(node.x * w, node.y * h);
                mctx.lineTo(target.x * w, target.y * h);
                mctx.stroke();
            });
        });

        // Draw & update flowing particles
        particles.forEach((p, idx) => {
            p.progress += p.speed;
            if (p.progress >= 1) {
                particles.splice(idx, 1);
                return;
            }
            const curX = p.start.x * w + (p.end.x - p.start.x) * w * p.progress;
            const curY = p.start.y * h + (p.end.y - p.start.y) * h * p.progress;

            mctx.fillStyle = CONFIG.PARTICLE_COLOR;
            mctx.shadowBlur = 8;
            mctx.shadowColor = CONFIG.ACCENT_PRIMARY;
            mctx.beginPath();
            mctx.arc(curX, curY, 2, 0, Math.PI * 2);
            mctx.fill();
            mctx.shadowBlur = 0;
        });

        // Draw node circles with pulsing animation
        nodes.forEach(n => {
            const x = n.x * w;
            const y = n.y * h;
            const pulse = Math.sin(Date.now() / 400) * 3;

            mctx.fillStyle = n.color;
            mctx.beginPath();
            mctx.arc(x, y, 5 + pulse, 0, Math.PI * 2);
            mctx.fill();

            // Node label
            mctx.fillStyle = "#8b949e";
            mctx.font = "bold 10px Inter, sans-serif";
            mctx.textAlign = "center";
            mctx.fillText(n.label.toUpperCase(), x, y + 22);
        });

        // Randomly spawn new particles
        if (Math.random() < 0.08) spawnParticle();
        requestAnimationFrame(drawTopology);
    }

    drawTopology();
}