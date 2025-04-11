# Summify Backend

This is the backend service for Summify, a powerful content summarization tool using Claude by Anthropic.

## Features

- Summarize large technical documents and code
- Server-side streaming with SSE (Server-Sent Events)
- Intelligent chunking for large documents
- Advanced parallel processing with dynamic worker pool
- Rate limiting to prevent API throttling
- Robust error handling and retry logic

## Setup

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Create a `.env` file (see Environment Variables section below)
4. Start the server:
   ```
   npm start
   ```

For development with auto-reload:
```
npm run dev
```

## Environment Variables

Create a `.env` file with the following variables:

```
# Anthropic API key (required)
ANTHROPIC_API_KEY=sk-ant-...

# Server settings
PORT=3001

# CORS settings (comma-separated list of allowed origins)
FRONTEND_URL=http://localhost:3000,http://localhost:3008

# Parallel processing configuration
MAX_CHUNK_SIZE=15000
MAX_PARALLEL_CHUNKS=10
MAX_WORKER_POOL_SIZE=10
MAX_CONCURRENT_REQUESTS=25
API_REQUESTS_PER_MINUTE=100
MAX_RETRIES=3
REQUEST_TIMEOUT=60000
```

## Advanced Parallel Processing

The backend uses a sophisticated worker pool and task queue system to process large documents efficiently:

- **Dynamic Worker Pool**: Automatically scales workers based on system load
- **Task Queue**: Prioritizes tasks based on importance and retry status
- **Rate Limiting**: Prevents API rate limit errors by throttling requests
- **Adaptive Parallelism**: Adjusts concurrency based on document size and system capacity
- **Error Resilience**: Automatic retries with exponential backoff

You can configure the parallel processing system through environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| MAX_CHUNK_SIZE | Maximum size of text chunks (in characters) | 15000 |
| MAX_PARALLEL_CHUNKS | Maximum chunks to process in parallel | 10 |
| MAX_WORKER_POOL_SIZE | Initial number of workers in the pool | 10 |
| MAX_CONCURRENT_REQUESTS | Maximum concurrent API requests | 25 |
| API_REQUESTS_PER_MINUTE | Maximum API requests per minute | 100 |
| MAX_RETRIES | Maximum retry attempts for failed requests | 3 |
| REQUEST_TIMEOUT | Timeout for API requests (milliseconds) | 60000 |

## API Endpoints

### Health Check
```
GET /health
```
Returns basic health status of the server.

### System Status
```
GET /api/status
```
Returns detailed status of the worker pool, rate limiter, and system resources.

### Create Session
```
POST /api/create-session
```
Body: `{ "text": "content to summarize" }`

Creates a new session for summarization and returns a session ID.

### Summarize (Streaming)
```
GET /api/summarize-stream?sessionId=SESSION_ID
```
Streams summarization progress and results using Server-Sent Events (SSE).

### Legacy Summarize (Deprecated)
```
GET /api/summarize?userText=ENCODED_TEXT
```
Legacy endpoint that redirects to the streaming endpoint (limited text size).

## Architecture

The summarization process follows these steps:

1. Content is chunked into manageable pieces
2. Chunks are processed in parallel through the worker pool
3. Each chunk is summarized by Claude API with intelligent retry logic
4. Individual summaries are combined into a meta-summary
5. Progress is streamed to the client in real-time

## Performance Optimization

For best performance with large documents:

1. Increase `MAX_WORKER_POOL_SIZE` if you have sufficient system resources
2. Adjust `API_REQUESTS_PER_MINUTE` based on your API rate limits
3. Increase `MAX_PARALLEL_CHUNKS` for faster processing (requires more memory)
4. Set `REQUEST_TIMEOUT` higher for very large chunks 