const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 3000;

/* =========================================================
   CORS
========================================================= */

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

const ytDlpPath = path.join(
    __dirname,
    "yt-dlp.exe"
);

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

    const secs =
        total % 60;

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
            hostname === "instagram.com"
        ) {
            return "Instagram";
        }

        if (
            hostname === "tiktok.com" ||
            hostname === "vm.tiktok.com"
        ) {
            return "TikTok";
        }

        if (
            hostname === "twitter.com" ||
            hostname === "x.com"
        ) {
            return "X / Twitter";
        }

        if (
            hostname === "vimeo.com"
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
   CLEANUP
========================================================= */

function cleanupDirectory(directory) {

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

        console.log(
            "Cleaned:",
            directory
        );

    } catch (error) {

        console.error(
            "Cleanup error:",
            error.message
        );
    }
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
                "Universal Video Downloader backend is running."
        });
    }
);


/* =========================================================
   RUN YT-DLP
========================================================= */

function runYtDlp(
    args,
    options = {}
) {

    return new Promise(
        (resolve, reject) => {

            if (
                !fs.existsSync(
                    ytDlpPath
                )
            ) {

                reject(
                    new Error(
                        "yt-dlp.exe was not found in the backend folder."
                    )
                );

                return;
            }


            const child =
                spawn(
                    ytDlpPath,
                    args,
                    {
                        windowsHide: true,
                        cwd: __dirname,
                        ...options
                    }
                );


            let stdout = "";
            let stderr = "";


            child.stdout.on(
                "data",
                (data) => {

                    stdout +=
                        data.toString();
                }
            );


            child.stderr.on(
                "data",
                (data) => {

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
                (error) => {

                    reject(error);
                }
            );


            child.on(
                "close",
                (code) => {

                    if (code === 0) {

                        resolve({
                            stdout,
                            stderr
                        });

                        return;
                    }


                    const message =
                        stderr.trim() ||
                        `yt-dlp exited with code ${code}.`;

                    reject(
                        new Error(
                            message
                        )
                    );
                }
            );
        }
    );
}


/* =========================================================
   EXTRACT YT-DLP JSON
========================================================= */

async function extractInfo(url) {

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
            args
        );


    let info;


    try {

        info =
            JSON.parse(
                result.stdout
            );

    } catch {

        console.error(
            "Could not parse yt-dlp JSON."
        );

        throw new Error(
            "Could not read video information from this URL."
        );
    }


    return info;
}


/* =========================================================
   FORMAT SCORE
========================================================= */

function getFormatScore(
    format
) {

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
        format.ext === "mp4"
    ) {
        score += 300;
    }


    if (
        format.ext === "webm"
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


/* =========================================================
   BUILD QUALITIES
========================================================= */

function buildQualities(
    info
) {

    const formats =
        Array.isArray(info.formats)
            ? info.formats
            : [];


    const qualityMap =
        new Map();


    for (
        const format of formats
    ) {

        /*
         * Every downloadable format needs:
         * - format_id
         * - URL
         */

        if (
            format.format_id === undefined ||
            format.format_id === null ||
            String(format.format_id) === ""
        ) {
            continue;
        }


        if (
            !format.url &&
            !format.fragments
        ) {
            continue;
        }


        /*
         * Skip audio-only formats.
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
            String(
                format.ext || ""
            ).toLowerCase();


        /*
         * =====================================================
         * NORMAL VIDEO FORMAT
         *
         * Example:
         * 360p
         * 720p
         * 1080p
         * =====================================================
         */

        if (hasKnownHeight) {

            const quality =
                `${height}p`;


            const candidate = {

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
                    !!(
                        format.acodec &&
                        format.acodec !== "none"
                    ),

                fps:
                    format.fps ||
                    null,

                filesize:
                    format.filesize ||
                    format.filesize_approx ||
                    null,

                tbr:
                    format.tbr ||
                    null,

                score:
                    getFormatScore(
                        format
                    )
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


        /*
         * =====================================================
         * GENERIC / UNKNOWN RESOLUTION MP4
         *
         * This is the important fix.
         *
         * Example from xhaccess:
         *
         * ID: 0
         * EXT: mp4
         * RESOLUTION: unknown
         *
         * The format is still downloadable.
         * =====================================================
         */

        if (
            ext === "mp4" &&
            format.url
        ) {

            const candidate = {

                quality:
                    "MP4 — Original",

                height:
                    0,

                formatId:
                    String(
                        format.format_id
                    ),

                ext:
                    "mp4",

                hasAudio:
                    !!(
                        format.acodec &&
                        format.acodec !== "none"
                    ),

                fps:
                    format.fps ||
                    null,

                filesize:
                    format.filesize ||
                    format.filesize_approx ||
                    null,

                tbr:
                    format.tbr ||
                    null,

                score:
                    getFormatScore(
                        format
                    )
            };


            const key =
                `original-${candidate.formatId}`;


            const existing =
                qualityMap.get(
                    key
                );


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


    return Array.from(
        qualityMap.values()
    )
        .sort(
            (a, b) => {

                /*
                 * Put MP4 Original after
                 * normal resolutions.
                 */

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

                return (
                    a.height -
                    b.height
                );
            }
        );
}


/* =========================================================
   ANALYZE VIDEO
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


        if (
            !isValidHttpUrl(url)
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Please enter a valid http or https video URL."
            });
        }


        console.log("");
        console.log(
            "========================================"
        );
        console.log(
            "Analyzing URL:"
        );
        console.log(url);


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
                "Title:",
                title
            );


            console.log(
                "Platform:",
                platform
            );


            console.log(
                "Qualities:",
                qualities.map(
                    q =>
                        q.quality
                ).join(", ")
            );


            /*
             * Metadata is still returned even if
             * no downloadable format exists.
             */

            return res.json({

                success: true,

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
                        ? "Video information found successfully."
                        : "Video information was found, but downloadable video qualities are not available for this URL."
            });


        } catch (error) {

            console.error(
                "Analyze error:",
                error.message
            );


            return res.status(500).json({

                success: false,

                message:
                    error.message ||
                    "Unable to analyze this video."
            });
        }
    }
);


/* =========================================================
   FIND DOWNLOADED FILE
========================================================= */

function findDownloadedFile(
    directory
) {

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

                    const stat =
                        fs.statSync(
                            filePath
                        );

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
                    file.size > 0
            );


    if (
        candidates.length === 0
    ) {
        return null;
    }


    /*
     * Prefer MP4.
     */

    const mp4 =
        candidates.find(
            file =>
                path.extname(
                    file.name
                ).toLowerCase() === ".mp4"
        );


    return mp4 ||
        candidates[0];
}


/* =========================================================
   DOWNLOAD VIDEO
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


        if (
            !isValidHttpUrl(url)
        ) {

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


        const jobId =
            `${Date.now()}-${Math.random()
                .toString(36)
                .slice(2, 10)}`;


        const jobDir =
            path.join(
                downloadDir,
                jobId
            );


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


        /*
         * IMPORTANT:
         *
         * First try:
         * selected format + best audio
         *
         * If selected format is already
         * a complete MP4 with audio, the
         * second fallback uses the exact
         * selected format.
         *
         * This is important for generic
         * format "0".
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


        let ytProcess = null;


        try {

            ytProcess =
                spawn(
                    ytDlpPath,
                    args,
                    {
                        windowsHide: true,
                        cwd: __dirname
                    }
                );


            let stderr = "";
            let stdout = "";


            ytProcess.stdout.on(
                "data",
                (data) => {

                    const text =
                        data.toString();

                    stdout += text;

                    const clean =
                        text.trim();

                    if (clean) {

                        console.log(
                            "[download]",
                            clean
                        );
                    }
                }
            );


            ytProcess.stderr.on(
                "data",
                (data) => {

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


            await new Promise(
                (
                    resolve,
                    reject
                ) => {

                    ytProcess.on(
                        "error",
                        reject
                    );


                    ytProcess.on(
                        "close",
                        (code) => {

                            if (
                                code === 0
                            ) {

                                resolve();

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


            const file =
                findDownloadedFile(
                    jobDir
                );


            if (!file) {

                throw new Error(
                    "Download completed but the output file was not found."
                );
            }


            console.log(
                "Sending file:",
                file.name
            );


            console.log(
                "File size:",
                file.size,
                "bytes"
            );


            const ext =
                path.extname(
                    file.name
                ).toLowerCase();


            let contentType =
                "application/octet-stream";


            if (ext === ".mp4") {

                contentType =
                    "video/mp4";

            } else if (
                ext === ".webm"
            ) {

                contentType =
                    "video/webm";

            } else if (
                ext === ".mkv"
            ) {

                contentType =
                    "video/x-matroska";
            }


            const downloadName =
                sanitizeFilename(
                    path.basename(
                        file.name,
                        ext
                    )
                ) +
                ext;


            res.statusCode =
                200;


            res.setHeader(
                "Content-Type",
                contentType
            );


            res.setHeader(
                "Content-Length",
                String(
                    file.size
                )
            );


            res.setHeader(
                "Content-Disposition",
                `attachment; filename="${downloadName}"`
            );


            res.setHeader(
                "Cache-Control",
                "no-store"
            );


            res.setHeader(
                "X-Content-Type-Options",
                "nosniff"
            );


            const stream =
                fs.createReadStream(
                    file.path
                );


            stream.on(
                "error",
                (error) => {

                    console.error(
                        "File stream error:",
                        error.message
                    );


                    if (
                        !res.headersSent
                    ) {

                        res.status(
                            500
                        ).json({

                            success: false,

                            message:
                                "Unable to send downloaded file."
                        });

                    } else {

                        res.destroy(
                            error
                        );
                    }
                }
            );


            stream.pipe(
                res
            );


            res.on(
                "finish",
                () => {

                    setTimeout(
                        () => {

                            cleanupDirectory(
                                jobDir
                            );

                        },
                        1000
                    );
                }
            );


            res.on(
                "close",
                () => {

                    /*
                     * If browser cancels
                     * the download.
                     */

                    if (
                        !res.writableFinished
                    ) {

                        setTimeout(
                            () => {

                                cleanupDirectory(
                                    jobDir
                                );

                            },
                            1000
                        );
                    }
                }
            );


        } catch (error) {

            console.error(
                "Download error:",
                error.message
            );


            if (
                !res.headersSent
            ) {

                return res.status(500).json({

                    success: false,

                    message:
                        error.message ||
                        "Unable to download video."
                });
            }


            try {

                res.destroy();

            } catch {}
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
   GLOBAL ERROR HANDLER
========================================================= */

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


        res.status(500).json({

            success: false,

            message:
                "Internal server error."
        });
    }
);


/* =========================================================
   START SERVER
========================================================= */

app.listen(
    PORT,
    () => {

        console.log("");
        console.log(
            "========================================"
        );

        console.log(
            "Universal Video Downloader Backend"
        );

        console.log(
            `Server running at http://localhost:${PORT}`
        );

        console.log(
            `Health: http://localhost:${PORT}/api/health`
        );

        console.log(
            "========================================"
        );

    }
);