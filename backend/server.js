const express = require("express");
const cors = require("cors");
const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();

/* =========================================================
   SERVER
========================================================= */

const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

/* =========================================================
   PATHS
========================================================= */

const isWindows = process.platform === "win32";

const ytDlpPath = isWindows
    ? path.join(__dirname, "yt-dlp.exe")
    : "/usr/local/bin/yt-dlp";

const downloadDir = path.join(
    __dirname,
    "downloads"
);

if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, {
        recursive: true
    });
}

/* =========================================================
   BASIC HELPERS
========================================================= */

function isValidHttpUrl(value) {
    try {
        const parsed = new URL(value);

        return (
            parsed.protocol === "http:" ||
            parsed.protocol === "https:"
        );
    } catch {
        return false;
    }
}

function safeString(value, fallback = "") {
    if (value === null || value === undefined) {
        return fallback;
    }

    return String(value);
}

function sanitizeFilename(name) {
    return safeString(name, "video")
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180) || "video";
}

function formatDuration(seconds) {
    if (
        seconds === null ||
        seconds === undefined ||
        !Number.isFinite(Number(seconds))
    ) {
        return null;
    }

    const total = Math.max(
        0,
        Math.floor(Number(seconds))
    );

    const hours = Math.floor(total / 3600);
    const minutes = Math.floor(
        (total % 3600) / 60
    );
    const secs = total % 60;

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }

    return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function detectPlatform(url) {
    try {
        const host = new URL(url)
            .hostname
            .toLowerCase()
            .replace(/^www\./, "");

        if (
            host === "youtube.com" ||
            host === "m.youtube.com" ||
            host === "youtu.be"
        ) {
            return "YouTube";
        }

        if (
            host === "facebook.com" ||
            host === "m.facebook.com" ||
            host === "fb.watch"
        ) {
            return "Facebook";
        }

        if (
            host === "instagram.com" ||
            host === "instagr.am"
        ) {
            return "Instagram";
        }

        if (
            host === "xhamster.com" ||
            host.endsWith(".xhamster.com")
        ) {
            return "XHamster";
        }

        if (
            host === "xnxx.com" ||
            host.endsWith(".xnxx.com")
        ) {
            return "XNXX";
        }

        if (
            host === "xvideos.com" ||
            host.endsWith(".xvideos.com")
        ) {
            return "XVideos";
        }

        if (
            host === "tiktok.com" ||
            host.endsWith(".tiktok.com")
        ) {
            return "TikTok";
        }

        if (
            host === "twitter.com" ||
            host === "x.com" ||
            host.endsWith(".twitter.com") ||
            host.endsWith(".x.com")
        ) {
            return "X / Twitter";
        }

        return host;
    } catch {
        return "Unknown";
    }
}

/* =========================================================
   YT-DLP COMMAND RUNNER
========================================================= */

function runYtDlp(args, options = {}) {
    return new Promise((resolve, reject) => {

        const timeout =
            Number(options.timeout) || 45000;

        const maxBuffer =
            Number(options.maxBuffer) ||
            50 * 1024 * 1024;

        const startedAt = Date.now();

        console.log(
            `[yt-dlp] START ${args.join(" ")}`
        );

        execFile(
            ytDlpPath,
            args,
            {
                windowsHide: true,
                maxBuffer,
                timeout
            },
            (error, stdout, stderr) => {

                const elapsed =
                    Date.now() - startedAt;

                const cleanStdout =
                    safeString(stdout);

                const cleanStderr =
                    safeString(stderr);

                if (error) {

                    const timedOut =
                        error.killed ||
                        error.signal === "SIGTERM" ||
                        error.code === "ETIMEDOUT";

                    console.error(
                        `[yt-dlp] FAIL after ${elapsed}ms`
                    );

                    if (cleanStderr) {
                        console.error(
                            cleanStderr.slice(-6000)
                        );
                    }

                    const finalMessage =
                        timedOut
                            ? "The source took too long to respond."
                            : cleanStderr.trim() ||
                              error.message ||
                              "yt-dlp failed.";

                    const finalError =
                        new Error(finalMessage);

                    finalError.code =
                        timedOut
                            ? "TIMEOUT"
                            : error.code;

                    finalError.stderr =
                        cleanStderr;

                    finalError.stdout =
                        cleanStdout;

                    return reject(finalError);
                }

                console.log(
                    `[yt-dlp] SUCCESS in ${elapsed}ms`
                );

                resolve({
                    stdout: cleanStdout,
                    stderr: cleanStderr
                });
            }
        );
    });
}

/* =========================================================
   STARTUP CHECK
========================================================= */

async function checkYtDlp() {

    try {

        const result =
            await runYtDlp(
                ["--version"],
                {
                    timeout: 10000
                }
            );

        console.log(
            `yt-dlp version: ${result.stdout.trim()}`
        );

    } catch (error) {

        console.error(
            "yt-dlp startup check failed:",
            error.message
        );
    }

    console.log(
        `yt-dlp path: ${ytDlpPath}`
    );

    console.log(
        `Download directory: ${downloadDir}`
    );
}

/* =========================================================
   EXTRACT VIDEO INFORMATION
========================================================= */

async function extractNormalInfo(url) {

    const args = [
        "--dump-single-json",
        "--skip-download",
        "--no-warnings",
        "--no-playlist",
        "--no-check-certificates",
        "--js-runtimes",
        "deno",
        "--socket-timeout",
        "15",
        "--retries",
        "1",
        "--fragment-retries",
        "1",
        url
    ];

    const result =
        await runYtDlp(
            args,
            {
                timeout: 35000
            }
        );

    if (!result.stdout.trim()) {
        throw new Error(
            "yt-dlp returned no video information."
        );
    }

    try {

        return JSON.parse(
            result.stdout
        );

    } catch (error) {

        console.error(
            "JSON parse error:",
            error.message
        );

        throw new Error(
            "Could not read video information from yt-dlp."
        );
    }
}

/* =========================================================
   GENERIC EXTRACTOR
========================================================= */

async function extractGenericInfo(url) {

    const args = [
        "--dump-single-json",
        "--skip-download",
        "--no-warnings",
        "--no-playlist",
        "--no-check-certificates",
        "--force-generic-extractor",
        "--socket-timeout",
        "10",
        "--retries",
        "1",
        "--fragment-retries",
        "1",
        url
    ];

    const result =
        await runYtDlp(
            args,
            {
                timeout: 18000
            }
        );

    if (!result.stdout.trim()) {
        throw new Error(
            "Generic extractor returned no information."
        );
    }

    try {

        return JSON.parse(
            result.stdout
        );

    } catch {

        throw new Error(
            "Could not read generic extractor data."
        );
    }
}

/* =========================================================
   SMART EXTRACTION
========================================================= */

async function extractInfo(url) {

    try {

        return await extractNormalInfo(url);

    } catch (normalError) {

        const message =
            safeString(
                normalError.message
            );

        console.error(
            "Normal extraction failed:",
            message
        );

        /*
         * Only try generic extraction when the normal
         * extractor clearly says the URL is unsupported.
         *
         * This avoids making every failed extraction
         * unnecessarily slow.
         */

        const shouldTryGeneric =
            /unsupported url/i.test(message) ||
            /no suitable extractor/i.test(message) ||
            /generic/i.test(message);

        if (!shouldTryGeneric) {
            throw normalError;
        }

        try {

            console.log(
                "Trying generic extractor..."
            );

            return await extractGenericInfo(
                url
            );

        } catch (genericError) {

            console.error(
                "Generic extraction failed:",
                genericError.message
            );

            throw normalError;
        }
    }
}

/* =========================================================
   FORMAT HELPERS
========================================================= */

function hasVideo(format) {

    return !!(
        format &&
        format.vcodec &&
        format.vcodec !== "none"
    );
}

function hasAudio(format) {

    return !!(
        format &&
        format.acodec &&
        format.acodec !== "none"
    );
}

function getFormatScore(format) {

    let score = 0;

    if (hasVideo(format)) {
        score += 1000;
    }

    if (hasAudio(format)) {
        score += 500;
    }

    if (format.ext === "mp4") {
        score += 300;
    }

    if (format.ext === "webm") {
        score += 100;
    }

    const height =
        Number(format.height);

    if (
        Number.isFinite(height) &&
        height > 0
    ) {
        score += Math.min(
            height,
            4320
        );
    }

    const tbr =
        Number(format.tbr);

    if (
        Number.isFinite(tbr) &&
        tbr > 0
    ) {
        score += Math.min(
            tbr / 10,
            500
        );
    }

    if (
        format.fps &&
        Number.isFinite(
            Number(format.fps)
        )
    ) {
        score +=
            Math.min(
                Number(format.fps),
                120
            );
    }

    return score;
}

/* =========================================================
   BUILD QUALITY LIST
========================================================= */

function buildQualities(info) {

    const formats =
        Array.isArray(info.formats)
            ? info.formats
            : [];

    const qualityMap =
        new Map();

    /*
     * First collect formats that have a known
     * video height.
     */

    for (const format of formats) {

        if (
            !format ||
            format.format_id === undefined ||
            format.format_id === null
        ) {
            continue;
        }

        if (!hasVideo(format)) {
            continue;
        }

        const height =
            Number(format.height);

        if (
            !Number.isFinite(height) ||
            height < 1
        ) {
            continue;
        }

        const quality =
            `${height}p`;

        const existing =
            qualityMap.get(
                quality
            );

        if (
            !existing ||
            getFormatScore(format) >
            getFormatScore(existing._format)
        ) {

            qualityMap.set(
                quality,
                {
                    quality,
                    height,
                    formatId:
                        String(
                            format.format_id
                        ),
                    ext:
                        format.ext ||
                        "mp4",
                    hasAudio:
                        hasAudio(format),
                    fps:
                        format.fps ||
                        null,
                    filesize:
                        format.filesize ||
                        format.filesize_approx ||
                        null,
                    formatNote:
                        format.format_note ||
                        null,
                    _format:
                        format
                }
            );
        }
    }

    /*
     * Some websites return a direct MP4 / generic format
     * without a height. Keep that as an available option.
     */

    for (const format of formats) {

        if (
            !format ||
            format.format_id === undefined ||
            format.format_id === null
        ) {
            continue;
        }

        if (!format.url) {
            continue;
        }

        const height =
            Number(format.height);

        if (
            Number.isFinite(height) &&
            height > 0
        ) {
            continue;
        }

        const ext =
            safeString(
                format.ext
            ).toLowerCase();

        if (
            ext !== "mp4" &&
            ext !== "webm" &&
            ext !== "mov" &&
            ext !== "m4v"
        ) {
            continue;
        }

        const key =
            `original-${String(
                format.format_id
            )}`;

        if (!qualityMap.has(key)) {

            qualityMap.set(
                key,
                {
                    quality:
                        ext === "mp4"
                            ? "MP4 — Original"
                            : `${ext.toUpperCase()} — Original`,
                    height: 0,
                    formatId:
                        String(
                            format.format_id
                        ),
                    ext:
                        format.ext ||
                        "mp4",
                    hasAudio:
                        hasAudio(format),
                    fps:
                        format.fps ||
                        null,
                    filesize:
                        format.filesize ||
                        format.filesize_approx ||
                        null,
                    formatNote:
                        format.format_note ||
                        "Original",
                    _format:
                        format
                }
            );
        }
    }

    return Array.from(
        qualityMap.values()
    )
        .sort(
            (a, b) =>
                a.height - b.height
        )
        .map(
            ({
                _format,
                ...quality
            }) =>
                quality
        );
}

/* =========================================================
   HEALTH
========================================================= */

app.get(
    "/api/health",
    async (req, res) => {

        res.json({
            success: true,
            message:
                "Universal Video Downloader backend is running.",
            platform:
                process.platform,
            ytDlpPath,
            downloads:
                downloadDir
        });
    }
);

/* =========================================================
   ANALYZE API
========================================================= */

app.get(
    "/api/analyze",
    async (req, res) => {

        const url =
            typeof req.query.url === "string"
                ? req.query.url.trim()
                : "";

        if (!url) {

            return res.status(400).json({
                success: false,
                message:
                    "Video URL is required."
            });
        }

        if (!isValidHttpUrl(url)) {

            return res.status(400).json({
                success: false,
                message:
                    "Please enter a valid HTTP or HTTPS URL."
            });
        }

        console.log("");
        console.log(
            "========================================"
        );
        console.log(
            "ANALYZE:",
            url
        );

        const platform =
            detectPlatform(url);

        console.log(
            "Platform:",
            platform
        );

        try {

            const info =
                await extractInfo(url);

            const qualities =
                buildQualities(info);

            const title =
                info.title ||
                info.fulltitle ||
                "Untitled video";

            let thumbnail =
                info.thumbnail ||
                null;

            if (
                !thumbnail &&
                Array.isArray(
                    info.thumbnails
                ) &&
                info.thumbnails.length
            ) {

                thumbnail =
                    info.thumbnails[
                        info.thumbnails.length - 1
                    ]?.url ||
                    null;
            }

            const author =
                info.uploader ||
                info.channel ||
                info.creator ||
                null;

            const duration =
                Number.isFinite(
                    Number(info.duration)
                )
                    ? Number(info.duration)
                    : null;

            const extractor =
                info.extractor_key ||
                info.extractor ||
                platform;

            console.log(
                "Extractor:",
                extractor
            );

            console.log(
                "Qualities:",
                qualities.length
            );

            return res.json({
                success: true,
                url,
                platform:
                    extractor,
                title,
                thumbnail,
                duration,
                durationText:
                    formatDuration(
                        duration
                    ),
                author,
                qualities
            });

        } catch (error) {

            console.error(
                "ANALYZE ERROR:",
                error.message
            );

            let message =
                error.message ||
                "Could not analyze this video.";

            /*
             * Keep YouTube bot / access messages truthful.
             * Do not pretend the video is available.
             */

            if (
                /sign in to confirm/i.test(message) ||
                /not a bot/i.test(message) ||
                /captcha/i.test(message)
            ) {
                message =
                    "This source is currently blocking automated access from the server.";
            }

            if (
                error.code === "TIMEOUT"
            ) {
                message =
                    "The source took too long to respond. Please try again.";
            }

            return res.status(502).json({
                success: false,
                platform,
                message
            });
        }
    }
);

/* =========================================================
   DOWNLOAD HELPERS
========================================================= */

function isSafeFormatId(formatId) {

    /*
     * yt-dlp format IDs are extractor-specific.
     * They can contain letters, numbers and common
     * selector-safe characters.
     */

    return /^[A-Za-z0-9._:+-]+$/.test(
        String(formatId)
    );
}

function findDownloadedFile(jobDir) {

    if (!fs.existsSync(jobDir)) {
        return null;
    }

    const files =
        fs.readdirSync(
            jobDir,
            {
                withFileTypes: true
            }
        );

    const candidates = [];

    for (const file of files) {

        if (!file.isFile()) {
            continue;
        }

        const filePath =
            path.join(
                jobDir,
                file.name
            );

        try {

            const stat =
                fs.statSync(
                    filePath
                );

            if (
                stat.isFile() &&
                stat.size > 0
            ) {

                candidates.push({
                    name:
                        file.name,
                    path:
                        filePath,
                    size:
                        stat.size
                });
            }

        } catch {
            // Ignore files that disappear during cleanup.
        }
    }

    if (!candidates.length) {
        return null;
    }

    /*
     * Prefer actual video files.
     */

    const videoExtensions = [
        ".mp4",
        ".m4v",
        ".webm",
        ".mov",
        ".mkv",
        ".avi",
        ".flv"
    ];

    candidates.sort(
        (a, b) => {

            const aVideo =
                videoExtensions.includes(
                    path.extname(
                        a.name
                    ).toLowerCase()
                );

            const bVideo =
                videoExtensions.includes(
                    path.extname(
                        b.name
                    ).toLowerCase()
                );

            if (aVideo !== bVideo) {
                return bVideo - aVideo;
            }

            return b.size - a.size;
        }
    );

    return candidates[0];
}

/* =========================================================
   DOWNLOAD API
========================================================= */

app.get(
    "/api/download",
    async (req, res) => {

        const url =
            typeof req.query.url === "string"
                ? req.query.url.trim()
                : "";

        const formatId =
            typeof req.query.formatId === "string"
                ? req.query.formatId.trim()
                : "";

        if (!url) {

            return res.status(400).json({
                success: false,
                message:
                    "Video URL is required."
            });
        }

        if (!isValidHttpUrl(url)) {

            return res.status(400).json({
                success: false,
                message:
                    "Invalid video URL."
            });
        }

        if (!formatId) {

            return res.status(400).json({
                success: false,
                message:
                    "Video quality is required."
            });
        }

        if (!isSafeFormatId(formatId)) {

            return res.status(400).json({
                success: false,
                message:
                    "Invalid format ID."
            });
        }

        /*
         * Create isolated directory for every download.
         */

        const jobId =
            `${Date.now()}-${Math.random()
                .toString(36)
                .slice(2, 10)}`;

        const jobDir =
            path.join(
                downloadDir,
                jobId
            );

        try {

            fs.mkdirSync(
                jobDir,
                {
                    recursive: true
                }
            );

            const outputTemplate =
                path.join(
                    jobDir,
                    "%(title).150s.%(ext)s"
                );

            /*
             * First attempt:
             * selected video + best audio.
             *
             * Second attempt:
             * selected format itself.
             *
             * This supports both normal extractor formats
             * and direct/generic formats.
             */

            const primarySelector =
                `${formatId}+bestaudio/${formatId}/best`;

            const primaryArgs = [
                "--no-warnings",
                "--no-playlist",
                "--no-check-certificates",
                "--js-runtimes",
                "deno",
                "--socket-timeout",
                "20",
                "--retries",
                "1",
                "--fragment-retries",
                "1",
                "--no-part",
                "-f",
                primarySelector,
                "--merge-output-format",
                "mp4",
                "--restrict-filenames",
                "-o",
                outputTemplate,
                url
            ];

            console.log("");
            console.log(
                "========================================"
            );
            console.log(
                "DOWNLOAD:"
            );
            console.log(
                "URL:",
                url
            );
            console.log(
                "Format:",
                formatId
            );

            let downloadResult = null;

            try {

                downloadResult =
                    await runYtDlp(
                        primaryArgs,
                        {
                            timeout:
                                12 * 60 * 1000,
                            maxBuffer:
                                60 * 1024 * 1024
                        }
                    );

            } catch (primaryError) {

                console.error(
                    "Primary download failed:",
                    primaryError.message
                );

                /*
                 * Direct selected-format fallback.
                 */

                const fallbackArgs = [
                    "--no-warnings",
                    "--no-playlist",
                    "--no-check-certificates",
                    "--js-runtimes",
                    "deno",
                    "--socket-timeout",
                    "20",
                    "--retries",
                    "1",
                    "--fragment-retries",
                    "1",
                    "--no-part",
                    "-f",
                    formatId,
                    "--restrict-filenames",
                    "-o",
                    outputTemplate,
                    url
                ];

                downloadResult =
                    await runYtDlp(
                        fallbackArgs,
                        {
                            timeout:
                                10 * 60 * 1000,
                            maxBuffer:
                                60 * 1024 * 1024
                        }
                    );
            }

            /*
             * Find the actual downloaded file.
             */

            const downloadedFile =
                findDownloadedFile(
                    jobDir
                );

            if (!downloadedFile) {

                console.error(
                    "yt-dlp finished but no file was found."
                );

                throw new Error(
                    "Downloaded video file was not found."
                );
            }

            console.log(
                "Downloaded:",
                downloadedFile.name
            );

            console.log(
                "Size:",
                downloadedFile.size
            );

            const extension =
                path.extname(
                    downloadedFile.name
                ).toLowerCase();

            const contentTypes = {
                ".mp4":
                    "video/mp4",
                ".m4v":
                    "video/mp4",
                ".webm":
                    "video/webm",
                ".mov":
                    "video/quicktime",
                ".mkv":
                    "video/x-matroska",
                ".avi":
                    "video/x-msvideo",
                ".flv":
                    "video/x-flv"
            };

            const contentType =
                contentTypes[
                    extension
                ] ||
                "application/octet-stream";

            const downloadName =
                sanitizeFilename(
                    path.basename(
                        downloadedFile.name,
                        extension
                    )
                ) +
                (
                    extension ||
                    ".mp4"
                );

            res.statusCode = 200;

            res.setHeader(
                "Content-Type",
                contentType
            );

            res.setHeader(
                "Content-Length",
                String(
                    downloadedFile.size
                )
            );

            res.setHeader(
                "Content-Disposition",
                `attachment; filename="${downloadName}"`
            );

            res.setHeader(
                "Cache-Control",
                "no-store, no-cache, must-revalidate"
            );

            res.setHeader(
                "Pragma",
                "no-cache"
            );

            const fileStream =
                fs.createReadStream(
                    downloadedFile.path
                );

            let cleaned = false;

            const cleanup =
                () => {

                    if (cleaned) {
                        return;
                    }

                    cleaned = true;

                    fs.rm(
                        jobDir,
                        {
                            recursive: true,
                            force: true
                        },
                        (error) => {

                            if (error) {

                                console.log(
                                    "Cleanup error:",
                                    error.message
                                );
                            }
                        }
                    );
                };

            fileStream.on(
                "error",
                (error) => {

                    console.error(
                        "File stream error:",
                        error.message
                    );

                    cleanup();

                    if (
                        !res.writableEnded
                    ) {
                        res.destroy(
                            error
                        );
                    }
                }
            );

            res.on(
                "finish",
                () => {

                    console.log(
                        "Download sent successfully."
                    );

                    cleanup();
                }
            );

            res.on(
                "close",
                () => {

                    cleanup();
                }
            );

            fileStream.pipe(
                res
            );

        } catch (error) {

            console.error(
                "DOWNLOAD ERROR:",
                error.message
            );

            fs.rm(
                jobDir,
                {
                    recursive: true,
                    force: true
                },
                () => {}
            );

            if (
                res.headersSent ||
                res.writableEnded
            ) {
                return;
            }

            let message =
                error.message ||
                "Video download failed.";

            if (
                /sign in to confirm/i.test(message) ||
                /not a bot/i.test(message) ||
                /captcha/i.test(message)
            ) {

                message =
                    "This source is currently blocking automated access from the server.";
            }

            if (
                error.code === "TIMEOUT"
            ) {

                message =
                    "The download took too long and was stopped.";
            }

            return res.status(502).json({
                success: false,
                message
            });
        }
    }
);

/* =========================================================
   404
========================================================= */

app.use(
    (req, res) => {

        res.status(404).json({
            success: false,
            message:
                "API endpoint not found."
        });
    }
);

/* =========================================================
   SERVER START
========================================================= */

app.listen(
    PORT,
    async () => {

        console.log("");
        console.log(
            "========================================"
        );

        console.log(
            `Server running on port ${PORT}`
        );

        console.log(
            `yt-dlp: ${ytDlpPath}`
        );

        console.log(
            `Downloads: ${downloadDir}`
        );

        console.log(
            "========================================"
        );

        await checkYtDlp();
    }
);