const express = require("express");
const cors = require("cors");
const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

/* =========================
   PATHS
========================= */

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

/* =========================
   HEALTH CHECK
========================= */

app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        message:
            "Universal Video Downloader backend is running."
    });
});

/* =========================
   YOUTUBE ID
========================= */

function getYouTubeID(url) {
    try {
        const parsed = new URL(url);

        const host =
            parsed.hostname
                .toLowerCase()
                .replace(/^www\./, "");

        if (host === "youtu.be") {
            return parsed.pathname
                .replace(/^\/+/, "")
                .split("/")[0];
        }

        if (
            host === "youtube.com" ||
            host === "m.youtube.com"
        ) {
            const videoID =
                parsed.searchParams.get("v");

            if (videoID) {
                return videoID;
            }

            const parts =
                parsed.pathname
                    .split("/")
                    .filter(Boolean);

            if (
                parts[0] === "shorts" &&
                parts[1]
            ) {
                return parts[1];
            }

            if (
                parts[0] === "embed" &&
                parts[1]
            ) {
                return parts[1];
            }
        }
    } catch (error) {
        return null;
    }

    return null;
}

function isYouTube(url) {
    return !!getYouTubeID(url);
}

/* =========================
   YOUTUBE METADATA
========================= */

async function getYouTubeMetadata(url) {
    const videoID =
        getYouTubeID(url);

    if (!videoID) {
        throw new Error(
            "Invalid YouTube URL."
        );
    }

    const thumbnail =
        `https://img.youtube.com/vi/${videoID}/hqdefault.jpg`;

    let title =
        "YouTube video";

    let author = null;

    try {
        const response =
            await fetch(
                "https://www.youtube.com/oembed?url=" +
                encodeURIComponent(url) +
                "&format=json",
                {
                    signal:
                        AbortSignal.timeout(10000)
                }
            );

        if (response.ok) {
            const data =
                await response.json();

            title =
                data.title ||
                title;

            author =
                data.author_name ||
                null;
        }
    } catch (error) {
        console.log(
            "YouTube oEmbed unavailable."
        );
    }

    return {
        title,
        thumbnail,
        platform: "YouTube",
        author,
        videoID
    };
}

/* =========================
   RUN YT-DLP
========================= */

function runYtDlp(
    args,
    options = {}
) {
    return new Promise(
        (resolve, reject) => {

            if (!fs.existsSync(ytDlpPath)) {
                reject(
                    new Error(
                        `yt-dlp executable was not found at: ${ytDlpPath}`
                    )
                );

                return;
            }

            const child =
                execFile(
                    ytDlpPath,
                    args,
                    {
                        cwd: __dirname,
                        windowsHide: true,
                        maxBuffer:
                            20 * 1024 * 1024,
                        ...options
                    },
                    (
                        error,
                        stdout,
                        stderr
                    ) => {

                        if (error) {
                            reject(
                                new Error(
                                    stderr?.trim() ||
                                    error.message ||
                                    `yt-dlp exited with code ${error.code}`
                                )
                            );

                            return;
                        }

                        resolve({
                            stdout:
                                stdout || "",
                            stderr:
                                stderr || ""
                        });
                    }
                );

            child.on(
                "error",
                (error) => {
                    reject(error);
                }
            );
        }
    );
}

/* =========================
   GET VIDEO INFO
========================= */

async function getVideoInfo(url) {
    const args = [
        "--dump-single-json",
        "--no-warnings",
        "--no-playlist",
        "--js-runtimes",
        "deno",
        url
    ];

    const result =
        await runYtDlp(args);

    try {
        return JSON.parse(
            result.stdout
        );
    } catch (error) {
        throw new Error(
            "Could not read video information from yt-dlp."
        );
    }
}

/* =========================
   PLATFORM DETECTION
========================= */

function getPlatform(url) {
    try {
        const parsed =
            new URL(url);

        const hostname =
            parsed.hostname
                .toLowerCase()
                .replace(/^www\./, "");

        if (
            hostname === "youtube.com" ||
            hostname === "youtu.be" ||
            hostname.endsWith(".youtube.com")
        ) {
            return "YouTube";
        }

        if (
            hostname === "facebook.com" ||
            hostname.endsWith(".facebook.com") ||
            hostname === "fb.watch"
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
            hostname === "twitter.com" ||
            hostname === "x.com" ||
            hostname.endsWith(".twitter.com") ||
            hostname.endsWith(".x.com")
        ) {
            return "X / Twitter";
        }

        if (
            hostname === "tiktok.com" ||
            hostname.endsWith(".tiktok.com")
        ) {
            return "TikTok";
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

        if (
            hostname === "vimeo.com" ||
            hostname.endsWith(".vimeo.com")
        ) {
            return "Vimeo";
        }

        return hostname;
    } catch {
        return "Unknown";
    }
}

/* =========================
   FORMAT HELPERS
========================= */

function formatBytes(bytes) {
    if (
        bytes === undefined ||
        bytes === null ||
        isNaN(bytes)
    ) {
        return null;
    }

    if (bytes === 0) {
        return "0 B";
    }

    const units = [
        "B",
        "KB",
        "MB",
        "GB",
        "TB"
    ];

    const index =
        Math.floor(
            Math.log(bytes) /
            Math.log(1024)
        );

    const value =
        bytes /
        Math.pow(1024, index);

    return (
        value.toFixed(
            index === 0 ? 0 : 1
        ) +
        " " +
        units[index]
    );
}

function formatDuration(seconds) {
    if (
        seconds === undefined ||
        seconds === null ||
        isNaN(seconds)
    ) {
        return null;
    }

    seconds =
        Math.max(
            0,
            Math.floor(seconds)
        );

    const hours =
        Math.floor(
            seconds / 3600
        );

    const minutes =
        Math.floor(
            (seconds % 3600) / 60
        );

    const secs =
        seconds % 60;

    if (hours > 0) {
        return (
            `${hours}:` +
            `${String(minutes).padStart(2, "0")}:` +
            `${String(secs).padStart(2, "0")}`
        );
    }

    return (
        `${minutes}:` +
        `${String(secs).padStart(2, "0")}`
    );
}

function getQualityLabel(format) {
    if (!format) {
        return "Unknown";
    }

    if (
        format.height &&
        format.height > 0
    ) {
        return `${format.height}p`;
    }

    if (
        format.format_note &&
        typeof format.format_note === "string"
    ) {
        return format.format_note;
    }

    if (
        format.resolution &&
        format.resolution !== "unknown"
    ) {
        return format.resolution;
    }

    return "Original";
}

function getFormatSize(format) {
    if (!format) {
        return null;
    }

    if (format.filesize) {
        return formatBytes(
            format.filesize
        );
    }

    if (format.filesize_approx) {
        return (
            "~" +
            formatBytes(
                format.filesize_approx
            )
        );
    }

    return null;
}

function isVideoFormat(format) {
    if (!format) {
        return false;
    }

    return (
        format.vcodec &&
        format.vcodec !== "none"
    );
}

function hasAudio(format) {
    if (!format) {
        return false;
    }

    return (
        format.acodec &&
        format.acodec !== "none"
    );
}

/* =========================
   BUILD QUALITY LIST
========================= */

function buildQualities(info) {
    const formats =
        Array.isArray(info.formats)
            ? info.formats
            : [];

    const qualities = [];

    const seen =
        new Set();

    /*
     * Normal video formats
     */
    for (const format of formats) {

        if (!isVideoFormat(format)) {
            continue;
        }

        const height =
            Number(format.height || 0);

        const ext =
            format.ext ||
            "mp4";

        const formatId =
            String(format.format_id || "");

        if (!formatId) {
            continue;
        }

        /*
         * Prefer formats that are already
         * combined with audio.
         */
        const audio =
            hasAudio(format);

        const label =
            getQualityLabel(format);

        const key =
            `${label}-${ext}-${audio}`;

        if (seen.has(key)) {
            continue;
        }

        seen.add(key);

        qualities.push({
            formatId,
            quality: label,
            height,
            ext,
            hasAudio: audio,
            filesize:
                format.filesize ||
                format.filesize_approx ||
                null,
            size:
                getFormatSize(format),
            note:
                format.format_note ||
                null
        });
    }

    /*
     * Sort highest quality first.
     */
    qualities.sort(
        (a, b) => {

            if (
                b.height !==
                a.height
            ) {
                return (
                    b.height -
                    a.height
                );
            }

            if (
                a.hasAudio !==
                b.hasAudio
            ) {
                return a.hasAudio
                    ? -1
                    : 1;
            }

            return (
                a.formatId.localeCompare(
                    b.formatId,
                    undefined,
                    {
                        numeric: true
                    }
                )
            );
        }
    );

    /*
     * If yt-dlp returns only a generic
     * MP4 format, keep it available.
     */
    if (
        qualities.length === 0
    ) {

        for (const format of formats) {

            if (
                format.ext === "mp4" &&
                format.format_id
            ) {
                qualities.push({
                    formatId:
                        String(
                            format.format_id
                        ),
                    quality:
                        "Original",
                    height:
                        Number(
                            format.height ||
                            0
                        ),
                    ext:
                        "mp4",
                    hasAudio:
                        hasAudio(format),
                    filesize:
                        format.filesize ||
                        format.filesize_approx ||
                        null,
                    size:
                        getFormatSize(
                            format
                        ),
                    note:
                        "Original"
                });

                break;
            }
        }
    }

    return qualities;
}

/* =========================
   THUMBNAIL
========================= */

function getThumbnail(info) {
    if (
        info &&
        info.thumbnail
    ) {
        return info.thumbnail;
    }

    if (
        info &&
        Array.isArray(info.thumbnails) &&
        info.thumbnails.length
    ) {
        const thumbnails =
            info.thumbnails
                .filter(
                    (item) =>
                        item &&
                        item.url
                );

        if (
            thumbnails.length
        ) {
            return thumbnails[
                thumbnails.length - 1
            ].url;
        }
    }

    return null;
}

/* =========================
   SAFE FILE NAME
========================= */

function safeFileName(
    name
) {
    let safeBase =
        String(
            name ||
            "video"
        )
        .replace(
            /[<>:"/\\|?*\x00-\x1F]/g,
            ""
        )
        .replace(
            /\s+/g,
            " "
        )
        .trim();

    if (!safeBase) {
        safeBase = "video";
    }

    safeBase =
        safeBase
            .slice(0, 150);

    return safeBase;
}

/* =========================
   CONTENT TYPE
========================= */

function getContentType(
    filename
) {
    const ext =
        path
            .extname(filename)
            .toLowerCase();

    const types = {
        ".mp4":
            "video/mp4",
        ".webm":
            "video/webm",
        ".mkv":
            "video/x-matroska",
        ".mov":
            "video/quicktime",
        ".avi":
            "video/x-msvideo",
        ".m4v":
            "video/x-m4v"
    };

    return (
        types[ext] ||
        "application/octet-stream"
    );
}

/* =========================
   ANALYZE
========================= */

app.get(
    "/api/analyze",
    async (req, res) => {

        try {

            const url =
                String(
                    req.query.url ||
                    ""
                ).trim();

            if (!url) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Video URL is required."
                });
            }

            let parsed;

            try {
                parsed =
                    new URL(url);
            } catch {
                return res.status(400).json({
                    success: false,
                    error:
                        "Please enter a valid video URL."
                });
            }

            if (
                !["http:", "https:"]
                    .includes(
                        parsed.protocol
                    )
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Only HTTP and HTTPS URLs are supported."
                });
            }

            console.log(
                "Analyzing:",
                url
            );

            /*
             * YouTube gets dedicated metadata
             * for a reliable thumbnail/title.
             */
            let youtubeMetadata =
                null;

            if (
                isYouTube(url)
            ) {
                try {
                    youtubeMetadata =
                        await getYouTubeMetadata(
                            url
                        );
                } catch {
                    youtubeMetadata =
                        null;
                }
            }

            const info =
                await getVideoInfo(
                    url
                );

            const qualities =
                buildQualities(
                    info
                );

            const thumbnail =
                youtubeMetadata?.thumbnail ||
                getThumbnail(info);

            const title =
                youtubeMetadata?.title ||
                info.title ||
                "Video";

            const platform =
                youtubeMetadata?.platform ||
                getPlatform(url);

            const duration =
                formatDuration(
                    info.duration
                );

            const uploader =
                youtubeMetadata?.author ||
                info.uploader ||
                info.channel ||
                null;

            return res.json({
                success: true,

                data: {
                    title,
                    thumbnail,
                    platform,
                    uploader,
                    duration,
                    webpage_url:
                        info.webpage_url ||
                        url,

                    qualities
                }
            });

        } catch (error) {

            console.error(
                "Analyze error:",
                error
            );

            return res.status(500).json({
                success: false,
                error:
                    error.message ||
                    "Unable to analyze this video."
            });
        }
    }
);

/* =========================
   DOWNLOAD
========================= */

app.get(
    "/api/download",
    async (req, res) => {

        const url =
            String(
                req.query.url ||
                ""
            ).trim();

        const formatId =
            String(
                req.query.format ||
                ""
            ).trim();

        if (!url) {
            return res.status(400).json({
                success: false,
                error:
                    "Video URL is required."
            });
        }

        if (!formatId) {
            return res.status(400).json({
                success: false,
                error:
                    "Video format is required."
            });
        }

        /*
         * Basic validation.
         */
        try {
            const parsed =
                new URL(url);

            if (
                !["http:", "https:"]
                    .includes(
                        parsed.protocol
                    )
            ) {
                throw new Error(
                    "Invalid protocol"
                );
            }
        } catch {
            return res.status(400).json({
                success: false,
                error:
                    "Invalid video URL."
            });
        }

        /*
         * Prevent format selector injection.
         */
        if (
            !/^[0-9]+$/.test(
                formatId
            )
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Invalid video format."
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
         * First try selected video + best audio.
         *
         * If selected format already contains
         * audio, the second selector can fall back
         * to selected format itself.
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

            /*
             * FFmpeg merges separate video/audio
             * streams into MP4 whenever possible.
             */
            "--merge-output-format",
            "mp4",

            /*
             * Prevent overwriting.
             */
            "--no-overwrites",

            /*
             * Output path.
             */
            "-o",
            outputTemplate,

            url
        ];

        try {

            await new Promise(
                (resolve, reject) => {

                    const child =
                        require("child_process").spawn(
                            ytDlpPath,
                            args,
                            {
                                windowsHide:
                                    true,
                                cwd:
                                    __dirname
                            }
                        );

                    let stderr =
                        "";

                    child.stdout.on(
                        "data",
                        (data) => {

                            const text =
                                data.toString();

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

                    child.stderr.on(
                        "data",
                        (data) => {

                            const text =
                                data.toString();

                            stderr +=
                                text;

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
                            reject(
                                error
                            );
                        }
                    );

                    child.on(
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

            /*
             * Find downloaded file.
             */
            const files =
                fs.readdirSync(
                    jobDir
                );

            const videoFiles =
                files.filter(
                    (file) => {

                        const fullPath =
                            path.join(
                                jobDir,
                                file
                            );

                        try {
                            return (
                                fs.statSync(
                                    fullPath
                                ).isFile()
                            );
                        } catch {
                            return false;
                        }
                    }
                );

            if (
                videoFiles.length === 0
            ) {
                throw new Error(
                    "Download completed but no video file was created."
                );
            }

            /*
             * Use the largest file.
             */
            videoFiles.sort(
                (a, b) => {

                    const sizeA =
                        fs.statSync(
                            path.join(
                                jobDir,
                                a
                            )
                        ).size;

                    const sizeB =
                        fs.statSync(
                            path.join(
                                jobDir,
                                b
                            )
                        ).size;

                    return (
                        sizeB -
                        sizeA
                    );
                }
            );

            const filename =
                videoFiles[0];

            const filePath =
                path.join(
                    jobDir,
                    filename
                );

            if (
                !fs.existsSync(
                    filePath
                )
            ) {
                throw new Error(
                    "Downloaded file could not be found."
                );
            }

            const stat =
                fs.statSync(
                    filePath
                );

            if (
                !stat.isFile() ||
                stat.size <= 0
            ) {
                throw new Error(
                    "Downloaded file is empty."
                );
            }

            console.log(
                "Download complete:",
                filename
            );

            /*
             * Content headers.
             */
            res.setHeader(
                "Content-Type",
                getContentType(
                    filename
                )
            );

            res.setHeader(
                "Content-Length",
                stat.size
            );

            res.setHeader(
                "Content-Disposition",
                `attachment; filename="${safeFileName(
                    path.basename(
                        filename
                    )
                )}"`
            );

            /*
             * Stream file to user.
             */
            const stream =
                fs.createReadStream(
                    filePath
                );

            stream.on(
                "error",
                (error) => {

                    console.error(
                        "File stream error:",
                        error
                    );

                    if (
                        !res.headersSent
                    ) {
                        res.status(500).json({
                            success: false,
                            error:
                                "Unable to send downloaded file."
                        });
                    } else {
                        res.destroy(
                            error
                        );
                    }
                }
            );

            stream.on(
                "close",
                () => {

                    /*
                     * Cleanup after response.
                     */
                    setTimeout(
                        () => {

                            try {

                                if (
                                    fs.existsSync(
                                        filePath
                                    )
                                ) {
                                    fs.unlinkSync(
                                        filePath
                                    );
                                }

                                if (
                                    fs.existsSync(
                                        jobDir
                                    )
                                ) {
                                    fs.rmSync(
                                        jobDir,
                                        {
                                            recursive:
                                                true,
                                            force:
                                                true
                                        }
                                    );
                                }

                            } catch (
                                cleanupError
                            ) {

                                console.log(
                                    "Cleanup error:",
                                    cleanupError.message
                                );
                            }

                        },
                        5000
                    );
                }
            );

            stream.pipe(res);

        } catch (error) {

            console.error(
                "Download error:",
                error
            );

            try {
                if (
                    fs.existsSync(
                        jobDir
                    )
                ) {
                    fs.rmSync(
                        jobDir,
                        {
                            recursive:
                                true,
                            force:
                                true
                        }
                    );
                }
            } catch {}

            if (
                res.headersSent
            ) {
                return;
            }

            return res.status(500).json({
                success: false,
                error:
                    error.message ||
                    "Unable to download this video."
            });
        }
    }
);

/* =========================
   404
========================= */

app.use(
    (req, res) => {
        res.status(404).json({
            success: false,
            error:
                "Endpoint not found."
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

        res.status(500).json({
            success: false,
            error:
                error.message ||
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

        console.log("");
        console.log(
            "========================================"
        );

        console.log(
            "Universal Video Downloader Backend"
        );

        console.log(
            "========================================"
        );

        console.log(
            `Server running on port ${PORT}`
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
            "========================================"
        );

        console.log("");
    }
);