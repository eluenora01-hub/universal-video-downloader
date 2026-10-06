/* Universal Video Downloader - Frontend */

const API_BASE = "https://universal-video-downloader-4di9.onrender.com";

const videoUrl = document.getElementById("videoUrl");
const analyzeBtn = document.getElementById("analyzeBtn");
const status = document.getElementById("status");
const progressBox = document.getElementById("progressBox");
const progressPercent = document.getElementById("progressPercent");
const progressBar = document.getElementById("progressBar");
const result = document.getElementById("result");
const videoThumbnail = document.getElementById("videoThumbnail");
const thumbnailPlaceholder = document.getElementById("thumbnailPlaceholder");
const videoTitle = document.getElementById("videoTitle");
const videoMeta = document.getElementById("videoMeta");
const qualityList = document.getElementById("qualityList");
const downloadBtn = document.getElementById("downloadBtn");
const mobileMenuBtn = document.getElementById("mobileMenuBtn");
const mobileMenu = document.getElementById("mobileMenu");

let selectedQuality = null;
let currentUrl = "";

function setProgress(value, message = "") {
    value = Math.max(0, Math.min(100, Number(value) || 0));

    if (progressPercent) {
        progressPercent.textContent = `${Math.round(value)}%`;
    }

    if (progressBar) {
        progressBar.style.width = `${value}%`;
    }

    if (progressBox && message) {
        const label = progressBox.querySelector(
            ".progress-top span:first-child"
        );

        if (label) {
            label.textContent = message;
        }
    }
}

function showProgress(message) {
    if (progressBox) {
        progressBox.classList.remove("hidden");
    }

    setProgress(0, message);
}

function hideProgress() {
    if (progressBox) {
        progressBox.classList.add("hidden");
    }
}

function setStatus(message, type = "") {
    if (!status) return;

    status.textContent = message;
    status.className = "status";

    if (type) {
        status.classList.add(type);
    }
}

function resetResult() {
    selectedQuality = null;

    if (result) {
        result.classList.add("hidden");
    }

    if (qualityList) {
        qualityList.innerHTML = "";
    }

    if (videoTitle) {
        videoTitle.textContent = "";
    }

    if (videoMeta) {
        videoMeta.textContent = "";
    }

    if (videoThumbnail) {
        videoThumbnail.removeAttribute("src");
        videoThumbnail.style.display = "none";
    }

    if (thumbnailPlaceholder) {
        thumbnailPlaceholder.style.display = "";
    }
}

function qualityText(q) {
    return q?.quality || (q?.height ? `${q.height}p` : "Best");
}

function renderQualities(qualities) {
    if (!qualityList) return;

    qualityList.innerHTML = "";
    selectedQuality = null;

    if (!Array.isArray(qualities) || !qualities.length) {
        qualityList.innerHTML = "<p>No quality options available.</p>";
        return;
    }

    qualities.forEach((quality, index) => {
        const button = document.createElement("button");

        button.type = "button";
        button.className = "quality-btn";
        button.textContent = qualityText(quality);

        if (index === 0) {
            button.classList.add("selected");
            selectedQuality = quality;
        }

        button.addEventListener("click", function (event) {
            event.preventDefault();

            qualityList
                .querySelectorAll(".quality-btn")
                .forEach(b => b.classList.remove("selected"));

            button.classList.add("selected");
            selectedQuality = quality;

            setStatus(
                `${qualityText(quality)} selected. Click Download Video.`,
                "success"
            );
        });

        qualityList.appendChild(button);
    });
}

function showResult(data) {
    currentUrl =
        data.webpage_url ||
        data.original_url ||
        currentUrl;

    if (videoTitle) {
        videoTitle.textContent =
            data.title || "Video detected";
    }

    if (videoMeta) {
        videoMeta.textContent =
            data.platform || "Unknown platform";
    }

    if (data.thumbnail && videoThumbnail) {
        videoThumbnail.src = data.thumbnail;
        videoThumbnail.style.display = "block";

        if (thumbnailPlaceholder) {
            thumbnailPlaceholder.style.display = "none";
        }

        videoThumbnail.onerror = () => {
            videoThumbnail.style.display = "none";

            if (thumbnailPlaceholder) {
                thumbnailPlaceholder.style.display = "";
            }
        };
    }

    renderQualities(data.qualities || []);

    if (result) {
        result.classList.remove("hidden");
    }
}

async function analyzeVideo(event) {
    // Critical: stop normal form submission.
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    const url = videoUrl?.value.trim() || "";

    if (!url) {
        setStatus("Please paste a video URL first.", "error");
        videoUrl?.focus();
        return;
    }

    try {
        new URL(url);
    } catch {
        setStatus("Please enter a valid video URL.", "error");
        return;
    }

    currentUrl = url;
    resetResult();

    if (analyzeBtn) {
        analyzeBtn.disabled = true;
        analyzeBtn.dataset.oldText = analyzeBtn.textContent;
        analyzeBtn.textContent = "Analyzing...";
    }

    showProgress("Connecting to video source...");
    setStatus("Analyzing video...");

    try {
        const response = await fetch(
            `${API_BASE}/api/analyze?url=${encodeURIComponent(url)}`,
            {
                method: "GET",
                cache: "no-store"
            }
        );

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(
                data.message ||
                data.error ||
                "Unable to analyze this video."
            );
        }

        setProgress(100, "Analysis complete.");
        showResult(data);

        setStatus(
            "Video detected successfully. Select a quality to download.",
            "success"
        );

        hideProgress();

    } catch (error) {
        console.error("Analyze error:", error);

        hideProgress();

        setStatus(
            error.message ||
            "Unable to analyze this video.",
            "error"
        );

    } finally {
        if (analyzeBtn) {
            analyzeBtn.disabled = false;

            analyzeBtn.textContent =
                analyzeBtn.dataset.oldText || "Analyze";
        }
    }
}

function downloadVideo(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    if (!currentUrl) {
        setStatus(
            "Please analyze a video first.",
            "error"
        );
        return;
    }

    if (!selectedQuality?.formatId) {
        setStatus(
            "Please select a video quality first.",
            "error"
        );
        return;
    }

    const downloadURL =
        `${API_BASE}/api/download` +
        `?url=${encodeURIComponent(currentUrl)}` +
        `&formatId=${encodeURIComponent(selectedQuality.formatId)}`;

    if (downloadBtn) {
        downloadBtn.disabled = true;
        downloadBtn.dataset.oldText = downloadBtn.innerHTML;
        downloadBtn.textContent = "Preparing Video...";
    }

    setStatus(
        `Preparing ${qualityText(selectedQuality)} download...`,
        "info"
    );

    const win = window.open(
        downloadURL,
        "_blank"
    );

    if (!win) {
        setStatus(
            "The browser blocked the download window. Allow pop-ups for this site and try again.",
            "error"
        );

        if (downloadBtn) {
            downloadBtn.disabled = false;

            downloadBtn.innerHTML =
                downloadBtn.dataset.oldText ||
                "Download Video";
        }

        return;
    }

    setStatus(
        "Download started. Check your browser's Downloads.",
        "success"
    );

    setTimeout(() => {
        if (downloadBtn) {
            downloadBtn.disabled = false;

            downloadBtn.innerHTML =
                downloadBtn.dataset.oldText ||
                "Download Video";
        }
    }, 4000);
}

if (analyzeBtn) {
    analyzeBtn.addEventListener(
        "click",
        analyzeVideo
    );
}

if (downloadBtn) {
    downloadBtn.addEventListener(
        "click",
        downloadVideo
    );
}

if (videoUrl) {
    videoUrl.addEventListener(
        "keydown",
        event => {
            if (event.key === "Enter") {
                event.preventDefault();
                analyzeVideo(event);
            }
        }
    );
}

if (mobileMenuBtn && mobileMenu) {
    mobileMenuBtn.addEventListener(
        "click",
        event => {
            event.preventDefault();
            mobileMenu.classList.toggle("active");
        }
    );
}

hideProgress();

if (result) {
    result.classList.add("hidden");
}

console.log(
    "Universal Video Downloader frontend loaded successfully."
);