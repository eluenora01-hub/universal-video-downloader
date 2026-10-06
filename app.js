/* =========================================================
   UNIVERSAL VIDEO DOWNLOADER
   FRONTEND JAVASCRIPT
========================================================= */

const API_BASE = "http://localhost:3000";

const videoUrl = document.getElementById("videoUrl");
const analyzeBtn = document.getElementById("analyzeBtn");

const status = document.getElementById("status");

const progressBox = document.getElementById("progressBox");
const progressPercent = document.getElementById("progressPercent");
const progressBar = document.getElementById("progressBar");

const result = document.getElementById("result");
const videoThumbnail = document.getElementById("videoThumbnail");
const thumbnailPlaceholder =
    document.getElementById("thumbnailPlaceholder");

const videoTitle = document.getElementById("videoTitle");
const videoMeta = document.getElementById("videoMeta");

const qualityList = document.getElementById("qualityList");
const downloadBtn = document.getElementById("downloadBtn");

const mobileMenuBtn = document.getElementById("mobileMenuBtn");
const mobileMenu = document.getElementById("mobileMenu");

let selectedQuality = null;
let currentUrl = "";
let progressTimer = null;


/* =========================================================
   HELPERS
========================================================= */

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


/* =========================================================
   PROGRESS
========================================================= */

function setProgress(percent, message = "") {

    const value = Math.max(
        0,
        Math.min(
            100,
            Number(percent) || 0
        )
    );

    if (progressPercent) {
        progressPercent.textContent =
            `${Math.round(value)}%`;
    }

    if (progressBar) {
        progressBar.style.width =
            `${value}%`;
    }

    if (progressBox && message) {

        const label =
            progressBox.querySelector(
                ".progress-top span:first-child"
            );

        if (label) {
            label.textContent = message;
        }
    }
}


function showProgress(
    message = "Analyzing video..."
) {

    if (progressBox) {
        progressBox.classList.remove(
            "hidden"
        );
    }

    setProgress(
        0,
        message
    );
}


function hideProgress() {

    if (progressBox) {
        progressBox.classList.add(
            "hidden"
        );
    }
}


function stopProgress() {

    if (progressTimer) {

        clearInterval(
            progressTimer
        );

        progressTimer = null;
    }
}


function startProgress() {

    stopProgress();

    let value = 0;

    progressTimer =
        setInterval(
            () => {

                if (value >= 90) {

                    stopProgress();

                    return;
                }

                value += 2;

                let message =
                    "Analyzing video...";

                if (value >= 70) {

                    message =
                        "Detecting available qualities...";

                } else if (value >= 40) {

                    message =
                        "Reading video information...";

                } else if (value >= 15) {

                    message =
                        "Connecting to video source...";
                }

                setProgress(
                    value,
                    message
                );

            },
            150
        );
}


/* =========================================================
   STATUS
========================================================= */

function setStatus(
    message,
    type = ""
) {

    if (!status) {
        return;
    }

    status.textContent =
        message;

    status.className =
        "status";

    if (type) {

        status.classList.add(
            type
        );
    }
}


/* =========================================================
   RESET RESULT
========================================================= */

function resetResult() {

    selectedQuality = null;

    if (result) {

        result.classList.add(
            "hidden"
        );
    }

    if (qualityList) {

        qualityList.innerHTML =
            "";
    }

    if (videoTitle) {

        videoTitle.textContent =
            "";
    }

    if (videoMeta) {

        videoMeta.textContent =
            "";
    }

    if (videoThumbnail) {

        videoThumbnail.removeAttribute(
            "src"
        );

        videoThumbnail.style.display =
            "none";
    }

    if (thumbnailPlaceholder) {

        thumbnailPlaceholder.style.display =
            "";
    }
}


/* =========================================================
   QUALITY TEXT
========================================================= */

function getQualityText(
    quality
) {

    /* Normal quality supplied by backend */
    if (quality.quality) {

        return quality.quality;
    }

    /* Resolution supplied by backend */
    if (
        quality.height &&
        Number(quality.height) > 0
    ) {

        return `${quality.height}p`;
    }

    /* Width/height may sometimes be strings */
    if (
        quality.resolution &&
        quality.resolution !== "unknown"
    ) {

        return quality.resolution;
    }

    /*
       Generic MP4 / unknown resolution format.

       Example:
       formatId = 0
       ext = mp4
       height = unknown
    */

    if (
        String(quality.ext || "").toLowerCase() === "mp4"
    ) {

        return "MP4 — Original";
    }

    /* Generic fallback */
    return "Best";
}


/* =========================================================
   RENDER QUALITIES
========================================================= */

function renderQualities(
    qualities
) {

    if (!qualityList) {
        return;
    }

    qualityList.innerHTML =
        "";

    selectedQuality =
        null;

    if (
        !Array.isArray(qualities) ||
        qualities.length === 0
    ) {

        qualityList.innerHTML =
            "<p>No quality options available.</p>";

        return;
    }


    /*
       Remove completely invalid formats.

       A format must have a formatId.
    */

    const validQualities =
        qualities.filter(
            quality =>
                quality &&
                (
                    quality.formatId !== undefined &&
                    quality.formatId !== null &&
                    String(quality.formatId) !== ""
                )
        );


    if (validQualities.length === 0) {

        qualityList.innerHTML =
            "<p>No downloadable formats available.</p>";

        return;
    }


    validQualities.forEach(
        (quality, index) => {

            const button =
                document.createElement(
                    "button"
                );

            /*
             * IMPORTANT:
             * This must be button type.
             * Otherwise it can submit the page form.
             */

            button.type =
                "button";

            button.className =
                "quality-btn";

            button.textContent =
                getQualityText(
                    quality
                );

            button.dataset.formatId =
                String(
                    quality.formatId
                );

            button.dataset.height =
                quality.height || "";


            /*
             * Mark generic MP4 format.
             */

            if (
                String(quality.ext || "").toLowerCase() === "mp4" &&
                (
                    !quality.height ||
                    String(quality.height).toLowerCase() === "unknown"
                )
            ) {

                button.dataset.genericMp4 =
                    "true";
            }


            if (index === 0) {

                button.classList.add(
                    "selected"
                );

                selectedQuality =
                    quality;
            }


            button.addEventListener(
                "click",
                function (event) {

                    event.preventDefault();

                    event.stopPropagation();


                    qualityList
                        .querySelectorAll(
                            ".quality-btn"
                        )
                        .forEach(
                            item => {

                                item.classList.remove(
                                    "selected"
                                );
                            }
                        );


                    button.classList.add(
                        "selected"
                    );

                    selectedQuality =
                        quality;


                    setStatus(
                        `${getQualityText(quality)} selected. Click Download Video.`,
                        "success"
                    );

                }
            );


            qualityList.appendChild(
                button
            );

        }
    );
}


/* =========================================================
   SHOW RESULT
========================================================= */

function showResult(
    data
) {

    currentUrl =
        data.webpage_url ||
        data.original_url ||
        currentUrl;


    /* TITLE */

    if (videoTitle) {

        videoTitle.textContent =
            data.title ||
            "Video detected";
    }


    /* PLATFORM */

    if (videoMeta) {

        videoMeta.textContent =
            data.platform ||
            "Unknown platform";
    }


    /* THUMBNAIL */

    const thumbnail =
        data.thumbnail ||
        "";


    if (
        thumbnail &&
        videoThumbnail
    ) {

        videoThumbnail.src =
            thumbnail;

        videoThumbnail.style.display =
            "block";


        if (thumbnailPlaceholder) {

            thumbnailPlaceholder.style.display =
                "none";
        }


        videoThumbnail.onerror =
            function () {

                videoThumbnail.style.display =
                    "none";

                if (thumbnailPlaceholder) {

                    thumbnailPlaceholder.style.display =
                        "";
                }
            };

    } else {

        if (videoThumbnail) {

            videoThumbnail.style.display =
                "none";
        }


        if (thumbnailPlaceholder) {

            thumbnailPlaceholder.style.display =
                "";
        }
    }


    /* QUALITY */

    renderQualities(
        data.qualities || []
    );


    /* SHOW RESULT */

    if (result) {

        result.classList.remove(
            "hidden"
        );
    }
}


/* =========================================================
   ANALYZE VIDEO
========================================================= */

async function analyzeVideo(
    event
) {

    /*
     * Prevent browser default form submission.
     * This stops the page from refreshing.
     */

    if (event) {

        event.preventDefault();

        event.stopPropagation();
    }


    const url =
        videoUrl
            ? videoUrl.value.trim()
            : "";


    /* EMPTY URL */

    if (!url) {

        setStatus(
            "Please paste a video URL first.",
            "error"
        );

        if (videoUrl) {

            videoUrl.focus();
        }

        return;
    }


    /* URL VALIDATION */

    try {

        new URL(url);

    } catch {

        setStatus(
            "Please enter a valid video URL.",
            "error"
        );

        return;
    }


    currentUrl =
        url;


    resetResult();


    /* BUTTON */

    if (analyzeBtn) {

        analyzeBtn.disabled =
            true;

        analyzeBtn.dataset.oldText =
            analyzeBtn.textContent;

        analyzeBtn.textContent =
            "Analyzing...";

        analyzeBtn.style.cursor =
            "wait";
    }


    /* PROGRESS */

    showProgress(
        "Starting analysis..."
    );

    setStatus(
        "Starting analysis..."
    );

    startProgress();


    try {

        /*
         * Backend API
         */

        const apiURL =
            `${API_BASE}/api/analyze?url=${encodeURIComponent(url)}`;


        const response =
            await fetch(
                apiURL,
                {
                    method: "GET",
                    cache: "no-store"
                }
            );


        let data;


        try {

            data =
                await response.json();

        } catch {

            throw new Error(
                "Backend returned an invalid response."
            );
        }


        /* ERROR */

        if (
            !response.ok ||
            !data.success
        ) {

            throw new Error(
                data.message ||
                data.error ||
                "Unable to analyze this video."
            );
        }


        /* COMPLETE */

        stopProgress();

        setProgress(
            100,
            "Analysis complete."
        );

        await wait(
            250
        );


        /* SHOW RESULT */

        showResult(
            data
        );


        /*
         * Check whether we actually have
         * downloadable formats.
         */

        const qualities =
            Array.isArray(data.qualities)
                ? data.qualities
                : [];


        if (qualities.length > 0) {

            setStatus(
                "Video detected successfully. Select a quality to download.",
                "success"
            );

        } else {

            setStatus(
                "Video detected, but no downloadable formats were found.",
                "error"
            );
        }


        hideProgress();


    } catch (error) {

        console.error(
            "Analyze error:",
            error
        );

        stopProgress();

        hideProgress();

        setStatus(
            error.message ||
            "Unable to analyze this video.",
            "error"
        );


    } finally {

        if (analyzeBtn) {

            analyzeBtn.disabled =
                false;

            analyzeBtn.textContent =
                analyzeBtn.dataset.oldText ||
                "Analyze";

            analyzeBtn.style.cursor =
                "";
        }
    }
}


/* =========================================================
   DOWNLOAD VIDEO
========================================================= */

function downloadVideo(
    event
) {

    /*
     * Prevent form submission.
     */

    if (event) {

        event.preventDefault();

        event.stopPropagation();
    }


    /* CHECK URL */

    if (!currentUrl) {

        setStatus(
            "Please analyze a video first.",
            "error"
        );

        return;
    }


    /* CHECK QUALITY */

    if (!selectedQuality) {

        setStatus(
            "Please select a video quality first.",
            "error"
        );

        return;
    }


    /* FORMAT ID */

    const formatId =
        selectedQuality.formatId;


    if (
        formatId === undefined ||
        formatId === null ||
        String(formatId) === ""
    ) {

        setStatus(
            "Selected quality is not available.",
            "error"
        );

        return;
    }


    /*
     * CREATE DOWNLOAD URL
     */

    const downloadURL =
        `${API_BASE}/api/download` +
        `?url=${encodeURIComponent(currentUrl)}` +
        `&formatId=${encodeURIComponent(formatId)}`;


    console.log(
        "Download URL:",
        downloadURL
    );


    /* BUTTON */

    if (downloadBtn) {

        downloadBtn.disabled =
            true;

        downloadBtn.dataset.oldText =
            downloadBtn.innerHTML;

        downloadBtn.textContent =
            "Preparing Video...";
    }


    setStatus(
        `Preparing ${getQualityText(selectedQuality)} download...`,
        "info"
    );


    /*
     * OPEN DOWNLOAD
     *
     * Backend sends Content-Disposition:
     * attachment
     *
     * Browser handles actual download.
     */

    const downloadWindow =
        window.open(
            downloadURL,
            "_blank"
        );


    /*
     * POPUP BLOCKED
     */

    if (!downloadWindow) {

        setStatus(
            "The browser blocked the download window. Allow pop-ups for this site and try again.",
            "error"
        );


        if (downloadBtn) {

            downloadBtn.disabled =
                false;

            downloadBtn.innerHTML =
                downloadBtn.dataset.oldText ||
                "Download Video";
        }


        return;
    }


    /*
     * DOWNLOAD STARTED
     */

    setStatus(
        "Download started. Check your browser's Downloads.",
        "success"
    );


    /*
     * Restore button
     */

    setTimeout(
        () => {

            if (downloadBtn) {

                downloadBtn.disabled =
                    false;

                downloadBtn.innerHTML =
                    downloadBtn.dataset.oldText ||
                    "Download Video";
            }

        },
        4000
    );
}


/* =========================================================
   ANALYZE BUTTON
========================================================= */

if (analyzeBtn) {

    analyzeBtn.addEventListener(
        "click",
        analyzeVideo
    );
}


/* =========================================================
   DOWNLOAD BUTTON
========================================================= */

if (downloadBtn) {

    downloadBtn.addEventListener(
        "click",
        downloadVideo
    );
}


/* =========================================================
   ENTER KEY
========================================================= */

if (videoUrl) {

    videoUrl.addEventListener(
        "keydown",
        function (event) {

            if (
                event.key ===
                "Enter"
            ) {

                event.preventDefault();

                event.stopPropagation();

                analyzeVideo(
                    event
                );
            }

        }
    );
}


/* =========================================================
   MOBILE MENU
========================================================= */

if (
    mobileMenuBtn &&
    mobileMenu
) {

    mobileMenuBtn.addEventListener(
        "click",
        function (event) {

            event.preventDefault();

            mobileMenu.classList.toggle(
                "active"
            );
        }
    );


    mobileMenu
        .querySelectorAll("a")
        .forEach(
            link => {

                link.addEventListener(
                    "click",
                    function () {

                        mobileMenu.classList.remove(
                            "active"
                        );
                    }
                );

            }
        );
}


/* =========================================================
   INITIAL STATE
========================================================= */

stopProgress();

hideProgress();


if (result) {

    result.classList.add(
        "hidden"
    );
}


console.log(
    "Universal Video Downloader frontend loaded successfully."
);