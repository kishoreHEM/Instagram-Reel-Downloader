const childProcess = require('child_process');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const PROJECT_DIR = path.join(__dirname, '..');
const SPLIT_FRONTEND_DIR = path.join(PROJECT_DIR, 'frontend');
const FRONTEND_DIR = fs.existsSync(path.join(SPLIT_FRONTEND_DIR, 'index.html'))
    ? SPLIT_FRONTEND_DIR
    : PROJECT_DIR;
const USING_FLAT_FRONTEND = FRONTEND_DIR === PROJECT_DIR;
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const RESOLVE_TIMEOUT_MS = 90 * 1000;

const MIME_TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml; charset=utf-8'
};

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json; charset=utf-8'
    });
    res.end(JSON.stringify(payload));
}

function sendOptions(res) {
    res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
}

function parseInstagramUrl(rawUrl) {
    let parsed;

    try {
        parsed = new URL(rawUrl);
    } catch (error) {
        throw new Error('Please enter a valid Instagram URL.');
    }

    const allowedHosts = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com']);
    const allowedPath = /^\/(reel|reels|p|tv)\/[A-Za-z0-9_.-]+\/?$/i;

    if (!['http:', 'https:'].includes(parsed.protocol) || !allowedHosts.has(parsed.hostname.toLowerCase())) {
        throw new Error('Only Instagram reel, post, and TV URLs are supported.');
    }

    if (!allowedPath.test(parsed.pathname)) {
        throw new Error('Only public Instagram reel, post, and TV URLs are supported.');
    }

    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
}

function runYtDlp(args, options = {}) {
    const timeoutMs = options.timeoutMs || RESOLVE_TIMEOUT_MS;
    const maxBytes = options.maxBytes || 20 * 1024 * 1024;

    return new Promise((resolve, reject) => {
        const process = childProcess.spawn('yt-dlp', args, {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';
        let killedForTimeout = false;
        let tooMuchOutput = false;

        const timer = setTimeout(() => {
            killedForTimeout = true;
            process.kill('SIGKILL');
        }, timeoutMs);

        process.stdout.on('data', (chunk) => {
            stdout += chunk.toString('utf8');
            if (stdout.length > maxBytes) {
                tooMuchOutput = true;
                process.kill('SIGKILL');
            }
        });

        process.stderr.on('data', (chunk) => {
            stderr += chunk.toString('utf8');
        });

        process.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });

        process.on('close', (code) => {
            clearTimeout(timer);

            if (killedForTimeout) {
                reject(new Error('Instagram took too long to respond. Please try again.'));
                return;
            }

            if (tooMuchOutput) {
                reject(new Error('Instagram returned too much data for this post.'));
                return;
            }

            if (code !== 0) {
                reject(new Error(cleanYtDlpError(stderr)));
                return;
            }

            resolve(stdout);
        });
    });
}

function cleanYtDlpError(stderr) {
    const fallback = 'Could not extract this Instagram video. Public reels work best; private or login-only content will fail.';
    const lines = stderr
        .split('\n')
        .map((line) => line.replace(/^ERROR:\s*/i, '').trim())
        .filter(Boolean);

    return lines.slice(-2).join(' ') || fallback;
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return 'Unknown size';

    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }

    return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function sanitizeFilename(name) {
    return (name || 'instagram-video')
        .replace(/[^\w\s.-]/g, '')
        .trim()
        .replace(/\s+/g, '_')
        .slice(0, 80) || 'instagram-video';
}

function buildVideoData(info, sourceUrl) {
    const formats = [
        {
            quality: 'Best',
            format: 'MP4',
            size: formatBytes(info.filesize || info.filesize_approx),
            formatId: 'best[ext=mp4]/best'
        }
    ];

    return {
        success: true,
        sourceUrl,
        thumbnail: info.thumbnail || '',
        title: info.title || 'Instagram video',
        uploader: info.uploader || info.channel || '',
        filename: `${sanitizeFilename(info.title)}.mp4`,
        formats
    };
}

async function handleResolve(req, res, requestUrl) {
    try {
        const instagramUrl = parseInstagramUrl(requestUrl.searchParams.get('url') || '');
        const output = await runYtDlp([
            '--dump-single-json',
            '--no-playlist',
            '--no-warnings',
            instagramUrl
        ]);
        const info = JSON.parse(output);

        sendJson(res, 200, buildVideoData(info, instagramUrl));
    } catch (error) {
        sendJson(res, 422, {
            success: false,
            error: error.message
        });
    }
}

function handleDownload(req, res, requestUrl) {
    let instagramUrl;

    try {
        instagramUrl = parseInstagramUrl(requestUrl.searchParams.get('url') || '');
    } catch (error) {
        sendJson(res, 422, {
            success: false,
            error: error.message
        });
        return;
    }

    const formatId = requestUrl.searchParams.get('format_id') || 'best[ext=mp4]/best';
    const requestedFilename = sanitizeFilename(requestUrl.searchParams.get('filename') || 'instagram-video');
    const filename = requestedFilename.toLowerCase().endsWith('.mp4')
        ? requestedFilename
        : `${requestedFilename}.mp4`;

    if (formatId.length > 120) {
        sendJson(res, 422, {
            success: false,
            error: 'Invalid video format.'
        });
        return;
    }

    const ytdlp = childProcess.spawn('yt-dlp', [
        '--no-playlist',
        '--no-warnings',
        '-f',
        formatId,
        '-o',
        '-',
        instagramUrl
    ], {
        stdio: ['ignore', 'pipe', 'pipe']
    });

    let stderr = '';
    let started = false;
    let responseClosed = false;

    const timer = setTimeout(() => {
        ytdlp.kill('SIGKILL');
    }, DOWNLOAD_TIMEOUT_MS);

    res.on('close', () => {
        if (!res.writableEnded) {
            responseClosed = true;
            ytdlp.kill('SIGTERM');
        }
    });

    ytdlp.stdout.on('data', (chunk) => {
        if (!started) {
            started = true;
            res.writeHead(200, {
                'Access-Control-Allow-Origin': '*',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Content-Type': 'video/mp4'
            });
        }

        res.write(chunk);
    });

    ytdlp.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
    });

    ytdlp.on('error', (error) => {
        clearTimeout(timer);
        if (!started && !responseClosed) {
            sendJson(res, 500, {
                success: false,
                error: error.message
            });
        }
    });

    ytdlp.on('close', (code) => {
        clearTimeout(timer);

        if (responseClosed) return;

        if (!started) {
            sendJson(res, code === 0 ? 200 : 422, {
                success: code === 0,
                error: code === 0 ? undefined : cleanYtDlpError(stderr)
            });
            return;
        }

        res.end();
    });
}

function handleThumbnail(req, res, requestUrl, redirectCount = 0) {
    let thumbnailUrl;

    try {
        thumbnailUrl = new URL(requestUrl.searchParams.get('url') || '');
    } catch (error) {
        sendJson(res, 422, {
            success: false,
            error: 'Invalid thumbnail URL.'
        });
        return;
    }

    if (!['http:', 'https:'].includes(thumbnailUrl.protocol)) {
        sendJson(res, 422, {
            success: false,
            error: 'Invalid thumbnail URL.'
        });
        return;
    }

    const client = thumbnailUrl.protocol === 'https:' ? https : http;
    const proxyRequest = client.get(thumbnailUrl, {
        headers: {
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'User-Agent': 'Mozilla/5.0'
        },
        timeout: 15000
    }, (proxyResponse) => {
        const contentType = proxyResponse.headers['content-type'] || 'image/jpeg';

        if ([301, 302, 303, 307, 308].includes(proxyResponse.statusCode) && proxyResponse.headers.location && redirectCount < 3) {
            proxyResponse.resume();
            requestUrl.searchParams.set('url', new URL(proxyResponse.headers.location, thumbnailUrl).toString());
            handleThumbnail(req, res, requestUrl, redirectCount + 1);
            return;
        }

        if (!String(contentType).startsWith('image/')) {
            sendJson(res, 422, {
                success: false,
                error: 'Thumbnail did not return an image.'
            });
            proxyResponse.resume();
            return;
        }

        res.writeHead(proxyResponse.statusCode || 200, {
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=3600',
            'Content-Type': contentType
        });
        proxyResponse.pipe(res);
    });

    proxyRequest.on('timeout', () => {
        proxyRequest.destroy(new Error('Thumbnail request timed out.'));
    });

    proxyRequest.on('error', () => {
        if (!res.headersSent) {
            sendJson(res, 422, {
                success: false,
                error: 'Could not load thumbnail.'
            });
        } else {
            res.end();
        }
    });
}

function serveStatic(req, res, requestUrl) {
    const requestedPath = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
    const decodedPath = decodeURIComponent(requestedPath);
    const filePath = path.normalize(path.join(FRONTEND_DIR, decodedPath));

    if (USING_FLAT_FRONTEND && !isAllowedFlatFrontendPath(decodedPath)) {
        res.writeHead(404);
        res.end('Not found');
        return;
    }

    const relativePath = path.relative(FRONTEND_DIR, filePath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.readFile(filePath, (error, content) => {
        if (error) {
            res.writeHead(error.code === 'ENOENT' ? 404 : 500);
            res.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
            return;
        }

        res.writeHead(200, {
            'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream'
        });
        res.end(content);
    });
}

// Clean-URL page map: /privacy → /privacy.html, etc.
const CLEAN_URL_MAP = {
    '/': '/index.html',
    '/contact': '/contact.html',
    '/privacy': '/privacy.html',
    '/terms': '/terms.html',
    '/faq': '/index.html' // FAQ lives as a section on the homepage
};

function resolveCleanPath(pathname) {
    return CLEAN_URL_MAP[pathname] || null;
}

function isAllowedFlatFrontendPath(requestedPath) {
    return requestedPath === '/index.html'
        || requestedPath === '/contact.html'
        || requestedPath === '/privacy.html'
        || requestedPath === '/terms.html'
        || requestedPath.startsWith('/assets/')
        || requestedPath.startsWith('/scripts/')
        || requestedPath.startsWith('/styles/');
}

const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);

    if (requestUrl.pathname.startsWith('/api/') && req.method === 'OPTIONS') {
        sendOptions(res);
        return;
    }

    if (requestUrl.pathname === '/api/resolve') {
        handleResolve(req, res, requestUrl);
        return;
    }

    if (requestUrl.pathname === '/api/download') {
        handleDownload(req, res, requestUrl);
        return;
    }

    if (requestUrl.pathname === '/api/thumbnail') {
        handleThumbnail(req, res, requestUrl);
        return;
    }

    // 301: redirect legacy .html paths → clean URLs (SEO)
    const HTML_TO_CLEAN = {
        '/index.html': '/',
        '/contact.html': '/contact',
        '/privacy.html': '/privacy',
        '/terms.html': '/terms'
    };
    const legacyClean = HTML_TO_CLEAN[requestUrl.pathname];
    if (legacyClean) {
        res.writeHead(301, { Location: legacyClean });
        res.end();
        return;
    }

    // Rewrite clean URLs → .html paths before static serving
    const cleanResolved = resolveCleanPath(requestUrl.pathname);
    if (cleanResolved) {
        requestUrl.pathname = cleanResolved;
    }

    serveStatic(req, res, requestUrl);
});

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. The backend may already be running at http://127.0.0.1:${PORT}`);
        console.error(`Stop the existing process or open http://127.0.0.1:${PORT} directly.`);
        process.exit(1);
    }

    throw error;
});

// Listen on '0.0.0.0' so that Railway can route public traffic to the app
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Insta Reel Downloader running on http://0.0.0.0:${PORT}`);
});
