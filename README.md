# Stream Extractor Server

A multi-server stream extractor for movies and TV shows built with Express.js.

## Features

- ✅ Extract streams from multiple sources (VXR, Vidrock, Videasy, Vidzee, Vidsrc and Primesrc)
- ✅ Support for movies and TV shows
- ✅ Query specific server or all servers
- ✅ JSON responses
- ✅ CORS enabled
- ✅ Easy to add new extractors

## Installation

```bash
npm install
```

## Usage

Start the server:

```bash
npm start
```

Or with auto-reload (requires nodemon):

```bash
npm run dev
```

Server will run on `http://localhost:3000` by default.

## API Endpoints

### Get Movie Streams

```
GET /movie/:id[?server=all|vxr|vidrock]
```

**Example:**
```
GET http://localhost:3000/movie/12345
GET http://localhost:3000/movie/12345?server=vxr
GET http://localhost:3000/movie/12345?server=all
```

**Response:**
```json
{
  "type": "movie",
  "id": "12345",
  "query": { "server": "all" },
  "results": [
    {
      "server": "vxr",
      "streams": [
        {
          "file": "https://example.com/stream.m3u8",
          "title": "VXR",
          "quality": "HD",
          "type": "hls"
        }
      ]
    }
  ],
  "totalFound": 1,
  "allResults": [...]
}
```

### Get TV Show Streams

```
GET /tv/:id?season=X&episode=Y[&server=all|vxr|vidrock]
```

**Example:**
```
GET http://localhost:3000/tv/12345?season=1&episode=1
GET http://localhost:3000/tv/12345?season=2&episode=5&server=vidrock
GET http://localhost:3000/tv/12345?season=1&episode=1&server=all
```

**Response:**
```json
{
  "type": "tv",
  "id": "12345",
  "season": "1",
  "episode": "1",
  "query": { "server": "all" },
  "results": [...],
  "totalFound": 2,
  "allResults": [...]
}
```

### Health Check

```
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "availableServers": ["vxr", "vidrock"],
  "endpoints": {
    "movie": "/movie/:id?server=all|vxr|vidrock",
    "tv": "/tv/:id?season=1&episode=1&server=all|vxr|vidrock",
    "health": "/health"
  }
}
```

## Query Parameters

### Movie Endpoint

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Movie ID |
| `server` | string | No | Server name: `all`, `vxr`, `vidrock`. Default: `all` |

### TV Show Endpoint

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | TV show ID |
| `season` | number | Yes | Season number |
| `episode` | number | Yes | Episode number |
| `server` | string | No | Server name: `all`, `vxr`, `vidrock`. Default: `all` |

## Adding New Extractors

1. Create a new file in `extractors/` folder:

```javascript
// extractors/myserver.js
async function extractMyServer({ id, type, season, episode }) {
    try {
        // Your extraction logic here
        return {
            server: 'myserver',
            streams: [
                {
                    file: 'https://example.com/stream.m3u8',
                    title: 'My Server',
                    quality: 'HD',
                    type: 'hls'
                }
            ]
        };
    } catch (error) {
        return {
            server: 'myserver',
            streams: [],
            error: error.message
        };
    }
}

module.exports = { extractMyServer };
```

2. Register it in `server.js`:

```javascript
const { extractMyServer } = require('./extractors/myserver');

const extractors = {
    vxr: extractVXR,
    vidrock: extractVidrock,
    myserver: extractMyServer  // Add this line
};
```

3. Now use it in requests:
```
GET http://localhost:3000/movie/12345?server=myserver
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |

## Error Handling

All errors return JSON responses:

```json
{
  "error": "Error message",
  "details": "Additional details"
}
```

HTTP Status Codes:
- `200` - Success
- `400` - Bad request (missing parameters)
- `404` - Not found
- `500` - Internal server error
