/**
 * NETSPECTRA — Shared Application Utilities v2
 * Auth guard, mobile nav, sidebar, user display, logout.
 */
(function () {
    "use strict";

    // ============================================================
    // AUTH GUARD
    // Every page using app.js (all except login.html) must have
    // a valid session. If not authenticated → redirect to login.
    // ============================================================
    const currentPage = window.location.pathname.split("/").pop();
    if (currentPage !== "login.html" && sessionStorage.getItem("ns_auth") !== "1") {
        window.location.replace("login.html");
        return; // Stop further execution
    }

    // ============================================================
    // USER BADGE
    // If a .header-user-name element exists, populate it.
    // ============================================================
    const storedUser = sessionStorage.getItem("ns_user") || localStorage.getItem("ns_remember_user") || "Admin";
    const userNameElem = document.querySelector(".header-user-name");
    if (userNameElem) userNameElem.textContent = storedUser;

    // Populate avatar initials
    const initialsElem = document.querySelector(".avatar-initials");
    if (initialsElem) {
        const parts = storedUser.split(/[\s@.]+/);
        initialsElem.textContent = (parts[0]?.[0] || "A").toUpperCase() + (parts[1]?.[0] || "").toUpperCase();
    }

    // ============================================================
    // LOGOUT
    // Any element with id="logout-btn" triggers sign-out.
    // ============================================================
    function logout() {
        sessionStorage.removeItem("ns_auth");
        sessionStorage.removeItem("ns_user");
        window.location.replace("login.html");
    }

    const logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn) logoutBtn.addEventListener("click", (e) => { e.preventDefault(); logout(); });

    // Also handle sidebar logout link
    const sidebarLogout = document.querySelector(".logout-link");
    if (sidebarLogout) sidebarLogout.addEventListener("click", (e) => { e.preventDefault(); logout(); });

    // ============================================================
    // MOBILE SIDEBAR TOGGLE
    // ============================================================
    const sidebar   = document.querySelector(".sidebar");
    const toggleBtn = document.querySelector(".mobile-nav-toggle");
    const overlay   = document.querySelector(".sidebar-overlay");

    function openSidebar() {
        sidebar.classList.add("open");
        if (overlay) overlay.classList.add("active");
        document.body.style.overflow = "hidden"; // prevent scroll behind drawer
    }

    function closeSidebar() {
        sidebar.classList.remove("open");
        if (overlay) overlay.classList.remove("active");
        document.body.style.overflow = "";
    }

    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener("click", () => {
            sidebar.classList.contains("open") ? closeSidebar() : openSidebar();
        });
    }

    if (overlay) overlay.addEventListener("click", closeSidebar);

    // Close on nav link click (mobile)
    document.querySelectorAll(".sidebar-nav a:not(.logout-link)").forEach((link) => {
        link.addEventListener("click", () => {
            if (window.innerWidth <= 768) closeSidebar();
        });
    });

    // Close on resize to desktop
    let resizeTimer;
    window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (window.innerWidth > 768) closeSidebar();
        }, 100);
    });

    // Close with Escape key
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && sidebar && sidebar.classList.contains("open")) {
            closeSidebar();
        }
    });

    // ============================================================
    // SWIPE TO OPEN/CLOSE SIDEBAR (touch gesture)
    // ============================================================
    let touchStartX = 0;
    let touchStartY = 0;

    document.addEventListener("touchstart", (e) => {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    document.addEventListener("touchend", (e) => {
        const dx = e.changedTouches[0].screenX - touchStartX;
        const dy = Math.abs(e.changedTouches[0].screenY - touchStartY);

        // Only register horizontal swipes (not vertical scrolls)
        if (dy > 40) return;

        if (dx > 60 && touchStartX < 40) {
            // Swipe right from left edge → open sidebar
            openSidebar();
        } else if (dx < -60 && sidebar && sidebar.classList.contains("open")) {
            // Swipe left → close sidebar
            closeSidebar();
        }
    }, { passive: true });

})();
