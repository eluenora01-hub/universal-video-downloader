const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors({
    origin: "*",
    exposedHeaders: [
        "Content-Disposition",
        "Content-Length",
        "Content-Type"
    ]
}));

app.use(express.json());

// Windows: local yt-dlp.exe
// Linux/Render: yt-dlp installed by Dockerfile
const ytDlpPath = process.platform === "win32"
    ? path.join(__dirname, "yt-dlp.exe")
    : "/usr/local/bin/yt-dlp";

const downloadDir = path.join(__dirname, "downloads");

if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
}


/* =========================
   BASIC HELPERS
========================= */

function isValidHttpUrl(value) {
    try {
        const url = new URL(value);

        return (
            url.protocol === "http:" ||
            url.protocol === "https:"
        );
    } catch {
        return false;
    }
}


function sanitizeFilename(name) {
    if (!name) return "video";

    return String(name)
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

    const total = Math.floor(Number(seconds));

    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }

    return `${minutes}:${String(secs).padStart(2, "0")}`;
}


function detectPlatform(url) {
    try {
        const hostname = new URL(url)
            .hostname
            .toLowerCase()
            .replace(/^www\./, "");

        if (
            ["youtube.com", "m.youtube.com", "youtu.be"]
                .includes(hostname)
        ) {
            return "YouTube";
        }

        if (
            ["facebook.com", "m.facebook.com", "fb.watch"]
                .includes(hostname)
        ) {
            return "Facebook";
        }

        if (
            hostname === "instagram.com" ||
            hostname.endsWith(".instagram.com")
        ) {
            return "Instagram";
        }

        if (
            ["tiktok.com", "vm.tiktok.com"].includes(hostname) ||
            hostname.endsWith(".tiktok.com")
        ) {
            return "TikTok";
        }

        if (
            ["twitter.com", "x.com"].includes(hostname)
        ) {
            return "X / Twitter";
        }

        if (
            hostname === "vimeo.com" ||
            hostname.endsWith(".vimeo.com")
        ) {
            return "Vimeo";
        }

        if (
            ["dailymotion.com", "dai.ly"].includes(hostname)
        ) {
            return "Dailymotion";
        }

        if (
            hostname === "reddit.com" ||
            hostname.endsWith(".reddit.com")
        ) {
            return "Reddit";
        }

        if (
            hostname === "twitch.tv" ||
            hostname.endsWith(".twitch.tv")
        ) {
            return "Twitch";
        }

        return hostname;
    } catch {
        return "Unknown";
    }
}


function cleanupDirectory(directory) {
    if (!directory || !fs.existsSync(directory)) {
        return;
    }

    try {
        fs.rmSync(directory, {
            recursive: true,
            force: true
        });
    } catch (error) {
        console.error(
            "Cleanup error:",
            error.message
        );
    }
}


/* =========================
   RUN YT-DLP
========================= */

function runYtDlp(args, options = {}) {
    return new Promise((resolve, reject) => {

        if (!fs.existsSync(ytDlpPath)) {
            reject(
                new Error(
                    `yt-dlp executable was not found at: ${ytDlpPath}`
                )
            );

            return;
        }

        const child = spawn(
            ytDlpPath,
            args,
            {
                cwd: __dirname,
                windowsHide: true,
                ...options
            }
        );

        let stdout = "";
        let stderr = "";

        child.stdout.on(
            "data",
            data => {
                stdout += data.toString();
            }
        );

        child.stderr.on(
            "data",
            data => {
                const text = data.toString();

                stderr += text;

                const clean = text.trim();

                if (clean) {
                    console.log(
                        "[yt-dlp]",
                        clean
                    );
                }
            }
        );

        child.on(
            "error",
            reject
        );

        child.on(
            "close",
            code => {

                if (code === 0) {
                    resolve({
                        stdout,
                        stderr
                    });

                    return;
                }

                reject(
                    new Error(
                        stderr.trim() ||
                        `yt-dlp exited with code ${code}.`
                    )
                );
            }
        );
    });
}


/* =========================
   NORMAL EXTRACTION
========================= */

async function extractNormalInfo(url) {

    const args = [
        "--dump-single-json",
        "--skip-download",
        "--no-warnings",
        "--no-playlist",
        "--no-check-certificates",
        "--js-runtimes",
        "deno",
        url
    ];

    const result = await runYtDlp(
        args,
        {
            timeout: 120000
        }
    );

    try {
        return JSON.parse(
            result.stdout
        );
    } catch {
        throw new Error(
            "Could not read video information from this URL."
        );
    }
}


/* =========================
   GENERIC FALLBACK
========================= */

async function extractGenericInfo(url) {

    console.log(
        "Trying generic extractor:",
        url
    );

    const args = [
        "--dump-single-json",
        "--skip-download",
        "--no-warnings",
        "--no-playlist",
        "--no-check-certificates",

        // Force yt-dlp to use its generic extractor.
        "--force-generic-extractor",

        "--js-runtimes",
        "deno",

        url
    ];

    const result = await runYtDlp(
        args,
        {
            timeout: 120000
        }
    );

    try {
        return JSON.parse(
            result.stdout
        );
    } catch {
        throw new Error(
            "Generic extractor could not read video information."
        );
    }
}


/* =========================
   SMART EXTRACTION
========================= */

async function extractInfo(url) {

    try {

        console.log(
            "Trying normal extractor:",
            url
        );

        return await extractNormalInfo(
            url
        );

    } catch (normalError) {

        const normalMessage =
            normalError?.message ||
            "";

        console.error(
            "Normal extractor failed:",
            normalMessage
        );

        /*
         * If yt-dlp says the URL is unsupported,
         * try the generic extractor.
         *
         * This is useful for websites that expose
         * a direct/public MP4 but do not have a
         * dedicated yt-dlp extractor.
         */

        const unsupported =
            /unsupported url/i.test(
                normalMessage
            ) ||
            /no suitable extractor/i.test(
                normalMessage
            ) ||
            /generic/i.test(
                normalMessage
            );

        if (!unsupported) {
            throw normalError;
        }

        try {

            const genericInfo =
                await extractGenericInfo(
                    url
                );

            return genericInfo;

        } catch (genericError) {

            console.error(
                "Generic extractor failed:",
                genericError.message
            );

            throw normalError;
        }
    }
}


/* =========================
   FORMAT SCORING
========================= */

function getFormatScore(format) {

    let score = 0;

    if (
        format.vcodec &&
        format.vcodec !== "none"
    ) {
        score += 1000;
    }

    if (
        format.acodec &&
        format.acodec !== "none"
    ) {
        score += 500;
    }

    if (
        String(format.ext || "").toLowerCase() === "mp4"
    ) {
        score += 300;
    }

    if (
        String(format.ext || "").toLowerCase() === "webm"
    ) {
        score += 100;
    }

    if (
        Number.isFinite(
            Number(format.tbr)
        )
    ) {
        score += Math.min(
            Number(format.tbr),
            10000
        ) / 10;
    }

    if (
        Number.isFinite(
            Number(format.filesize)
        )
    ) {
        score += 1;
    }

    return score;
}


/* =========================
   BUILD QUALITIES
========================= */

function buildQualities(info) {

    const formats =
        Array.isArray(info.formats)
            ? info.formats
            : [];

    const qualityMap =
        new Map();

    for (const format of formats) {

        if (
            format.format_id === undefined ||
            format.format_id === null ||
            String(format.format_id) === ""
        ) {
            continue;
        }

        /*
         * A format can contain either
         * a direct URL or fragments.
         */
        if (
            !format.url &&
            !format.fragments
        ) {
            continue;
        }

        /*
         * Ignore audio-only formats.
         */
        if (
            format.vcodec === "none"
        ) {
            continue;
        }

        const height =
            Number(format.height);

        const hasKnownHeight =
            Number.isFinite(height) &&
            height > 0;

        const ext =
            String(format.ext || "")
                .toLowerCase();


        /* =========================
           NORMAL HEIGHT FORMAT
        ========================= */

        if (hasKnownHeight) {

            const quality =
                `${height}p`;

            const candidate = {
                quality,
                height,
                formatId:
                    String(format.format_id),
                ext:
                    format.ext || "mp4",
                hasAudio:
                    !!(
                        format.acodec &&
                        format.acodec !== "none"
                    ),
                fps:
                    format.fps || null,
                filesize:
                    format.filesize ||
                    format.filesize_approx ||
                    null,
                tbr:
                    format.tbr || null,
                score:
                    getFormatScore(format)
            };

            const existing =
                qualityMap.get(
                    quality
                );

            if (
                !existing ||
                candidate.score >
                    existing.score
            ) {
                qualityMap.set(
                    quality,
                    candidate
                );
            }

            continue;
        }


        /* =========================
           GENERIC MP4
        ========================= */

        /*
         * Important for sites such as
         * XHAccess where yt-dlp may return
         * a generic MP4 format such as "0".
         */

        if (
            ext === "mp4" &&
            format.url
        ) {

            const candidate = {
                quality:
                    "MP4 — Original",
                height: 0,
                formatId:
                    String(format.format_id),
                ext: "mp4",
                hasAudio:
                    !!(
                        format.acodec &&
                        format.acodec !== "none"
                    ),
                fps:
                    format.fps || null,
                filesize:
                    format.filesize ||
                    format.filesize_approx ||
                    null,
                tbr:
                    format.tbr || null,
                score:
                    getFormatScore(format)
            };

            const key =
                `original-${candidate.formatId}`;

            const existing =
                qualityMap.get(key);

            if (
                !existing ||
                candidate.score >
                    existing.score
            ) {
                qualityMap.set(
                    key,
                    candidate
                );
            }
        }
    }

    return Array
        .from(
            qualityMap.values()
        )
        .sort(
            (a, b) => {

                if (
                    a.height === 0 &&
                    b.height !== 0
                ) {
                    return 1;
                }

                if (
                    a.height !== 0 &&
                    b.height === 0
                ) {
                    return -1;
                }

                return a.height - b.height;
            }
        );
}


/* =========================
   FIND DOWNLOADED FILE
========================= */

function findDownloadedFile(directory) {

    if (
        !fs.existsSync(directory)
    ) {
        return null;
    }

    const files =
        fs.readdirSync(
            directory,
            {
                withFileTypes: true
            }
        );

    const candidates =
        files
            .filter(
                file =>
                    file.isFile()
            )
            .map(
                file => {

                    const filePath =
                        path.join(
                            directory,
                            file.name
                        );

                    let stat;

                    try {

                        stat =
                            fs.statSync(
                                filePath
                            );

                    } catch {
                        return null;
                    }

                    return {
                        name:
                            file.name,
                        path:
                            filePath,
                        size:
                            stat.size
                    };
                }
            )
            .filter(
                file =>
                    file &&
                    file.size > 0
            );

    if (!candidates.length) {
        return null;
    }

    return (
        candidates.find(
            file =>
                path
                    .extname(file.name)
                    .toLowerCase() ===
                ".mp4"
        ) ||
        candidates[0]
    );
}


/* =========================
   HEALTH
========================= */

app.get(
    "/api/health",
    (req, res) => {

        res.json({
            success: true,
            message:
                "Universal Video Downloader backend is running."
        });
    }
);


/* =========================
   ANALYZE API
========================= */

app.get(
    "/api/analyze",
    async (req, res) => {

        const url =
            typeof req.query.url === "string"
                ? req.query.url.trim()
                : "";

        if (!url) {

            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        "Video URL is required."
                });
        }

        if (
            !isValidHttpUrl(url)
        ) {

            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        "Please enter a valid http or https video URL."
                });
        }

        console.log(
            "Analyzing URL:",
            url
        );

        try {

            const info =
                await extractInfo(
                    url
                );

            const qualities =
                buildQualities(
                    info
                );

            const title =
                info.title ||
                "Untitled video";

            const thumbnail =
                info.thumbnail ||
                (
                    Array.isArray(
                        info.thumbnails
                    ) &&
                    info.thumbnails.length
                        ? info.thumbnails[
                              info.thumbnails.length - 1
                          ].url
                        : null
                );

            const author =
                info.uploader ||
                info.channel ||
                info.creator ||
                null;

            const duration =
                info.duration ||
                null;

            const platform =
                info.extractor_key ||
                detectPlatform(
                    url
                );

            console.log(
                "Platform:",
                platform
            );

            console.log(
                "Qualities:",
                qualities
                    .map(
                        q =>
                            q.quality
                    )
                    .join(", ")
            );

            return res.json({

                success: true,

                url,

                title,

                thumbnail,

                platform,

                author,

                duration,

                durationText:
                    formatDuration(
                        duration
                    ),

                qualities,

                message:
                    qualities.length
                        ? "Video detected successfully. Select a quality to download."
                        : "Video information was found, but downloadable video qualities are not available for this URL."
            });

        } catch (error) {

            console.error(
                "Analyze error:",
                error.message
            );

            return res
                .status(500)
                .json({
                    success: false,
                    message:
                        error.message ||
                        "Unable to analyze this video."
                });
        }
    }
);


/* =========================
   DOWNLOAD API
========================= */

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

            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        "Video URL is required."
                });
        }


        if (
            !isValidHttpUrl(url)
        ) {

            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        "Invalid video URL."
                });
        }


        if (!formatId) {

            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        "Video quality is required."
                });
        }


        /*
         * Normal numeric yt-dlp format IDs
         * are supported.
         *
         * Generic formats such as XHAccess
         * commonly use IDs like "0".
         */
        if (
            !/^[0-9]+$/.test(
                formatId
            )
        ) {

            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        "Invalid format ID."
                });
        }


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
             * First try the requested format
             * with best audio when necessary.
             *
             * For generic formats such as
             * XHAccess "0", the direct format
             * should work through the fallback
             * "/formatId/best" selector.
             */

            const formatSelector =
                `${formatId}+bestaudio/${formatId}/best`;


            const args = [

                "--no-warnings",

                "--no-playlist",

                "--no-check-certificates",

                "--js-runtimes",

                "deno",

                "-f",

                formatSelector,

                "--merge-output-format",

                "mp4",

                "--no-part",

                "-o",

                outputTemplate,

                url
            ];


            console.log(
                "Starting download:",
                url,
                "format:",
                formatId
            );


            let result;

            try {

                result =
                    await runYtDlp(
                        args,
                        {
                            timeout:
                                20 * 60 * 1000
                        }
                    );

            } catch (downloadError) {

                /*
                 * If the normal download selector
                 * fails, try the exact format only.
                 *
                 * This is especially useful for
                 * generic MP4 formats where the
                 * source already contains audio.
                 */

                console.error(
                    "Primary download failed:",
                    downloadError.message
                );


                const directArgs = [

                    "--no-warnings",

                    "--no-playlist",

                    "--no-check-certificates",

                    "--force-generic-extractor",

                    "--js-runtimes",

                    "deno",

                    "-f",

                    formatId,

                    "--no-part",

                    "-o",

                    outputTemplate,

                    url
                ];


                result =
                    await runYtDlp(
                        directArgs,
                        {
                            timeout:
                                20 * 60 * 1000
                        }
                    );
            }


            console.log(
                "Download finished.",
                result.stdout.trim()
            );


            const file =
                findDownloadedFile(
                    jobDir
                );


            if (!file) {

                throw new Error(
                    "Download completed but the output file was not found."
                );
            }


            const ext =
                path
                    .extname(
                        file.name
                    )
                    .toLowerCase();


            const contentTypes = {

                ".mp4":
                    "video/mp4",

                ".webm":
                    "video/webm",

                ".mkv":
                    "video/x-matroska",

                ".mov":
                    "video/quicktime",

                ".m4v":
                    "video/x-m4v"
            };


            const contentType =
                contentTypes[ext] ||
                "application/octet-stream";


            const baseName =
                path.basename(
                    file.name,
                    ext
                );


            const downloadName =
                `${sanitizeFilename(
                    baseName
                )}${ext}`;


            res.statusCode = 200;


            res.setHeader(
                "Content-Type",
                contentType
            );


            res.setHeader(
                "Content-Length",
                String(file.size)
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


            res.setHeader(
                "X-Content-Type-Options",
                "nosniff"
            );


            const stream =
                fs.createReadStream(
                    file.path
                );


            let cleaned = false;


            const cleanup =
                () => {

                    if (cleaned) {
                        return;
                    }

                    cleaned = true;

                    cleanupDirectory(
                        jobDir
                    );
                };


            stream.on(
                "error",
                error => {

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
                cleanup
            );


            res.on(
                "close",
                cleanup
            );


            stream.pipe(
                res
            );

        } catch (error) {

            console.error(
                "Download error:",
                error.message
            );

            cleanupDirectory(
                jobDir
            );


            if (
                !res.headersSent &&
                !res.writableEnded
            ) {

                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            error.message ||
                            "Unable to download video."
                    });
            }
        }
    }
);


/* =========================
   404
========================= */

app.use(
    (req, res) => {

        res
            .status(404)
            .json({
                success: false,
                message:
                    "API endpoint not found."
            });
    }
);


/* =========================
   ERROR HANDLER
========================= */

app.use(
    (
        error,
        req,
        res,
        next
    ) => {

        console.error(
            "Server error:",
            error
        );

        if (
            res.headersSent
        ) {
            return next(
                error
            );
        }

        res
            .status(500)
            .json({
                success: false,
                message:
                    "Internal server error."
            });
    }
);


/* =========================
   START SERVER
========================= */

app.listen(
    PORT,
    () => {

        console.log(
            "========================================"
        );

        console.log(
            "Universal Video Downloader Backend"
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
    }
);