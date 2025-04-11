const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { Anthropic } = require('@anthropic-ai/sdk');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Increase server timeout for handling large documents
const SERVER_TIMEOUT = 10 * 60 * 1000; // 10 minutes
app.timeout = SERVER_TIMEOUT;

// Parse FRONTEND_URL for CORS settings
const allowedOrigins = process.env.FRONTEND_URL 
  ? process.env.FRONTEND_URL.split(',').map(origin => origin.trim())
  : ['http://localhost:3000', 'http://localhost:3008', 'http://127.0.0.1:3000', 'http://127.0.0.1:3008'];

// Check if we're in development mode
const isDevelopment = process.env.NODE_ENV !== 'production';

// Middleware
app.use(cors({
  origin: function(origin, callback) {
    // For development/debugging - log the origin
    console.log(`Received request from origin: ${origin || 'null/undefined'}`);
    
    // In development mode, allow all origins
    if (isDevelopment) {
      return callback(null, true);
    }
    
    // Allow requests with no origin (like mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`Origin ${origin} not allowed by CORS policy. Allowed origins: ${allowedOrigins.join(', ')}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Increase body size limit to handle larger documents
app.use(express.json({ limit: '100mb' })); // Increased limit for very large texts
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Constants and configuration
const MAX_CHUNK_SIZE = process.env.MAX_CHUNK_SIZE ? 
  parseInt(process.env.MAX_CHUNK_SIZE) : 15000;

// Advanced parallel processing configuration
const MAX_PARALLEL_CHUNKS = process.env.MAX_PARALLEL_CHUNKS ? 
  parseInt(process.env.MAX_PARALLEL_CHUNKS) : 10; // Default to 10 instead of 3

// Worker pool configuration
const MAX_WORKER_POOL_SIZE = process.env.MAX_WORKER_POOL_SIZE ? 
  parseInt(process.env.MAX_WORKER_POOL_SIZE) : 10;

const MAX_CONCURRENT_REQUESTS = process.env.MAX_CONCURRENT_REQUESTS ? 
  parseInt(process.env.MAX_CONCURRENT_REQUESTS) : 25;

// Rate limiting configuration
const API_REQUESTS_PER_MINUTE = process.env.API_REQUESTS_PER_MINUTE ? 
  parseInt(process.env.API_REQUESTS_PER_MINUTE) : 100;

// Retry configuration
const MAX_RETRIES = process.env.MAX_RETRIES ? 
  parseInt(process.env.MAX_RETRIES) : 3;

// Timeout configuration (in milliseconds)
const REQUEST_TIMEOUT = process.env.REQUEST_TIMEOUT ? 
  parseInt(process.env.REQUEST_TIMEOUT) : 60000; // 1 minute default

// Log configuration values
console.log('Server configuration:');
console.log(`- MAX_CHUNK_SIZE: ${MAX_CHUNK_SIZE}`);
console.log(`- MAX_PARALLEL_CHUNKS: ${MAX_PARALLEL_CHUNKS}`);
console.log(`- MAX_WORKER_POOL_SIZE: ${MAX_WORKER_POOL_SIZE}`);
console.log(`- MAX_CONCURRENT_REQUESTS: ${MAX_CONCURRENT_REQUESTS}`);
console.log(`- API_REQUESTS_PER_MINUTE: ${API_REQUESTS_PER_MINUTE}`);
console.log(`- MAX_RETRIES: ${MAX_RETRIES}`);
console.log(`- REQUEST_TIMEOUT: ${REQUEST_TIMEOUT}ms`);

// Prompts used for summarization
const SYSTEM_PROMPT = `You are an AI Technical Content Summarizer specializing in making complex code and documentation immediately useful to developers.

Your task is to analyze technical content and create a summary that maximizes developer productivity. Focus on what's actually important for implementation, not theoretical descriptions.

For your output, follow this structure:
1. "## TL;DR" - 2-3 sentence executive summary
2. "## Core Components" - Identify key classes, functions, modules, or concepts with brief explanations of their purpose
3. "## Implementation Guide" - Step-by-step instructions for implementing or using the technology
4. "## Dependencies & Prerequisites" - Required libraries, services, environment setup
5. "## Key Design Patterns & Architecture" - Notable patterns, data flows, or architectural decisions
6. "## Gotchas & Edge Cases" - Common errors, pitfalls, limitations, and how to avoid them
7. "## Debugging & Troubleshooting" - How to diagnose and fix common issues
8. "## Performance Considerations" - Bottlenecks, optimization opportunities, scaling concerns

Keep explanations concise and code-focused. Prioritize actual implementation details over general descriptions.`;

// Specialized prompt for code
const CODE_SUMMARY_PROMPT = `Analyze the following code and create a practical, implementation-focused summary.

Focus on the following developer needs:
- Entry points and execution flow: Where should I start reading?
- Key functions and classes: What does each main component actually do?
- Data structures and state management: How is data transformed and stored?
- Integration points: How does this connect with other systems or libraries?
- Error handling: How are exceptions and edge cases handled?
- Configuration: What can be customized and how?
- Performance implications: Are there bottlenecks or optimization opportunities?
- Dependencies: What external libraries or services are required?
- Testing approach: How can this code be properly tested?
- Security considerations: Are there potential vulnerabilities or authentication requirements?

Look for:
- Unclear or complex logic that needs explanation
- Undocumented assumptions or requirements
- Subtle bugs or edge cases
- Advanced patterns that might be unfamiliar

For project managers, highlight:
- Maintenance challenges and technical debt
- Areas where documentation is missing
- Components that might be difficult to extend

Format your response according to the structured sections in the system prompt.

For example, if given this Express.js route handler:

\`\`\`javascript
app.post('/api/users', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    // Validate input
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ error: 'User already exists' });
    }
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Create user
    const user = new User({
      username,
      email,
      password: hashedPassword
    });
    
    await user.save();
    
    // Generate JWT
    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    
    res.status(201).json({
      message: 'User created successfully',
      token
    });
  } catch (err) {
    console.error('Error creating user:', err);
    res.status(500).json({ error: 'Server error' });
  }
});
\`\`\`

Your response should look like:

\`\`\`
## TL;DR
This is an Express.js route handler for user registration that validates inputs, checks for duplicate users, securely stores passwords, and returns a JWT authentication token upon successful creation.

## Core Components
- **Route handler**: POST endpoint at '/api/users' for user registration
- **Input validation**: Simple check for required fields
- **User model**: MongoDB schema with username, email, and password fields
- **Password security**: Uses bcrypt for password hashing
- **Authentication**: JWT token generation upon successful registration

## Implementation Guide
1. Ensure MongoDB connection is established
2. Configure JWT_SECRET in environment variables
3. Import required dependencies: Express, User model, bcrypt, jwt
4. Add this route handler to your Express app
5. Connect to authentication middleware for protected routes

## Dependencies & Prerequisites
- Express.js
- MongoDB with mongoose
- bcrypt for password hashing
- jsonwebtoken for JWT generation
- Environment variable for JWT_SECRET

## Key Design Patterns & Architecture
- MVC pattern: Controller logic separated from User model
- REST API design for user creation
- Stateless authentication using JWT

## Gotchas & Edge Cases
- No email format validation implemented
- No password strength requirements
- Duplicate users only checked by email, not username
- Error handling captures all errors with generic 500 response

## Debugging & Troubleshooting
- JWT issues: Check environment variable is properly set
- User creation failures: Check MongoDB connection and indexes
- 409 errors indicate duplicate email addresses
- Console logs errors but with minimal details

## Performance Considerations
- Password hashing is CPU-intensive; bcrypt salt rounds affect performance
- No rate limiting implemented for registration attempts
- JWT generation is relatively lightweight
\`\`\`
`;

// Specialized prompt for documentation
const DOCS_SUMMARY_PROMPT = `Review the following technical documentation and create a practical implementation guide.

Focus on the following:
- Prerequisites and setup: What do I need to have installed or configured first?
- Essential concepts: What core ideas must I understand before using this?
- Step-by-step implementation: What are the exact steps to implement this technology?
- Configuration options: What settings can be customized?
- Authentication and security: How do I handle access control?
- API usage patterns: What are the common request/response patterns?
- Error handling: How should errors be managed?
- Resource requirements: What are the hardware/software requirements?
- Limitations: What are the known constraints or limitations?
- Best practices: What approaches are recommended by experts?

Look for:
- Missing steps or assumptions in guides
- Outdated information or deprecated features
- Undocumented features or "hidden" functionality
- Practical examples that demonstrate actual usage
- Inconsistencies or contradictions

For project managers, highlight:
- Integration complexity and dependencies
- Potential implementation challenges
- Timeline considerations for implementation
- Maintenance and operational considerations

Format your response according to the structured sections in the system prompt.

For example, if given this authentication documentation:

\`\`\`markdown
# Authentication API Guide

Our authentication service allows you to implement secure login and registration for your applications.

## Getting Started

To begin using the Authentication API, you'll need to:
1. Sign up for an API key at https://api.example.com/signup
2. Install our client library with npm: \`npm install @example/auth-client\`

## API Methods

### Register User
\`\`\`js
auth.register({
  email: "user@example.com",
  password: "securePassword123",
  name: "John Doe"
})
\`\`\`

Returns a user object and session token on success.

### Login User
\`\`\`js
auth.login({
  email: "user@example.com",
  password: "securePassword123"
})
\`\`\`

Returns a session token that expires after 24 hours.

### Verify Token
\`\`\`js
auth.verify(token)
\`\`\`

Returns user information if the token is valid.

## Security Considerations

- All API calls should be made over HTTPS
- Tokens should be stored securely and not exposed to client-side JavaScript
- Implement CSRF protection for production applications
\`\`\`

Your response should look like:

\`\`\`
## TL;DR
A simple authentication API that provides user registration, login, and token verification through a JavaScript client library, requiring minimal setup but needing additional security measures for production use.

## Core Components
- **Auth Client Library**: JavaScript wrapper for authentication endpoints
- **Registration**: Creates new user accounts and returns session tokens
- **Login**: Authenticates existing users and generates tokens
- **Token Verification**: Validates tokens and retrieves user information

## Implementation Guide
1. Sign up at https://api.example.com/signup to get your API key
2. Install the client library: \`npm install @example/auth-client\`
3. Initialize the client with your API key (not shown in docs)
4. Implement registration form and call \`auth.register()\` with user details
5. Implement login form and call \`auth.login()\` with credentials
6. Store returned token securely (HTTP-only cookies recommended)
7. Use \`auth.verify(token)\` to validate user sessions

## Dependencies & Prerequisites
- Node.js environment
- npm package manager
- HTTPS-enabled server for production
- API key from the service

## Key Design Patterns & Architecture
- REST API with token-based authentication
- Stateless authentication model
- Client-side library abstracts API calls

## Gotchas & Edge Cases
- No mention of token refresh mechanism for expired tokens
- No details on password requirements or validation
- Missing error handling examples
- No information on rate limiting or account lockouts
- Unclear if the API key should be included in requests or just for initialization

## Debugging & Troubleshooting
- No troubleshooting section included in documentation
- No error codes or common issues documented
- No logging recommendations provided

## Performance Considerations
- Session tokens expire after 24 hours requiring re-login
- No information on API rate limits or quotas
- No caching strategy mentioned for token verification
\`\`\`
`;

// Optimized general summarization prompt
const SUMMARY_PROMPT = `Analyze the following technical content and create a practical summary optimized for developers who need to implement or use this technology quickly.

First, determine if this is primarily CODE or DOCUMENTATION:
- If CODE: ${CODE_SUMMARY_PROMPT}
- If DOCUMENTATION: ${DOCS_SUMMARY_PROMPT}

Your goal is to save developers time by extracting actionable insights and implementation details.`;

// Meta-summarization prompt
const META_SUMMARY_PROMPT = `Synthesize these section summaries into a unified technical summary that prioritizes developer implementation needs.

Guidelines:
1. Create a "## TL;DR" section that captures the most important aspects in 2-3 sentences
2. Consolidate all important implementation steps into a clear workflow
3. Combine related concepts and components from different sections
4. Highlight dependencies and prerequisites upfront
5. Organize gotchas and debugging info by component/feature 
6. Maintain code examples that demonstrate key functionality
7. Include a "Developer Workflow" section showing the typical development sequence
8. Preserve important warnings and limitations
9. If sections conflict, note the discrepancy and suggest the most reliable approach

For multiple sections that describe the same system:
- Merge complementary information
- Reconcile contradictory information by indicating what appears most current
- Organize information by feature/component rather than by source document

Below are summaries of different sections of the content. Create a cohesive, unified summary that a developer could use for implementation.

For example, if given these section summaries:

Section 1:
\`\`\`
## TL;DR
The API client provides authentication and user management features through a RESTful interface.

## Core Components
- Authentication module with login/logout
- User management for CRUD operations
- Role-based access control
\`\`\`

Section 2:
\`\`\`
## TL;DR
Server-side configuration and deployment options for the authentication system.

## Implementation Guide
1. Install dependencies
2. Configure database connection
3. Set up environment variables
\`\`\`

Your consolidated response should look like:

\`\`\`
## TL;DR
A complete authentication system with both client and server components providing user management, role-based access, and RESTful APIs requiring proper database setup and environment configuration.

## Core Components
- **Authentication Module**: Handles login/logout operations through RESTful APIs
- **User Management**: CRUD operations for user accounts
- **Access Control**: Role-based permissions system
- **Server Configuration**: Database connection and environment settings

## Implementation Guide
1. **Setup & Prerequisites**:
   - Install dependencies
   - Configure database connection
   - Set up environment variables

2. **Developer Workflow**:
   - Configure server authentication settings
   - Implement client-side authentication calls
   - Add user management features
   - Implement role-based access control

## Dependencies & Prerequisites
- Database system (details from both sections)
- Server environment requirements
- Client library dependencies

(Additional consolidated sections following the same pattern...)
\`\`\`
`;

// Helper functions
// Function to get optimal chunk size based on text length
function getOptimalChunkSize(textLength) {
  // Claude 3.5 Haiku can handle ~50K tokens (approximately 200K characters)
  const MAX_SAFE_CHARS = 180000; // Stay under the model's limit
  
  // Small documents should be processed as a single chunk
  // This avoids unnecessary multi-chunk processing for small docs
  if (textLength <= MAX_SAFE_CHARS) {
    console.log(`Document fits in a single chunk (${textLength} chars)`);
    return textLength; // Process as a single chunk
  } else if (textLength <= MAX_SAFE_CHARS * 2) {
    // For texts up to 2x the limit, use 2 evenly sized chunks
    console.log(`Splitting document into 2 chunks (${textLength} chars)`);
    return Math.ceil(textLength / 2);
  } else {
    // For large documents, use the maximum safe chunk size
    console.log(`Large document, using maximum chunk size (${textLength} chars)`);
    return MAX_SAFE_CHARS;
  }
}

/**
 * Breaks text into chunks of approximately the specified size
 * Tries to break at meaningful boundaries (paragraphs, sentences, or code blocks)
 * OPTIMIZATION: Prioritizes having a single chunk or avoiding meta-summary (<=4 chunks)
 */
function chunkText(text, maxChunkSize = MAX_CHUNK_SIZE) {
  // If text is already small enough, return it as a single chunk
  if (text.length <= maxChunkSize) {
    console.log(`Text fits in a single chunk (${text.length} chars)`);
    return [text];
  }
  
  // For small to medium docs that would produce just 2-3 chunks,
  // try to fit them in a single chunk if possible to avoid meta-summary
  if (text.length <= 50000) {
    console.log(`Small document (${text.length} chars) - processing as single chunk to avoid meta-summary`);
    return [text]; // Force as single chunk for small docs
  }
  
  // Regular chunking logic for larger documents
  // Calculate optimal chunk size based on text length
  const optimalChunkSize = getOptimalChunkSize(text.length);
  const effectiveChunkSize = Math.min(maxChunkSize, optimalChunkSize);
  
  const chunks = [];
  let currentIndex = 0;
  
  // Look for code block and markdown section markers
  const codeBlockRegex = /```[\s\S]*?```/g;
  const headerRegex = /^#{1,6}\s+.+$/gm;
  const codeBlocks = [];
  const headers = [];
  
  // Find code blocks to avoid splitting them
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    codeBlocks.push({
      start: match.index,
      end: match.index + match[0].length
    });
  }
  
  // Find markdown headers for potential chunk boundaries
  while ((match = headerRegex.exec(text)) !== null) {
    headers.push(match.index);
  }

  while (currentIndex < text.length) {
    // Determine end of this chunk
    let endIndex = Math.min(currentIndex + effectiveChunkSize, text.length);
    let bestBoundary = endIndex;
    let boundaryQuality = 0;
    
    // Don't break in the middle of a code block
    for (const block of codeBlocks) {
      if (currentIndex < block.end && endIndex > block.start && endIndex < block.end) {
        // We're about to cut through a code block, move to its end
        endIndex = block.end;
        break;
      }
    }
    
    // Try to find the best boundary near our target end point
    if (endIndex < text.length) {
      // Check for section headers first (highest priority)
      const nearbyHeaders = headers.filter(h => 
        h > currentIndex && 
        h < endIndex && 
        h > endIndex - 500
      );
      
      if (nearbyHeaders.length > 0) {
        bestBoundary = nearbyHeaders[0];
        boundaryQuality = 4; // Highest quality break
      }
      
      // Look for paragraph breaks (high priority if no good header)
      if (boundaryQuality < 4) {
        const paragraphBreak = text.lastIndexOf('\n\n', endIndex);
        if (paragraphBreak > currentIndex && paragraphBreak > endIndex - 500) {
          bestBoundary = paragraphBreak + 2; // Include the newlines
          boundaryQuality = 3;
        }
      }
      
      // Look for single newline (medium priority)
      if (boundaryQuality < 3) {
        const lineBreak = text.lastIndexOf('\n', endIndex);
        if (lineBreak > currentIndex && lineBreak > endIndex - 300) {
          bestBoundary = lineBreak + 1;
          boundaryQuality = 2;
        }
      }
      
      // Look for sentence end (lowest priority)
      if (boundaryQuality < 2) {
        const sentenceEnders = ['. ', '! ', '? ', '.\n', '!\n', '?\n'];
        let bestSentenceEnd = -1;
        
        for (const ender of sentenceEnders) {
          const sentenceEnd = text.lastIndexOf(ender, endIndex);
          if (sentenceEnd > bestSentenceEnd && sentenceEnd > currentIndex && sentenceEnd > endIndex - 200) {
            bestSentenceEnd = sentenceEnd;
          }
        }
        
        if (bestSentenceEnd > 0) {
          // Include the sentence ender
          const ender = text.substring(bestSentenceEnd, bestSentenceEnd + 2);
          bestBoundary = bestSentenceEnd + ender.length;
          boundaryQuality = 1;
        }
      }
      
      // Use the best boundary if we found one
      if (boundaryQuality > 0) {
        endIndex = bestBoundary;
      }
    }

    chunks.push(text.substring(currentIndex, endIndex));
    currentIndex = endIndex;
  }

  // OPTIMIZATION: Merge very small chunks with the previous chunk
  // This prevents wasted API calls on tiny chunks
  const MIN_CHUNK_SIZE = 3000; // Minimum chunk size to process independently
  const mergedChunks = [];
  
  for (let i = 0; i < chunks.length; i++) {
    const currentChunk = chunks[i];
    
    // If this is a very small chunk and not the first chunk, merge with previous
    if (currentChunk.length < MIN_CHUNK_SIZE && i > 0) {
      // Check if merging would exceed max chunk size
      const previousChunk = mergedChunks[mergedChunks.length - 1];
      if (previousChunk.length + currentChunk.length <= maxChunkSize) {
        // Merge with previous chunk
        mergedChunks[mergedChunks.length - 1] = previousChunk + '\n\n' + currentChunk;
        console.log(`Merged small chunk (${currentChunk.length} chars) with previous chunk`);
      } else {
        // Can't merge, keep as separate chunk
        mergedChunks.push(currentChunk);
      }
    } else {
      // Normal sized chunk or first chunk
      mergedChunks.push(currentChunk);
    }
  }

  return mergedChunks;
}

// Enhanced chunk processing with worker pool and rate limiting
async function processChunkWithWorker(text, chunkIndex) {
  // Create task function
  const taskFn = async () => {
    // Wait for rate limiting with minimal logging
    await rateLimiter.waitForAvailableSlot();
    
    // Execute the actual processing and track API duration
    const result = await processChunk(text, chunkIndex);
    
    // Log API call duration for this chunk
    console.log(`Chunk ${chunkIndex !== undefined ? chunkIndex + 1 : 'single'} API call completed in ${result.apiCallDuration}ms`);
    
    return result;
  };
  
  // Add task to worker pool
  const priority = chunkIndex !== undefined ? (1000 - chunkIndex) : 1000;
  
  // Submit to worker pool and return result
  return workerPool.addTask(taskFn, priority, MAX_RETRIES);
}

// Process a single chunk of text with retry logic
async function processChunk(text, chunkIndex) {
  const maxRetries = MAX_RETRIES;
  let retryCount = 0;
  // Use Claude 3.5 Haiku for speed
  const model = 'claude-3-5-haiku-20241022';
  
  // Start timing the API call
  const apiStartTime = Date.now();
  console.log(`[API Call Start] Chunk ${chunkIndex !== undefined ? chunkIndex + 1 : 'single'} - ${text.length} chars`);
  
  while (retryCount < maxRetries) {
    try {
      const response = await anthropic.messages.create({
        model,
        max_tokens: 3000, 
        temperature: 0.1,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `${SUMMARY_PROMPT} ${text}`
          }
        ]
      });
      
      // Calculate API call duration
      const apiCallDuration = Date.now() - apiStartTime;
      console.log(`[API Call Complete] Chunk ${chunkIndex !== undefined ? chunkIndex + 1 : 'single'} - ${apiCallDuration}ms`);
      
      return {
        summary: response.content[0].text,
        model,
        apiCallDuration
      };
    } catch (error) {
      retryCount++;
      
      console.error(`Error processing chunk ${chunkIndex !== undefined ? chunkIndex + 1 : 'single'}: ${error.message}`);
      
      if (retryCount >= maxRetries) {
        console.error(`Chunk ${chunkIndex !== undefined ? chunkIndex + 1 : 'single'}: All ${maxRetries} retry attempts failed`);
        throw error;
      }
      
      const waitTime = 2 ** retryCount * 1000; // Exponential backoff
      console.log(`Waiting ${waitTime}ms before retry ${retryCount} for chunk ${chunkIndex !== undefined ? chunkIndex + 1 : 'single'}`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  
  throw new Error("Failed to process chunk after retries");
}

// Worker pool implementation for parallel processing
class WorkerPool {
  constructor(size = 5, maxConcurrentRequests = 20) {
    this.size = Math.min(size, maxConcurrentRequests);
    this.tasks = [];
    this.workers = Array(this.size).fill().map((_, i) => ({
      id: i,
      busy: false,
      lastTaskTime: 0
    }));
    this.maxConcurrentRequests = maxConcurrentRequests;
    this.activeRequests = 0;
    this.completedTasks = 0;
    this.failedTasks = 0;
    this.requestsPerMinute = 0;
    this.lastRequestsCount = 0;
    this.lastCountTime = Date.now();
    
    // Minimal metrics - only track what's needed
    this.metrics = {
      taskQueuedTimes: new Map()
    };
    
    // Reduce monitoring frequency to once every 5 minutes
    setInterval(() => this.updateRequestMetrics(), 300000);
  }
  
  updateRequestMetrics() {
    const now = Date.now();
    const timeDiffMinutes = (now - this.lastCountTime) / 60000;
    const newCompletedTasks = this.completedTasks - this.lastRequestsCount;
    this.requestsPerMinute = newCompletedTasks / timeDiffMinutes;
    this.lastRequestsCount = this.completedTasks;
    this.lastCountTime = now;
    
    // Only log essential metrics
    console.log(`[WorkerPool] ${this.requestsPerMinute.toFixed(2)} req/min, ${this.completedTasks} completed`);
    
    // Dynamic pool size adjustment based on request rate
    this.adjustPoolSize();
  }
  
  adjustPoolSize() {
    // Only adjust if significantly different from current size
    const targetSize = Math.max(
      3, 
      Math.min(
        Math.ceil(this.requestsPerMinute / 10),
        this.maxConcurrentRequests
      )
    );
    
    // Only change if the difference is significant (>25%)
    if (Math.abs(targetSize - this.size) > Math.max(2, this.size * 0.25)) {
      console.log(`[WorkerPool] Adjusting pool size: ${this.size} → ${targetSize}`);
      
      if (targetSize > this.size) {
        // Add new workers
        const newWorkers = Array(targetSize - this.size).fill().map((_, i) => ({
          id: this.size + i,
          busy: false,
          lastTaskTime: 0
        }));
        
        this.workers = [...this.workers, ...newWorkers];
      } else {
        // Reduce workers (only the idle ones)
        this.workers = this.workers
          .sort((a, b) => a.busy ? 1 : (b.busy ? -1 : 0))
          .slice(0, targetSize);
      }
      
      this.size = targetSize;
    }
  }
  
  // Add new task to the queue and process if workers available
  async addTask(taskFn, priority = 1, maxRetries = 3) {
    return new Promise((resolve, reject) => {
      const taskId = Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
      
      const task = {
        id: taskId,
        fn: taskFn,
        priority,
        resolve,
        reject,
        added: Date.now(),
        retries: 0,
        maxRetries
      };
      
      // Record minimal metrics
      this.metrics.taskQueuedTimes.set(taskId, Date.now());
      
      // Add task to queue with priority (higher priority first)
      this.tasks.push(task);
      this.tasks.sort((a, b) => b.priority - a.priority);
      
      // Try to process tasks immediately
      this.processQueue();
    });
  }
  
  // Get available worker
  getAvailableWorker() {
    return this.workers.find(w => !w.busy);
  }
  
  // Process tasks in the queue if workers available
  async processQueue() {
    // While we have tasks and workers
    while (this.tasks.length > 0 && this.activeRequests < this.maxConcurrentRequests) {
      const worker = this.getAvailableWorker();
      if (!worker) break;
      
      // Get next task (already sorted by priority)
      const task = this.tasks.shift();
      
      // Mark worker as busy
      worker.busy = true;
      this.activeRequests++;
      
      // Execute the task without awaiting (fire and forget)
      this.executeTask(worker, task);
    }
  }
  
  // Execute task with the given worker - optimized for minimal overhead
  async executeTask(worker, task) {
    try {
      // Set timeout for long-running tasks
      const timeout = setTimeout(() => {
        // Don't abort the task, but free the worker for other tasks
        worker.busy = false;
        this.activeRequests--;
        this.processQueue();
      }, REQUEST_TIMEOUT);
      
      // Execute the task function
      const result = await task.fn();
      
      // Clear timeout
      clearTimeout(timeout);
      
      // Clean up metrics
      this.metrics.taskQueuedTimes.delete(task.id);
      
      // Resolve the promise with the result
      task.resolve(result);
      this.completedTasks++;
    } catch (error) {
      // Retry logic
      if (task.retries < task.maxRetries) {
        task.retries++;
        
        // Exponential backoff without logging
        const backoff = Math.min(30000, 1000 * Math.pow(2, task.retries));
        
        // Add back to queue with higher priority for retries
        setTimeout(() => {
          this.tasks.unshift({
            ...task,
            priority: task.priority + 1 // Increase priority for retries
          });
          this.processQueue();
        }, backoff);
      } else {
        // All retries failed, reject the promise
        task.reject(error);
        this.failedTasks++;
        
        // Clean up metrics
        this.metrics.taskQueuedTimes.delete(task.id);
      }
    } finally {
      // Mark worker as available
      worker.busy = false;
      worker.lastTaskTime = Date.now();
      this.activeRequests--;
      
      // Try to process more tasks
      this.processQueue();
    }
  }
  
  // Get pool status - minimal version
  getStatus() {
    return {
      size: this.size,
      activeRequests: this.activeRequests,
      queueLength: this.tasks.length,
      completedTasks: this.completedTasks
    };
  }
}

// Rate limiter for API calls - minimized for performance
class RateLimiter {
  constructor(maxRequestsPerMinute = 60) {
    this.maxRequestsPerMinute = maxRequestsPerMinute;
    this.requestTimestamps = [];
    this.waitingQueue = [];
    this.processing = false;
  }
  
  // Check if we can make a request right now
  canMakeRequest() {
    const now = Date.now();
    
    // Remove timestamps older than 1 minute
    this.requestTimestamps = this.requestTimestamps.filter(
      timestamp => now - timestamp < 60000
    );
    
    // Check if we've made fewer requests than the limit
    return this.requestTimestamps.length < this.maxRequestsPerMinute;
  }
  
  // Record a request
  recordRequest() {
    this.requestTimestamps.push(Date.now());
  }
  
  // Wait until we can make a request
  async waitForAvailableSlot() {
    // Fast path: if we can make a request immediately, do so
    if (this.canMakeRequest()) {
      this.recordRequest();
      return Promise.resolve();
    }
    
    // Return a promise that resolves when a slot becomes available
    return new Promise(resolve => {
      this.waitingQueue.push(resolve);
      
      // Start processing the queue if not already
      if (!this.processing) {
        this.processing = true;
        this.processQueue();
      }
    });
  }
  
  // Process the waiting queue - minimized version
  async processQueue() {
    // Check every 100ms for available slots
    const interval = setInterval(() => {
      if (this.canMakeRequest() && this.waitingQueue.length > 0) {
        this.recordRequest();
        const resolve = this.waitingQueue.shift();
        resolve();
      }
      
      // If queue is empty, stop checking
      if (this.waitingQueue.length === 0) {
        clearInterval(interval);
        this.processing = false;
      }
    }, 100);
  }
  
  // Get minimal status
  getStatus() {
    return {
      currentRequests: this.requestTimestamps.length,
      maxRequests: this.maxRequestsPerMinute,
      waitingQueue: this.waitingQueue.length
    };
  }
}

// Create pool and rate limiter instances
const workerPool = new WorkerPool(MAX_WORKER_POOL_SIZE, MAX_CONCURRENT_REQUESTS);
const rateLimiter = new RateLimiter(API_REQUESTS_PER_MINUTE);

// Log worker pool creation
console.log(`Created worker pool with ${MAX_WORKER_POOL_SIZE} workers and ${MAX_CONCURRENT_REQUESTS} max concurrent requests`);
console.log(`Rate limiter configured for ${API_REQUESTS_PER_MINUTE} requests per minute`);

// In-memory store for active sessions
const activeSessions = new Map();

// Cleanup old sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of activeSessions.entries()) {
    // Clean up sessions older than 30 minutes
    if (now - session.createdAt > 30 * 60 * 1000) {
      console.log(`Session ${sessionId} expired, cleaning up`);
      activeSessions.delete(sessionId);
    }
  }
}, 5 * 60 * 1000); // Check every 5 minutes

// API Routes
// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Status endpoint for monitoring the worker pool and rate limiter
app.get('/api/status', (req, res) => {
  // Get worker pool and rate limiter status
  const poolStatus = workerPool.getStatus();
  const rateLimiterStatus = rateLimiter.getStatus();
  
  // Calculate system statistics
  const uptime = process.uptime();
  const memoryUsage = process.memoryUsage();
  const formattedMemory = {
    rss: `${Math.round(memoryUsage.rss / 1024 / 1024)} MB`,
    heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`,
    heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`,
    external: `${Math.round(memoryUsage.external / 1024 / 1024)} MB`
  };
  
  // Count active sessions
  const activeSesssionCount = activeSessions.size;
  
  // Return comprehensive status
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    server: {
      uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`,
      uptimeSeconds: uptime,
      memory: formattedMemory,
      nodeVersion: process.version,
      environment: process.env.NODE_ENV || 'development'
    },
    workerPool: poolStatus,
    rateLimiter: rateLimiterStatus,
    sessions: {
      active: activeSesssionCount
    }
  });
});

// Create session endpoint
app.post('/api/create-session', async (req, res) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'No text provided for summarization' });
  }

  // Generate a unique session ID
  const sessionId = Date.now().toString(36) + Math.random().toString(36).substring(2, 10);
  
  // Store the text in the session
  activeSessions.set(sessionId, {
    text,
    createdAt: Date.now()
  });
  
  console.log(`Created new session ${sessionId} with ${text.length} characters`);
  
  // Return the session ID to the client
  res.status(200).json({ 
    sessionId,
    message: 'Session created successfully',
    textLength: text.length
  });
});

// SSE endpoint using session ID
app.get('/api/summarize-stream', async (req, res) => {
  // Add request ID for tracking in logs
  const requestId = Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
  console.log(`[${requestId}] New SSE connection request received`);

  const { sessionId } = req.query;
  
  if (!sessionId) {
    console.error(`[${requestId}] No session ID provided`);
    return res.status(400).json({ error: 'No session ID provided' });
  }

  // Get the text from the session
  const session = activeSessions.get(sessionId);
  if (!session) {
    console.error(`[${requestId}] Invalid or expired session ID: ${sessionId}`);
    return res.status(404).json({ error: 'Invalid or expired session ID' });
  }

  const text = session.text;
  console.log(`[${requestId}] ==========================================`);
  console.log(`[${requestId}] Starting new summarization request (SSE) from session ${sessionId}`);
  console.log(`[${requestId}] Content length: ${text.length} characters`);

  // Performance tracking object (kept minimal)
  const perf = {
    startTime: Date.now(),
    timeCheckpoints: {
      start: Date.now(),
      end: 0,
      chunking: 0
    }
  };

  // Set up SSE headers
  try {
    console.log(`[${requestId}] Setting up SSE headers`);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no' // Disable buffering for Nginx
    });
  } catch (err) {
    console.error(`[${requestId}] Error setting SSE headers:`, err);
    return res.status(500).json({ error: 'Server error setting up connection' });
  }
  
  // Helper function to send SSE events - ONLY USE FOR ESSENTIAL UPDATES
  const sendEvent = (event, data) => {
    try {
      const eventData = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      return res.write(eventData);
    } catch (err) {
      console.error(`[${requestId}] Error sending SSE event '${event}':`, err);
      return false;
    }
  };
  
  // Setup heartbeat to keep connection alive (less frequent to reduce overhead)
  const heartbeatInterval = setInterval(() => {
    try {
      sendEvent('heartbeat', { timestamp: Date.now() });
    } catch (err) {
      console.error(`[${requestId}] Error in heartbeat:`, err);
    }
  }, 30000); // Reduced frequency to 30 seconds
  
  // Function to clean up resources when finished
  const cleanup = () => {
    console.log(`[${requestId}] Cleaning up resources`);
    clearInterval(heartbeatInterval);
    activeSessions.delete(sessionId);
  };
  
  // Handle client disconnection
  req.on('close', () => {
    console.log(`[${requestId}] Client disconnected, cleaning up resources`);
    cleanup();
  });

  req.on('error', (err) => {
    console.error(`[${requestId}] Request error:`, err);
    cleanup();
  });
  
  res.on('error', (err) => {
    console.error(`[${requestId}] Response error:`, err);
    cleanup();
  });
  
  try {
    // Send processing started message - ESSENTIAL
    sendEvent('processing', { 
      message: 'Processing started',
      timestamp: Date.now(),
      sessionId
    });
    
    // Handle very large documents with a warning - ESSENTIAL
    if (text.length > 100000) {
      sendEvent('info', {
        message: 'Processing a very large document. This may take several minutes.',
        size: text.length
      });
    }
    
    // Determine processing strategy based on content size
    if (text.length <= 10000) {
      // For small content, process directly
      console.log(`[${requestId}] Small content detected (${text.length} chars). Processing directly.`);
      const result = await processChunkWithWorker(text);
      
      perf.timeCheckpoints.end = Date.now();
      const totalTime = perf.timeCheckpoints.end - perf.timeCheckpoints.start;
      console.log(`[${requestId}] Completed small content summarization in ${totalTime}ms`);
      
      // Send final result - ESSENTIAL
      sendEvent('result', {
        summary: result.summary
      });
      cleanup();
      res.end();
      return;
    }
    
    // For larger content, use chunking with advanced parallel processing
    console.log(`[${requestId}] Large content detected (${text.length} chars). Using chunk-based processing.`);
    
    const chunkStartTime = Date.now();
    const chunks = chunkText(text, MAX_CHUNK_SIZE);
    perf.timeCheckpoints.chunking = Date.now();
    const chunkingTime = perf.timeCheckpoints.chunking - chunkStartTime;
    
    console.log(`[${requestId}] Chunking completed in ${chunkingTime}ms. Split into ${chunks.length} chunks.`);
    console.log(`[${requestId}] Chunk sizes: ${chunks.map(c => c.length).join(', ')} characters`);
    
    sendEvent('info', {
      message: `Processing document with ${chunks.length} ${chunks.length === 1 ? 'chunk' : 'chunks'}...`,
      chunkSizes: chunks.map(c => c.length)
    });
    
    // Determine optimal parallelism strategy
    let optimalParallelism = MAX_PARALLEL_CHUNKS;
    
    // For smaller documents, reduce parallelism to avoid overhead
    if (chunks.length <= 5) {
      optimalParallelism = 1;
    } else if (chunks.length <= 10) {
      optimalParallelism = Math.min(3, MAX_PARALLEL_CHUNKS);
    } else {
      optimalParallelism = Math.min(
        Math.max(3, Math.ceil(chunks.length / 4)),
        MAX_CONCURRENT_REQUESTS,
        chunks.length
      );
    }
    
    console.log(`[${requestId}] Processing ${chunks.length} chunks with ${optimalParallelism > 1 ? 'parallel' : 'sequential'} processing`);
    
    // Array to store summaries in order
    const summaries = new Array(chunks.length).fill(null);
    let completedChunks = 0;
    let failedChunks = 0;
    let totalApiDuration = 0;
    
    // Periodic progress update variables
    let lastProgressUpdate = Date.now();
    const PROGRESS_UPDATE_INTERVAL = 5000; // Only update every 5 seconds
    
    // Choose processing strategy based on optimal parallelism
    if (optimalParallelism === 1) {
      // Simple case: just one chunk
      try {
        console.log(`[${requestId}] Processing single chunk of ${chunks[0].length} characters`);
        const result = await processChunkWithWorker(chunks[0], 0);
        summaries[0] = result.summary;
        completedChunks = 1;
        totalApiDuration += result.apiCallDuration || 0;
        console.log(`[${requestId}] Single chunk processed in ${result.apiCallDuration}ms`);
      } catch (err) {
        console.error(`[${requestId}] Error processing single chunk:`, err);
        failedChunks = 1;
        summaries[0] = `[Error processing content: ${err.message}]`;
      }
    } else if (chunks.length <= optimalParallelism) {
      // Process all chunks in parallel if there are few enough
      console.log(`[${requestId}] Processing ${chunks.length} chunks in parallel`);
      
      try {
        const results = await Promise.all(
          chunks.map((chunk, idx) => processChunkWithWorker(chunk, idx))
        );
        
        results.forEach((result, idx) => {
          summaries[idx] = result.summary;
          totalApiDuration += result.apiCallDuration || 0;
        });
        
        completedChunks = chunks.length;
        failedChunks = 0;
        console.log(`[${requestId}] All chunks processed in parallel`);
      } catch (err) {
        console.error(`[${requestId}] Error processing chunks in parallel:`, err);
        failedChunks = chunks.length;
        summaries.fill(`[Error processing content: ${err.message}]`);
      }
    } else {
      // Use parallel processing with dynamic worker pool
      // Use batching with larger batch sizes to reduce overhead
      const batchSize = optimalParallelism;
      const batchCount = Math.ceil(chunks.length / batchSize);
      
      // Send a single batch count notification - ESSENTIAL
      sendEvent('info', {
        message: `Processing in ${batchCount} batches to respect API rate limits...`
      });
      
      // Process batches sequentially
      for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
        const batchStart = batchIndex * batchSize;
        const batchEnd = Math.min(batchStart + batchSize, chunks.length);
        const currentBatchChunks = chunks.slice(batchStart, batchEnd);
        
        console.log(`[${requestId}] Processing batch ${batchIndex + 1}/${batchCount} (chunks ${batchStart + 1}-${batchEnd})`);
        
        // Process the current batch in parallel
        try {
          const batchPromises = currentBatchChunks.map((chunk, idx) => {
            const chunkIndex = batchStart + idx;
            return processChunkWithWorker(chunk, chunkIndex);
          });
          
          const batchResults = await Promise.all(batchPromises);
          
          // Store results and track API durations
          let batchApiDuration = 0;
          batchResults.forEach((result, idx) => {
            const chunkIndex = batchStart + idx;
            summaries[chunkIndex] = result.summary;
            
            // Add to total API duration
            const apiDuration = result.apiCallDuration || 0;
            totalApiDuration += apiDuration;
            batchApiDuration += apiDuration;
          });
          
          completedChunks += currentBatchChunks.length;
          
          // Send batch completion message
          console.log(`[${requestId}] Completed batch ${batchIndex + 1}/${batchCount} in ${batchApiDuration}ms of API time`);
          sendEvent('progress', {
            message: `Completed batch ${batchIndex + 1} of ${batchCount}`,
            progress: Math.round((completedChunks / chunks.length) * 100)
          });
        } catch (err) {
          console.error(`[${requestId}] Error processing batch ${batchIndex + 1}:`, err);
          
          // Mark failed chunks
          for (let i = batchStart; i < batchEnd; i++) {
            if (!summaries[i]) {
              failedChunks++;
              summaries[i] = `[Error processing this section]`;
            }
          }
        }
        
        // Add a small delay between batches to avoid rate limiting
        if (batchIndex < batchCount - 1) {
          const batchDelay = 1000; // 1 second between batches
          console.log(`[${requestId}] Waiting ${batchDelay}ms before starting next batch`);
          await new Promise(resolve => setTimeout(resolve, batchDelay));
        }
      }
    }
    
    console.log(`[${requestId}] Chunk processing completed`);
    console.log(`[${requestId}] Completed chunks: ${completedChunks}, Failed chunks: ${failedChunks}`);
    console.log(`[${requestId}] Total API call duration for chunks: ${totalApiDuration}ms`);
    
    // If only one chunk was processed, return its summary
    if (summaries.length === 1) {
      perf.timeCheckpoints.end = Date.now();
      const totalTime = perf.timeCheckpoints.end - perf.timeCheckpoints.start;
      console.log(`[${requestId}] Single chunk summary completed in ${totalTime}ms (API time: ${totalApiDuration}ms)`);
      
      sendEvent('result', {
        summary: summaries[0]
      });
      cleanup();
      res.end();
      return;
    }
    
    // Filter out any null summaries in case some chunks failed
    const validSummaries = summaries.filter(s => s !== null);
    if (validSummaries.length === 0) {
      throw new Error('All chunks failed processing');
    }
    
    // For multiple chunks, create a meta-summary - ESSENTIAL
    sendEvent('info', {
      message: 'Creating final summary...'
    });
    
    console.log(`[${requestId}] Creating meta-summary from ${validSummaries.length} processed chunks`);
    console.log(`[${requestId}] DEBUG: validSummaries.length = ${validSummaries.length}, SHOULD SKIP META-SUMMARY: ${validSummaries.length <= 4}`);
    
    // OPTIMIZATION: Skip meta-summary for documents with 4 or fewer chunks
    // This avoids unnecessary API call that takes 15-20 seconds
    if (validSummaries.length <= 4 || validSummaries.length === 2) { // Explicitly handle 2 chunk case
      console.log(`[${requestId}] Skipping meta-summary for small document (${validSummaries.length} chunks)`);
      console.log(`[${requestId}] Using direct concatenation instead to save 15-20 seconds of processing time`);
      
      // Simply join the summaries with section dividers
      const combinedSummary = validSummaries.map((summary, index) => {
        if (validSummaries.length === 1) {
          // For a single chunk, don't add any section header
          return summary;
        } else if (validSummaries.length === 2) {
          // For two chunks, label them as first/second part
          return `## ${index === 0 ? 'First' : 'Second'} Part\n\n${summary}`;
        } else {
          // For three or four chunks, use numbered parts
          return `## Part ${index + 1}\n\n${summary}`;
        }
      }).join('\n\n---\n\n');
      
      const metaSummary = {
        summary: combinedSummary,
        model: 'direct-combination',
        processingTime: 0
      };
      
      perf.timeCheckpoints.end = Date.now();
      const totalTime = perf.timeCheckpoints.end - perf.timeCheckpoints.start;
      console.log(`[${requestId}] Complete summarization process finished in ${totalTime}ms`);
      console.log(`[${requestId}] Meta-summary step skipped, saving ~15-20 seconds of processing time`);
      
      // Send final result with simplified data - no model or processing time info
      sendEvent('result', {
        summary: metaSummary.summary
      });
      cleanup();
      res.end();
      return;
    }
    
    // Only reach here for documents with more than 4 chunks
    console.log(`[${requestId}] Large document with ${validSummaries.length} chunks, creating meta-summary`);
    
    // Use the worker pool for the meta-summary
    const metaSummaryTask = async () => {
      // Add section numbers for better context
      const numberedSummaries = validSummaries.map((summary, index) => 
        `## Section ${index + 1} of ${validSummaries.length}\n\n${summary}`
      );
      
      const combinedSummaries = numberedSummaries.join("\n\n---\n\n");
      // Use Haiku for faster meta-summaries
      const model = 'claude-3-5-haiku-20241022';
      
      console.log(`[${requestId}] Creating meta-summary with model: ${model}`);
      const startTime = Date.now();
      
      const maxRetries = 3;
      let retryCount = 0;
      
      while (retryCount < maxRetries) {
        try {
          const apiStartTime = Date.now();
          const response = await anthropic.messages.create({
            model,
            max_tokens: 3000,
            temperature: 0.15,
            system: SYSTEM_PROMPT,
            messages: [
              {
                role: 'user',
                content: `${META_SUMMARY_PROMPT} 

Here are the individual summaries from different sections:

${combinedSummaries}

Create a single, coherent summary that integrates all sections while maintaining the structured format.`
              }
            ]
          });
          
          const processingTime = Date.now() - apiStartTime;
          const taskTotalTime = Date.now() - startTime;
          console.log(`[${requestId}] Meta-summary created in ${processingTime}ms (total: ${taskTotalTime}ms) using ${model}`);
          
          return {
            summary: response.content[0].text,
            model,
            processingTime
          };
        } catch (error) {
          retryCount++;
          const waitTime = 2 ** retryCount * 1000; // Exponential backoff
          
          console.error(`[${requestId}] Error creating meta-summary: ${error.message}`);
          
          if (retryCount >= maxRetries) {
            console.error(`[${requestId}] All ${maxRetries} retry attempts failed for meta-summary`);
            throw error;
          }
          
          console.log(`[${requestId}] Waiting ${waitTime}ms before meta-summary retry ${retryCount}`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
      
      throw new Error("Failed to create meta-summary after retries");
    };
    
    const metaSummary = await workerPool.addTask(metaSummaryTask, 2000); // Highest priority
    
    perf.timeCheckpoints.end = Date.now();
    const totalTime = perf.timeCheckpoints.end - perf.timeCheckpoints.start;
    console.log(`[${requestId}] Complete summarization process finished in ${totalTime}ms`);
    
    // Calculate performance metrics
    const metaSummaryTime = metaSummary.processingTime || 0;
    const apiDurationTotal = totalApiDuration + metaSummaryTime;
    const apiCallCount = completedChunks + (metaSummary.model !== 'direct-combination' ? 1 : 0);
    const overheadTime = totalTime - apiDurationTotal;
    const apiTimePercentage = Math.round((apiDurationTotal / totalTime) * 100);
    
    console.log(`[${requestId}] Performance Summary:`);
    console.log(`[${requestId}] - Total time: ${totalTime}ms`);
    console.log(`[${requestId}] - API time: ${apiDurationTotal}ms (${apiTimePercentage}%)`);
    console.log(`[${requestId}] - Chunk processing: ${totalApiDuration}ms`);
    console.log(`[${requestId}] - Meta-summary: ${metaSummaryTime}ms`);
    console.log(`[${requestId}] - Overhead: ${overheadTime}ms`);
    console.log(`[${requestId}] - API calls: ${apiCallCount}`);
    
    // Send final result with simplified data - no model or processing time info
    sendEvent('result', {
      summary: metaSummary.summary
    });
    cleanup();
    res.end();
  } catch (error) {
    console.error(`[${requestId}] Error during summarization:`, error);
    
    // Error messages are ESSENTIAL
    if (error.status === 429) {
      sendEvent('error', { 
        error: `Rate limit exceeded. Please try again later.`
      });
    } else if (error.status === 503) {
      sendEvent('error', { 
        error: `The AI service is currently overloaded. Please try again later.`
      });
    } else if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT' || error.code === 'ECONNABORTED') {
      sendEvent('error', { 
        error: `The request timed out. This often happens with very large documents. Try splitting your document into smaller parts.`
      });
    } else {
      sendEvent('error', { 
        error: `Summarization failed: ${error.message}`
      });
    }
    
    cleanup();
    try {
      res.end();
    } catch (err) {
      console.error(`[${requestId}] Error closing connection:`, err);
    }
  }
});

// Original SSE endpoint for backward compatibility
app.get('/api/summarize', async (req, res) => {
  // Add request ID for tracking in logs
  const requestId = Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
  console.log(`[${requestId}] New SSE connection request received (legacy endpoint)`);

  const { userText } = req.query;
  
  if (!userText) {
    console.error(`[${requestId}] No text provided in request`);
    return res.status(400).json({ error: 'No text provided for summarization' });
  }

  try {
    // Log the request details including query parameter length
    console.log(`[${requestId}] Query param length: ${req.url.length} characters`);
    console.log(`[${requestId}] userText param length: ${userText.length} characters`);
    
    const text = decodeURIComponent(userText);
    console.log(`[${requestId}] ==========================================`);
    console.log(`[${requestId}] Starting new summarization request (legacy SSE endpoint)`);
    console.log(`[${requestId}] Content length after decoding: ${text.length} characters`);
    console.log(`[${requestId}] Client IP: ${req.ip || 'unknown'}`);
    console.log(`[${requestId}] User agent: ${req.headers['user-agent'] || 'unknown'}`);

    // Create a temporary session for this request
    const sessionId = Date.now().toString(36) + Math.random().toString(36).substring(2, 10);
    activeSessions.set(sessionId, {
      text,
      createdAt: Date.now()
    });
    
    // Redirect to the session-based endpoint 
    return res.redirect(307, `/api/summarize-stream?sessionId=${sessionId}`);
  } catch (error) {
    console.error(`[${requestId}] Error in legacy endpoint:`, error);
    return res.status(500).json({ 
      error: `Error processing request: ${error.message}`,
      message: 'Please use the /api/create-session endpoint for large documents'
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API is${process.env.ANTHROPIC_API_KEY ? '' : ' NOT'} configured with Anthropic API key`);
});