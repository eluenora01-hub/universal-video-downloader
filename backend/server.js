const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();

const PORT = Number(process.env.PORT) || 3000;

app.use(
    cors({
        origin: "*",
        exposedHeaders: [
            "Content-Disposition",
            "Content-Length",
            "Content-Type"
        ]
    })
);

app.use(express.json());

/* =========================================================
   PATHS
========================================================= */

const ytDlpPath =
    process.platform === "win32"
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


function sanitizeFilename(name) {
    if (!name) {
        return "video";
    }

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

    const total = Math.floor(
        Number(seconds)
    );

    const hours = Math.floor(
        total / 3600
    );

    const minutes = Math.floor(
        (total % 3600) / 60
    );

    const secs = total % 60;

    if (hours > 0) {
        return (
            `${hours}:${String(minutes).padStart(2, "0")}:` +
            `${String(secs).padStart(2, "0")}`
        );
    }

    return (
        `${minutes}:${String(secs).padStart(2, "0")}`
    );
}


function detectPlatform(url) {
    try {
        const hostname =
            new URL(url)
                .hostname
                .toLowerCase()
                .replace(/^www\./, "");

        if (
            hostname === "youtube.com" ||
            hostname === "m.youtube.com" ||
            hostname === "youtu.be"
        ) {
            return "YouTube";
        }

        if (
            hostname === "facebook.com" ||
            hostname === "m.facebook.com" ||
            hostname === "fb.watch"
        ) {
            return "Facebook";
        }

        if (
            hostname === "instagram.com" ||
            hostname === "instagr.am"
        ) {
            return "Instagram";
        }

        if (
            hostname === "x.com" ||
            hostname === "twitter.com"
        ) {
            return "X / Twitter";
        }

        if (
            hostname === "tiktok.com" ||
            hostname === "vm.tiktok.com"
        ) {
            return "TikTok";
        }

        if (
            hostname === "vimeo.com" ||
            hostname.endsWith(".vimeo.com")
        ) {
            return "Vimeo";
        }

        if (
            hostname === "dailymotion.com" ||
            hostname === "dai.ly"
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


/* =========================================================
   YT-DLP RUNNER
========================================================= */

function runYtDlp(args, options = {}) {
    return new Promise(
        (resolve, reject) => {

            if (!fs.existsSync(ytDlpPath)) {
                reject(
                    new Error(
                        `yt-dlp was not found at: ${ytDlpPath}`
                    )
                );

                return;
            }

            const child =
                spawn(
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
                    const text =
                        data.toString();

                    stderr += text;

                    const clean =
                        text.trim();

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
                error => {
                    reject(error);
                }
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
        }
    );
}


/* =========================================================
   EXTRACT NORMAL INFO
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
        url
    ];

    const result =
        await runYtDlp(
            args,
            {
                maxBuffer:
                    50 * 1024 * 1024
            }
        );

    try {
        return JSON.parse(
            result.stdout
        );
    } catch {
        throw new Error(
            "Could not parse yt-dlp information."
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
        url
    ];

    const result =
        await runYtDlp(
            args,
            {
                maxBuffer:
                    50 * 1024 * 1024
            }
        );

    try {
        return JSON.parse(
            result.stdout
        );
    } catch {
        throw new Error(
            "Could not parse generic extractor information."
        );
    }
}


/* =========================================================
   EXTRACT INFO WITH FALLBACK
========================================================= */

async function extractInfo(url) {

    try {

        return await extractNormalInfo(
            url
        );

    } catch (normalError) {

        console.log(
            "Normal extractor failed."
        );

        console.log(
            normalError.message
        );

        /*
         * Try generic extraction only after
         * the normal extractor fails.
         */

        try {

            console.log(
                "Trying generic extractor..."
            );

            return await extractGenericInfo(
                url
            );

        } catch (genericError) {

            console.error(
                "Generic extractor failed:"
            );

            console.error(
                genericError.message
            );

            throw normalError;
        }
    }
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
     * First collect normal video formats.
     */

    for (
        const format
        of formats
    ) {

        if (
            format.format_id === undefined ||
            format.format_id === null
        ) {
            continue;
        }

        const formatId =
            String(format.format_id);

        if (!formatId) {
            continue;
        }

        const hasVideo =
            format.vcodec &&
            format.vcodec !== "none";

        if (!hasVideo) {
            continue;
        }

        const height =
            Number(format.height);

        /*
         * Unknown resolution / generic
         * direct MP4 format.
         */

        if (
            !Number.isFinite(height) ||
            height < 1
        ) {

            if (
                String(format.ext || "")
                    .toLowerCase() === "mp4"
            ) {

                const key =
                    `generic-${formatId}`;

                if (
                    !qualityMap.has(key)
                ) {

                    qualityMap.set(
                        key,
                        {
                            quality:
                                "MP4 — Original",

                            height: 0,

                            formatId,

                            ext:
                                format.ext ||
                                "mp4",

                            hasAudio:
                                !!(
                                    format.acodec &&
                                    format.acodec !== "none"
                                ),

                            filesize:
                                format.filesize ||
                                format.filesize_approx ||
                                null
                        }
                    );
                }
            }

            continue;
        }

        const quality =
            `${height}p`;

        /*
         * Prefer MP4 when several formats
         * have the same resolution.
         */

        const existing =
            qualityMap.get(
                quality
            );

        const currentScore =
            getFormatScore(format);

        if (
            !existing ||
            currentScore >
            existing.score
        ) {

            qualityMap.set(
                quality,
                {
                    quality,

                    height,

                    formatId,

                    ext:
                        format.ext ||
                        "mp4",

                    hasAudio:
                        !!(
                            format.acodec &&
                            format.acodec !== "none"
                        ),

                    filesize:
                        format.filesize ||
                        format.filesize_approx ||
                        null,

                    score:
                        currentScore
                }
            );
        }
    }


    /*
     * Convert map to array.
     */

    const qualities =
        Array.from(
            qualityMap.values()
        );


    /*
     * Sort normal resolutions first.
     * Generic MP4 goes last.
     */

    qualities.sort(
        (a, b) => {

            const ah =
                Number(a.height) || 0;

            const bh =
                Number(b.height) || 0;

            return ah - bh;
        }
    );


    /*
     * Remove internal score.
     */

    return qualities.map(
        item => {

            const clean = {
                quality:
                    item.quality,

                height:
                    item.height,

                formatId:
                    item.formatId,

                ext:
                    item.ext,

                hasAudio:
                    item.hasAudio
            };

            if (
                item.filesize
            ) {
                clean.filesize =
                    item.filesize;
            }

            return clean;
        }
    );
}


/* =========================================================
   FORMAT SCORE
========================================================= */

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
        String(format.ext || "")
            .toLowerCase() === "mp4"
    ) {
        score += 300;
    }

    if (
        String(format.ext || "")
            .toLowerCase() === "webm"
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

    return score;
}


/* =========================================================
   HEALTH CHECK
========================================================= */

app.get(
    "/api/health",
    (req, res) => {

        res.json({
            success: true,

            message:
                "Universal Video Downloader backend is running.",

            ytDlp:
                ytDlpPath,

            platform:
                process.platform
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

            return res.status(400)
                .json({
                    success: false,
                    message:
                        "Video URL is required."
                });
        }

        if (!isValidHttpUrl(url)) {

            return res.status(400)
                .json({
                    success: false,
                    message:
                        "Invalid video URL."
                });
        }


        console.log("");
        console.log(
            "========================================"
        );

        console.log(
            "Analyzing:",
            url
        );

        console.log(
            "Platform:",
            detectPlatform(url)
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
                "Video detected";


            const thumbnail =
                info.thumbnail ||
                info.thumbnails?.[
                    info.thumbnails.length - 1
                ]?.url ||
                null;


            const duration =
                formatDuration(
                    info.duration
                );


            const platform =
                detectPlatform(url);


            const author =
                info.uploader ||
                info.channel ||
                info.creator ||
                info.author ||
                null;


            console.log(
                "Title:",
                title
            );

            console.log(
                "Formats:",
                qualities.length
            );


            return res.json({

                success: true,

                url,

                platform,

                title,

                thumbnail,

                duration,

                author,

                qualities
            });


        } catch (error) {

            console.error(
                "Analyze error:",
                error.message
            );


            return res.status(502)
                .json({

                    success: false,

                    message:
                        error.message ||
                        "Could not analyze this public video URL."
                });
        }
    }
);


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

            return res.status(400)
                .json({
                    success: false,
                    message:
                        "Video URL is required."
                });
        }


        if (!isValidHttpUrl(url)) {

            return res.status(400)
                .json({
                    success: false,
                    message:
                        "Invalid video URL."
                });
        }


        if (!formatId) {

            return res.status(400)
                .json({
                    success: false,
                    message:
                        "Video quality is required."
                });
        }


        /*
         * IMPORTANT:
         *
         * yt-dlp format IDs are extractor-specific.
         *
         * They are NOT always numeric.
         *
         * Examples:
         * 0
         * 18
         * 22
         * hls-123
         * http-720
         *
         * Therefore we allow safe format-id characters.
         */

        if (
            !/^[A-Za-z0-9._:-]+$/.test(
                formatId
            )
        ) {

            return res.status(400)
                .json({
                    success: false,
                    message:
                        "Invalid format ID."
                });
        }


        const jobId =
            `${Date.now()}-` +
            `${Math.random()
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
             * First:
             *
             * selected format + best audio
             *
             * If selected format already contains
             * audio, yt-dlp can use the first part.
             *
             * Second:
             *
             * exact selected format
             *
             * This is important for generic formats
             * such as format "0".
             */

            const formatSelector =
                `${formatId}+bestaudio/` +
                `${formatId}/best`;


            const args = [

                "--no-warnings",

                "--no-playlist",

                "--no-check-certificates",

                "--js-runtimes",

                "deno",

                "--restrict-filenames",

                "-f",

                formatSelector,

                "--merge-output-format",

                "mp4",

                "-o",

                outputTemplate,

                url
            ];


            console.log("");
            console.log(
                "========================================"
            );

            console.log(
                "Starting download:"
            );

            console.log(
                "URL:",
                url
            );

            console.log(
                "Format:",
                formatId
            );


            const result =
                await runYtDlp(
                    args,
                    {
                        maxBuffer:
                            50 * 1024 * 1024,

                        timeout:
                            20 * 60 * 1000
                    }
                );


            /*
             * Find generated file.
             */

            const files =
                fs.readdirSync(
                    jobDir,
                    {
                        withFileTypes:
                            true
                    }
                );


            const candidates =
                files
                    .filter(
                        file =>
                            file.isFile()
                    )
                    .map(
                        file => ({
                            name:
                                file.name,

                            path:
                                path.join(
                                    jobDir,
                                    file.name
                                )
                        })
                    )
                    .filter(
                        file => {

                            try {

                                return (
                                    fs.statSync(
                                        file.path
                                    ).size > 0
                                );

                            } catch {

                                return false;
                            }
                        }
                    );


            if (
                !candidates.length
            ) {

                cleanupDirectory(
                    jobDir
                );

                return res.status(500)
                    .json({
                        success: false,
                        message:
                            "Downloaded video file was not found."
                    });
            }


            const file =
                candidates[0];


            const stat =
                fs.statSync(
                    file.path
                );


            const downloadName =
                sanitizeFilename(
                    path.parse(
                        file.name
                    ).name
                ) +
                path.extname(
                    file.name
                );


            res.statusCode = 200;


            res.setHeader(
                "Content-Type",
                "video/mp4"
            );


            res.setHeader(
                "Content-Length",
                String(stat.size)
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


            console.log(
                "Sending file:",
                file.name,
                `${stat.size} bytes`
            );


            const fileStream =
                fs.createReadStream(
                    file.path
                );


            let cleaned =
                false;


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


            fileStream.on(
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
                () => {

                    console.log(
                        "Download sent successfully:",
                        file.name
                    );

                    cleanup();
                }
            );


            res.on(
                "close",
                () => {

                    if (
                        !res.writableFinished
                    ) {

                        console.log(
                            "Browser connection closed before download completed."
                        );
                    }

                    cleanup();
                }
            );


            fileStream.pipe(
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

                return res.status(500)
                    .json({

                        success: false,

                        message:
                            error.message ||
                            "Video download failed."
                    });
            }
        }
    }
);


/* =========================================================
   CLEANUP
========================================================= */

function cleanupDirectory(
    directory
) {

    if (
        !directory ||
        !fs.existsSync(directory)
    ) {
        return;
    }


    try {

        fs.rmSync(
            directory,
            {
                recursive: true,
                force: true
            }
        );

    } catch (error) {

        console.error(
            "Cleanup error:",
            error.message
        );
    }
}


/* =========================================================
   START SERVER
========================================================= */

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
            "yt-dlp:",
            ytDlpPath
        );

        console.log(
            "Downloads:",
            downloadDir
        );

        console.log(
            `Server running on port ${PORT}`
        );

        console.log(
            "========================================"
        );
    }
);