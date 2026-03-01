const express = require('express');
const cors = require('cors');
const path = require('path');
const { extractVixSrc } = require('./extractors/vxr');

const app = express();
const PORT = process.env.PORT || 3005;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files
app.use(express.static(__dirname));

// Available extractors
const extractors = {
    vixsrc: extractVixSrc
};

// Utility function to extract from multiple servers
async function extractFromServers(params, serverNames) {
    const results = [];

    for (const serverName of serverNames) {
        if (extractors[serverName]) {
            try {
                const result = await extractors[serverName](params);
                results.push(result);
            } catch (error) {
                results.push({
                    server: serverName,
                    streams: [],
                    error: error.message
                });
            }
        }
    }

    return results;
}

// API Routes with /api prefix for Vercel
app.get('/api/movie/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { server = 'all' } = req.query;

        if (!id) {
            return res.status(400).json({ error: 'Missing id parameter' });
        }

        const params = { id, type: 'movie' };
        let serverNames = [];

        if (server === 'all') {
            serverNames = Object.keys(extractors);
        } else if (extractors[server]) {
            serverNames = [server];
        } else {
            return res.status(400).json({
                error: `Invalid server: ${server}. Available: ${Object.keys(extractors).join(', ')}, all`
            });
        }

        const results = await extractFromServers(params, serverNames);

        // Build response with all servers
        const response = {
            type: 'movie',
            id,
            query: { server }
        };

        // Add each server's result
        results.forEach(result => {
            response[result.server] = {
                streams: result.streams || [],
                ...(result.error && { error: result.error })
            };
        });

        // Count servers with positive responses
        const serversWithStreams = results.filter(r => (r.streams || []).length > 0).length;
        response.totalServersWithStreams = serversWithStreams;
        response.totalStreamsFound = results.reduce((acc, r) => acc + (r.streams || []).length, 0);

        return res.json(response);

    } catch (error) {
        console.error('Movie endpoint error:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

// TV show endpoint with /api prefix
app.get('/api/tv/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { season, episode, server = 'all' } = req.query;

        if (!id) {
            return res.status(400).json({ error: 'Missing id parameter' });
        }

        if (!season || !episode) {
            return res.status(400).json({ error: 'Missing season or episode parameters' });
        }

        const params = { id, type: 'tv', season, episode };
        let serverNames = [];

        if (server === 'all') {
            serverNames = Object.keys(extractors);
        } else if (extractors[server]) {
            serverNames = [server];
        } else {
            return res.status(400).json({
                error: `Invalid server: ${server}. Available: ${Object.keys(extractors).join(', ')}, all`
            });
        }

        const results = await extractFromServers(params, serverNames);

        // Build response with all servers
        const response = {
            type: 'tv',
            id,
            season,
            episode,
            query: { server }
        };

        // Add each server's result
        results.forEach(result => {
            response[result.server] = {
                streams: result.streams || [],
                ...(result.error && { error: result.error })
            };
        });

        // Count servers with positive responses
        const serversWithStreams = results.filter(r => (r.streams || []).length > 0).length;
        response.totalServersWithStreams = serversWithStreams;
        response.totalStreamsFound = results.reduce((acc, r) => acc + (r.streams || []).length, 0);

        return res.json(response);

    } catch (error) {
        console.error('TV endpoint error:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        availableServers: Object.keys(extractors),
        environment: process.env.VERCEL ? 'production' : 'development'
    });
});

// API documentation
app.get('/api', (req, res) => {
    const baseUrl = process.env.VERCEL_URL 
        ? `https://${process.env.VERCEL_URL}`
        : `${req.protocol}://${req.get('host')}`;

    res.json({
        title: '🎬 LumiFlix API',
        description: 'Stream extraction API for movies and TV shows',
        version: '1.0.0',
        baseUrl: `${baseUrl}/api`,
        status: 'active',
        availableServers: Object.keys(extractors),
        endpoints: {
            movies: '/api/movie/:id',
            tvshows: '/api/tv/:id?season=X&episode=Y',
            health: '/api/health'
        }
    });
});

// Also support non-prefixed routes for backward compatibility
app.get('/movie/:id', (req, res) => {
    req.url = `/api/movie/${req.params.id}${req.url.includes('?') ? '?' + req.url.split('?')[1] : ''}`;
    app._router.handle(req, res);
});

app.get('/tv/:id', (req, res) => {
    req.url = `/api/tv/${req.params.id}${req.url.includes('?') ? '?' + req.url.split('?')[1] : ''}`;
    app._router.handle(req, res);
});

app.get('/health', (req, res) => {
    req.url = '/api/health';
    app._router.handle(req, res);
});

// Root endpoint - serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Not found',
        message: 'Visit /api for API documentation',
        availableEndpoints: {
            'GET /': 'Web interface',
            'GET /api': 'API documentation',
            'GET /api/movie/:id': 'Get movie streams',
            'GET /api/tv/:id': 'Get TV show streams',
            'GET /api/health': 'Health check'
        }
    });
});

// Export for Vercel serverless
if (process.env.VERCEL) {
    module.exports = app;
} else {
    // Start server locally
    app.listen(PORT, () => {
        console.log(`✓ LumiFlix server running on http://localhost:${PORT}`);
        console.log(`✓ Available servers: ${Object.keys(extractors).join(', ')}`);
        console.log(`\nExample requests:`);
        console.log(`  GET http://localhost:${PORT}/api/movie/12345`);
        console.log(`  GET http://localhost:${PORT}/api/tv/12345?season=1&episode=1`);
        console.log(`  GET http://localhost:${PORT}/api/health`);
    });
}