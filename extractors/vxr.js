// VixSrc Extractor - Extract stream from embed page HTML
const axios = require('axios');

/**
 * Extract video data from JavaScript variables in HTML
 */
function extractVideoData(html) {
    try {
        console.log('[VixSrc] Parsing JavaScript variables from HTML...');

        // Extract window.video
        const videoPattern = /window\.video\s*=\s*\{[^}]*id:\s*['"]([^'"]+)['"]/;
        const videoMatch = videoPattern.exec(html);
        const videoId = videoMatch?.[1];
        console.log(`[VixSrc] Extracted videoId: ${videoId}`);

        // Extract window.masterPlaylist with token, expires, and url
        const playlistPattern = /window\.masterPlaylist\s*=\s*\{[^}]*params:\s*\{[^}]*['"]token['"]\s*:\s*['"]([^'"]+)['"][^}]*['"]expires['"]\s*:\s*['"]([^'"]+)['"][^}]*\}[^}]*url:\s*['"]([^'"]+)['"]/s;
        const playlistMatch = playlistPattern.exec(html);
        const token = playlistMatch?.[1];
        const expires = playlistMatch?.[2];
        const url = playlistMatch?.[3];
        
        console.log(`[VixSrc] Extracted token: ${token ? token.substring(0, 20) + '...' : 'null'}`);
        console.log(`[VixSrc] Extracted expires: ${expires}`);
        console.log(`[VixSrc] Extracted url: ${url}`);

        // Extract window.canPlayFHD
        const fhdPattern = /window\.canPlayFHD\s*=\s*(true|false)/;
        const fhdMatch = fhdPattern.exec(html);
        const canPlayFHD = fhdMatch?.[1] === 'true';
        console.log(`[VixSrc] Extracted canPlayFHD: ${canPlayFHD}`);

        if (!videoId || !token || !expires || !url) {
            console.error('[VixSrc] Failed to extract required fields');
            console.error(`[VixSrc] videoId: ${videoId}, token: ${!!token}, expires: ${!!expires}, url: ${!!url}`);
            return null;
        }

        return {
            video: { id: videoId },
            masterPlaylist: {
                params: { token, expires },
                url
            },
            canPlayFHD
        };
    } catch (error) {
        console.error(`[VixSrc] Error parsing video data: ${error.message}`);
        return null;
    }
}

/**
 * Build streaming URL with query parameters
 */
function buildStreamUrl(videoData) {
    try {
        console.log('[VixSrc] Building stream URL...');
        
        const { masterPlaylist, canPlayFHD } = videoData;

        if (!masterPlaylist) {
            console.error('[VixSrc] masterPlaylist not found');
            return null;
        }

        const baseUrl = masterPlaylist.url;
        const params = masterPlaylist.params;

        if (!baseUrl || !params) {
            console.error('[VixSrc] baseUrl or params not found');
            return null;
        }

        const { token, expires } = params;

        if (!token || !expires) {
            console.error('[VixSrc] token or expires not found');
            return null;
        }

        // Build query parameters
        const queryParts = [
            `token=${encodeURIComponent(token)}`,
            `expires=${encodeURIComponent(expires)}`,
            'asn=',
            'lang=en'
        ];

        // Add HD flag if available
        if (canPlayFHD) {
            queryParts.push('h=1');
        }

        // Build final URL
        const separator = baseUrl.includes('?') ? '&' : '?';
        const finalUrl = baseUrl + separator + queryParts.join('&');

        console.log(`[VixSrc] Built stream URL: ${finalUrl.substring(0, 100)}...`);
        return finalUrl;
    } catch (error) {
        console.error(`[VixSrc] Error building stream URL: ${error.message}`);
        return null;
    }
}

/**
 * Extract stream from VixSrc
 * For movies: https://vixsrc.to/movie/{movieId}/
 * For TV shows: https://vixsrc.to/tv/{showId}/{season}/{episode}/
 */
async function extractVixSrc({ id, type, season, episode }) {
    try {
        console.log('\n[VixSrc] Starting extraction...');
        console.log(`[VixSrc] Parameters: id=${id}, type=${type}, season=${season}, episode=${episode}`);

        // Build embed URL
        let embedUrl;
        if (type === 'movie') {
            embedUrl = `https://vixsrc.to/movie/${id}/`;
            console.log('[VixSrc] Movie detected');
        } else if (type === 'tv' && season && episode) {
            embedUrl = `https://vixsrc.to/tv/${id}/${season}/${episode}/`;
            console.log(`[VixSrc] TV show detected: season=${season}, episode=${episode}`);
        } else {
            throw new Error('Invalid parameters: type must be movie or tv (with season/episode for tv)');
        }

        console.log(`[VixSrc] Loading embed page: ${embedUrl}`);

        // Load the embed page HTML
        const response = await axios.get(embedUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://vixsrc.to/'
            },
            timeout: 10000
        });

        if (response.status !== 200) {
            console.error(`[VixSrc] Failed to load page: ${response.status}`);
            return {
                server: 'vixsrc',
                streams: [],
                error: `Failed to load page: ${response.status}`
            };
        }

        const html = response.data;
        console.log(`[VixSrc] Page loaded (${html.length} bytes), parsing...`);

        // Extract video metadata from JavaScript
        const videoData = extractVideoData(html);
        if (!videoData) {
            console.error('[VixSrc] Failed to extract video data from page');
            return {
                server: 'vixsrc',
                streams: [],
                error: 'Failed to extract video data from page'
            };
        }

        console.log('[VixSrc] Extracted video data successfully');

        // Build streaming URL with query parameters
        const streamUrl = buildStreamUrl(videoData);
        if (!streamUrl) {
            console.error('[VixSrc] Failed to build stream URL');
            return {
                server: 'vixsrc',
                streams: [],
                error: 'Failed to build stream URL'
            };
        }

        // Build headers for video playback
        const headers = {
            'Referer': embedUrl,
            'Origin': 'https://vixsrc.to',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Connection': 'keep-alive'
        };

        console.log('[VixSrc] Extraction successful!');

        return {
            server: 'vixsrc',
            streams: [{
                file: streamUrl,
                title: 'VixSrc Stream',
                quality: 'HD',
                type: 'hls',
                headers
            }]
        };

    } catch (error) {
        console.error(`[VixSrc] Error caught: ${error.message}`);
        console.error(`[VixSrc] Error code: ${error.code}`);
        
        return {
            server: 'vixsrc',
            streams: [],
            error: `Failed to extract streams: ${error.message}`
        };
    }
}

module.exports = { extractVixSrc };
