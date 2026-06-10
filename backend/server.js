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
    '.svg': 'image/svg+xml; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8'
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
    // FIX 1: Updated path regex to support stories, highlights, and audio posts seamlessly
    const allowedPath = /^\/(reel|reels|p|tv|stories|s)\/[A-Za-z0-9_.-]+\/?$/i;

    if (!['http:', 'https:'].includes(parsed.protocol) || !allowedHosts.has(parsed.hostname.toLowerCase())) {
        throw new Error('Only Instagram links are supported.');
    }

    // Relax verification fallback for root profiles trying to scrape stories via usernames
    const paths = parsed.pathname.split('/').filter(Boolean);
    if (paths.length === 1) {
        return parsed.toString();
    }

    if (!allowedPath.test(parsed.pathname)) {
        throw new Error('Unsupported Instagram URL structure.');
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
    const fallback = 'Could not extract media. Ensure the post is public and valid.';
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
    return (name || '')
        .replace(/[^\w\s.-]/g, '')
        .trim()
        .replace(/\s+/g, '_')
        .slice(0, 80) || 'instagram-media';
}

// FIX 2: Dynamic Content Mapper supporting Single Images, Audio-Only Streams, and Carousels
function buildUnifiedMediaData(info, sourceUrl) {
    // Check if media payload contains a multiple entries dataset (Carousel)
    const rawEntries = info.entries || (info._type === 'playlist' ? info.requested_entries : null) || [];
    
    if (rawEntries.length > 0) {
        const entries = rawEntries.map((entry, index) => {
            const isVideo = entry.vcodec && entry.vcodec !== 'none';
            const ext = isVideo ? 'mp4' : 'jpg';
            return {
                title: entry.title || `Asset ${index + 1}`,
                thumbnail: entry.thumbnail || entry.url || '',
                url: entry.url || '',
                filename: `${sanitizeFilename(entry.title || `photo-${index + 1}`)}.${ext}`,
                formats: [{
                    quality: isVideo ? 'Video HD' : 'Photo HQ',
                    format: ext.toUpperCase(),
                    size: formatBytes(entry.filesize || entry.filesize_approx),
                    formatId: isVideo ? 'bv*[ext=mp4]+ba[ext=m4a]/bestvideo+bestaudio/best' : (entry.format_id || 'best')
                }]
            };
        });

        return {
            success: true,
            sourceUrl,
            title: info.title || 'Instagram Carousel',
            uploader: info.uploader || info.channel || '',
            entries
        };
    }

    // Context Evaluation for individual streams (Check if image or sound file)
    const isAudioOnly = info.acodec && info.acodec !== 'none' && (!info.vcodec || info.vcodec === 'none');
    const isImageOnly = info.vcodec === 'none' && (!info.acodec || info.acodec === 'none') && !info.url.includes('.mp4');
    
    let defaultExt = 'mp4';
    let label = 'Best Video';
    if (isAudioOnly) { defaultExt = 'mp3'; label = 'Audio MP3'; }
    else if (isImageOnly) { defaultExt = 'jpg'; label = 'High-Res Photo'; }

    const formats = [
        {
            quality: label,
            format: defaultExt.toUpperCase(),
            size: formatBytes(info.filesize || info.filesize_approx),
            formatId: (!isAudioOnly && !isImageOnly) ? 'bv*[ext=mp4]+ba[ext=m4a]/bestvideo+bestaudio/best' : (info.format_id || 'best')
        }
    ];

    return {
        success: true,
        sourceUrl,
        thumbnail: info.thumbnail || info.url || '',
        title: info.title || `Instagram ${defaultExt}`,
        uploader: info.uploader || info.channel || '',
        filename: `${sanitizeFilename(info.title)}.${defaultExt}`,
        url: info.url || '',
        formats
    };
}

function extractShortcode(url) {
    try {
        const parsed = new URL(url);
        const paths = parsed.pathname.split('/').filter(Boolean);
        if (paths.length >= 2 && ['p', 'reel', 'reels', 'tv', 'stories', 's'].includes(paths[0])) {
            if (paths[0] === 'stories') {
                return paths[2] || paths[1];
            }
            return paths[1];
        }
        if (paths.length > 0) {
            return paths[paths.length - 1];
        }
    } catch (e) {
        const match = url.match(/\/(?:p|reel|reels|tv|stories|s)\/([A-Za-z0-9_-]+)/);
        if (match) return match[1];
    }
    return null;
}

async function resolveInstagramGraphql(instagramUrl) {
    const shortcode = extractShortcode(instagramUrl);
    if (!shortcode) {
        throw new Error('Could not parse shortcode from Instagram URL');
    }
    
    const variables = {
        shortcode: shortcode,
        child_comment_count: 3,
        fetch_comment_count: 40,
        parent_comment_count: 24,
        has_threaded_comments: true
    };
    
    const queryParams = new URLSearchParams({
        doc_id: '8845758582119845',
        variables: JSON.stringify(variables)
    });
    
    const response = await fetch(`https://www.instagram.com/graphql/query/?${queryParams}`, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Origin': 'https://www.instagram.com',
            'Referer': instagramUrl
        }
    });
    
    if (!response.ok) {
        throw new Error(`Instagram API returned status ${response.status}`);
    }
    
    const data = await response.json();
    const media = data?.data?.xdt_shortcode_media;
    if (!media) {
        throw new Error('Instagram sent an empty response for this link. Ensure the post is public and exists.');
    }
    
    const caption = media.edge_media_to_caption?.edges?.[0]?.node?.text || '';
    const title = caption.split('\n')[0] || `Instagram post by ${media.owner?.username || 'user'}`;
    const uploader = media.owner?.full_name || media.owner?.username || '';
    const channel = media.owner?.username || '';
    
    const carouselMedia = media.edge_sidecar_to_children?.edges;
    if (carouselMedia && carouselMedia.length > 0) {
        const entries = carouselMedia.map((edge, index) => {
            const node = edge.node;
            const isVideo = node.is_video;
            return {
                title: node.accessibility_caption || `Asset ${index + 1}`,
                thumbnail: node.display_url || '',
                url: isVideo ? node.video_url : node.display_url,
                vcodec: isVideo ? 'h264' : 'none',
                acodec: isVideo ? 'aac' : 'none',
                format_id: 'best'
            };
        });
        
        return {
            _type: 'playlist',
            title: title || `Instagram Carousel by ${channel}`,
            uploader,
            channel,
            entries
        };
    }
    
    const isVideo = media.is_video;
    return {
        title: title || `Instagram media by ${channel}`,
        uploader,
        channel,
        thumbnail: media.display_url || media.thumbnail_src || '',
        url: isVideo ? media.video_url : media.display_url,
        vcodec: isVideo ? 'h264' : 'none',
        acodec: isVideo ? 'aac' : 'none',
        format_id: 'best'
    };
}

async function handleResolve(req, res, requestUrl) {
    try {
        const instagramUrl = parseInstagramUrl(requestUrl.searchParams.get('url') || '');
        let info;
        try {
            const output = await runYtDlp([
                '--dump-single-json',
                '--no-playlist',
                '--no-warnings',
                '--skip-download',
                instagramUrl
            ]);
            info = JSON.parse(output);
        } catch (ytdlpError) {
            // If it is a photo-only post or similar, yt-dlp fails with 'There is no video in this post'
            if (ytdlpError.message.includes('video') || ytdlpError.message.includes('no video') || ytdlpError.message.includes('ExtractorError')) {
                info = await resolveInstagramGraphql(instagramUrl);
            } else {
                throw ytdlpError;
            }
        }

        sendJson(res, 200, buildUnifiedMediaData(info, instagramUrl));
    } catch (error) {
        sendJson(res, 422, {
            success: false,
            error: error.message
        });
    }
}

async function handleDirectProxyDownload(req, res, targetUrl, filename) {
    try {
        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Referer': 'https://www.instagram.com/'
            }
        });

        if (!response.ok) {
            sendJson(res, 422, { success: false, error: `Failed to download media stream: status ${response.status}` });
            return;
        }

        const contentType = response.headers.get('content-type') || 'application/octet-stream';
        const safeFilename = sanitizeFilename(filename || 'instagram-download');

        res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Content-Disposition': `attachment; filename="${safeFilename}"`,
            'Content-Type': contentType
        });

        const reader = response.body.getReader();
        async function pump() {
            const { done, value } = await reader.read();
            if (done) {
                res.end();
                return;
            }
            res.write(Buffer.from(value));
            return pump();
        }
        await pump();
    } catch (error) {
        if (!res.headersSent) {
            sendJson(res, 500, { success: false, error: error.message });
        }
    }
}

function handleDownload(req, res, requestUrl) {
    let instagramUrl;

    try {
        instagramUrl = parseInstagramUrl(requestUrl.searchParams.get('url') || '');
    } catch (error) {
        // Fallback: If it's a direct CDN URL, proxy download it directly without yt-dlp
        const targetUrl = requestUrl.searchParams.get('url') || '';
        if (targetUrl.includes('.cdninstagram.com') || targetUrl.includes('.fbcdn.net') || targetUrl.includes('instagram.f') || targetUrl.includes('fbcdn-')) {
            handleDirectProxyDownload(req, res, targetUrl, requestUrl.searchParams.get('filename'));
            return;
        }
        sendJson(res, 422, { success: false, error: error.message });
        return;
    }

    let formatId = requestUrl.searchParams.get('format_id') || 'best';
    const requestedFilename = requestUrl.searchParams.get('filename') || 'instagram-download';
    // Use explicit 'type' param as the single source of truth — never guess from formatId strings
    const mediaType = requestUrl.searchParams.get('type') || 'video';
    const isAudio = mediaType === 'audio';

    // Evaluate downstream file type signatures
    let contentType = 'video/mp4';
    let filename = requestedFilename;

    if (isAudio) {
        contentType = 'audio/mpeg';
        if (!filename.toLowerCase().endsWith('.mp3')) filename += '.mp3';
    } else if (requestedFilename.toLowerCase().endsWith('.jpg') || requestedFilename.toLowerCase().endsWith('.jpeg')) {
        contentType = 'image/jpeg';
        if (!filename.toLowerCase().endsWith('.jpg')) filename += '.jpg';
    } else {
        if (!filename.toLowerCase().endsWith('.mp4')) filename += '.mp4';
    }

    const safeFilename = sanitizeFilename(filename);

    if (formatId.length > 120) {
        sendJson(res, 422, { success: false, error: 'Invalid media format reference.' });
        return;
    }

    // ── AUDIO: stream directly to stdout (MP3 doesn't need seekable output) ──
    if (isAudio) {
        const audioArgs = [
            '--no-playlist',
            '--no-warnings',
            '-f', 'ba[ext=m4a]/bestaudio/best',
            '--extract-audio',
            '--audio-format', 'mp3',
            '--audio-quality', '0',
            '-o', '-',
            instagramUrl
        ];

        const ytdlp = childProcess.spawn('yt-dlp', audioArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        let started = false;
        let responseClosed = false;
        const timer = setTimeout(() => { ytdlp.kill('SIGKILL'); }, DOWNLOAD_TIMEOUT_MS);

        res.on('close', () => {
            if (!res.writableEnded) { responseClosed = true; ytdlp.kill('SIGTERM'); }
        });
        ytdlp.stdout.on('data', (chunk) => {
            if (!started) {
                started = true;
                res.writeHead(200, {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Disposition': `attachment; filename="${safeFilename}"`,
                    'Content-Type': contentType
                });
            }
            res.write(chunk);
        });
        ytdlp.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
        ytdlp.on('error', (error) => {
            clearTimeout(timer);
            if (!started && !responseClosed) sendJson(res, 500, { success: false, error: error.message });
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
        return;
    }

    // ── VIDEO/IMAGE: write to temp dir first, then stream back ───────────────
    // MP4 muxing (merging separate video+audio DASH tracks via ffmpeg) requires
    // seekable output. Piping to stdout produces a corrupt moov atom that
    // QuickTime and most players reject. We write to a unique temp directory so
    // ffmpeg can finalise the container, then scan for the output file (yt-dlp
    // can silently change the extension, e.g. .mp4 → .mkv when muxing).
    const os = require('os');
    const tmpDir = path.join(os.tmpdir(), `igdl_${Date.now()}_${Math.random().toString(36).slice(2)}`);

    function cleanupTmpDir() {
        fs.rm(tmpDir, { recursive: true, force: true }, () => {});
    }

    if (formatId === 'best' || formatId === 'best[ext=mp4]/best') {
        formatId = 'bv*[ext=mp4]+ba[ext=m4a]/bestvideo+bestaudio/best';
    }

    fs.mkdir(tmpDir, { recursive: true }, (mkdirErr) => {
        if (mkdirErr) {
            sendJson(res, 500, { success: false, error: 'Could not create temp directory.' });
            return;
        }

        const videoArgs = [
            '--no-playlist',
            '--no-warnings',
            '-f', formatId,
            '--merge-output-format', 'mp4',
            '-o', path.join(tmpDir, 'video.%(ext)s'),
            instagramUrl
        ];

        const ytdlp = childProcess.spawn('yt-dlp', videoArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        let responseClosed = false;
        const timer = setTimeout(() => {
            ytdlp.kill('SIGKILL');
            cleanupTmpDir();
        }, DOWNLOAD_TIMEOUT_MS);

        res.on('close', () => {
            if (!res.writableEnded) {
                responseClosed = true;
                ytdlp.kill('SIGTERM');
                cleanupTmpDir();
            }
        });

        ytdlp.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });

        ytdlp.on('error', (error) => {
            clearTimeout(timer);
            cleanupTmpDir();
            if (!responseClosed) sendJson(res, 500, { success: false, error: error.message });
        });

        ytdlp.on('close', (code) => {
            clearTimeout(timer);
            if (responseClosed) return;

            if (code !== 0) {
                cleanupTmpDir();
                sendJson(res, 422, { success: false, error: cleanYtDlpError(stderr) });
                return;
            }

            // Scan the temp dir for whatever file yt-dlp created
            fs.readdir(tmpDir, (rdErr, files) => {
                if (rdErr || !files || files.length === 0) {
                    cleanupTmpDir();
                    sendJson(res, 500, { success: false, error: 'Downloaded file not found after processing.' });
                    return;
                }

                // Prefer .mp4, otherwise take the first file found
                const picked = files.find(f => f.endsWith('.mp4')) || files[0];
                const outFile = path.join(tmpDir, picked);

                fs.stat(outFile, (statErr, stat) => {
                    if (statErr) {
                        cleanupTmpDir();
                        sendJson(res, 500, { success: false, error: 'Failed to read downloaded file.' });
                        return;
                    }

                    res.writeHead(200, {
                        'Access-Control-Allow-Origin': '*',
                        'Content-Disposition': `attachment; filename="${safeFilename}"`,
                        'Content-Type': contentType,
                        'Content-Length': stat.size
                    });

                    const fileStream = fs.createReadStream(outFile);
                    fileStream.pipe(res);
                    fileStream.on('close', () => cleanupTmpDir());
                    fileStream.on('error', () => {
                        cleanupTmpDir();
                        if (!res.headersSent) sendJson(res, 500, { success: false, error: 'Stream error.' });
                        else res.end();
                    });
                });
            });
        });
    }); // end fs.mkdir
}


function handleThumbnail(req, res, requestUrl, redirectCount = 0) {
    let thumbnailUrl;

    try {
        thumbnailUrl = new URL(requestUrl.searchParams.get('url') || '');
    } catch (error) {
        sendJson(res, 422, { success: false, error: 'Invalid thumbnail URL.' });
        return;
    }

    if (!['http:', 'https:'].includes(thumbnailUrl.protocol)) {
        sendJson(res, 422, { success: false, error: 'Invalid thumbnail URL.' });
        return;
    }

    const client = thumbnailUrl.protocol === 'https:' ? https : http;
    const proxyRequest = client.get(thumbnailUrl, {
        headers: {
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
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
            sendJson(res, 422, { success: false, error: 'Could not load thumbnail.' });
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

const CLEAN_URL_MAP = {
    '/': '/index.html',
    '/contact': '/contact.html',
    '/privacy': '/privacy.html',
    '/terms': '/terms.html',
    '/dmca': '/dmca.html',
    '/ig-photo-dl': '/ig-photo-dl.html',
    '/ig-audio-dl': '/ig-audio-dl.html',
    '/ig-stories-dl': '/ig-stories-dl.html',
    '/faq': '/index.html'
};

function resolveCleanPath(pathname) {
    return CLEAN_URL_MAP[pathname] || null;
}

function isAllowedFlatFrontendPath(requestedPath) {
    return requestedPath === '/index.html'
        || requestedPath === '/contact.html'
        || requestedPath === '/privacy.html'
        || requestedPath === '/terms.html'
        || requestedPath === '/dmca.html'
        || requestedPath === '/ig-photo-dl.html'
        || requestedPath === '/ig-audio-dl.html'
        || requestedPath === '/ig-stories-dl.html'
        || requestedPath === '/sitemap.xml'
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

    let cleanPathname = requestUrl.pathname;
    if (cleanPathname.endsWith('.html')) {
        cleanPathname = cleanPathname.slice(0, -5);
        if (cleanPathname === '/index') {
            cleanPathname = '/';
        }
    }
    if (cleanPathname.length > 1 && cleanPathname.endsWith('/')) {
        cleanPathname = cleanPathname.slice(0, -1);
    }
    if (cleanPathname !== requestUrl.pathname) {
        res.writeHead(301, { Location: cleanPathname + (requestUrl.search || '') });
        res.end();
        return;
    }

    const cleanResolved = resolveCleanPath(requestUrl.pathname);
    if (cleanResolved) {
        requestUrl.pathname = cleanResolved;
    }

    serveStatic(req, res, requestUrl);
});

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use.`);
        process.exit(1);
    }
    throw error;
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Media Downloader core running on http://0.0.0.0:${PORT}`);
});