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

// Middleware
app.use(cors({
  origin: function(origin, callback) {
    // For development/debugging - log the origin
    console.log(`Received request from origin: ${origin || 'null/undefined'}`);
    
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
const MAX_CHUNK_SIZE = 15000;
const MAX_PARALLEL_CHUNKS = 3; // Process up to 3 chunks in parallel

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
/**
 * Breaks text into chunks of approximately the specified size
 * Tries to break at meaningful boundaries (paragraphs, sentences, or code blocks)
 */
function chunkText(text, maxChunkSize = MAX_CHUNK_SIZE) {
  // If text is already small enough, return it as is
  if (text.length <= maxChunkSize) {
    return [text];
  }

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
    let endIndex = Math.min(currentIndex + maxChunkSize, text.length);
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

  return chunks;
}

/**
 * Process a single chunk of text with retry logic
 */
async function processChunk(text, chunkIndex) {
  const maxRetries = 3;
  let retryCount = 0;
  // Use Claude 3.5 Haiku for speed
  const model = 'claude-3-5-haiku-20241022';
  
  // Log start of chunk processing with timing
  const startTime = Date.now();
  console.log(`[Chunk ${chunkIndex !== undefined ? chunkIndex + 1 : 'single'}] Starting processing (${text.length} chars) with ${model}`);
  
  while (retryCount < maxRetries) {
    try {
      const apiStartTime = Date.now();
      
      const response = await anthropic.messages.create({
        model,
        max_tokens: 1500,
        temperature: 0.05,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `${SUMMARY_PROMPT} ${text}`
          }
        ]
      });
      
      const processingTime = Date.now() - apiStartTime;
      const totalTime = Date.now() - startTime;
      console.log(`[Chunk ${chunkIndex !== undefined ? chunkIndex + 1 : 'single'}] API call completed in ${processingTime}ms (total: ${totalTime}ms)`);
      
      return {
        summary: response.content[0].text,
        model,
        processingTime,
        chunkIndex
      };
    } catch (error) {
      retryCount++;
      const waitTime = 2 ** retryCount * 1000; // Exponential backoff
      
      console.error(`[Chunk ${chunkIndex !== undefined ? chunkIndex + 1 : 'single'}] Error: ${error.message}`);
      
      if (retryCount >= maxRetries) {
        console.error(`[Chunk ${chunkIndex !== undefined ? chunkIndex + 1 : 'single'}] All ${maxRetries} retry attempts failed`);
        throw error;
      }
      
      console.log(`[Chunk ${chunkIndex !== undefined ? chunkIndex + 1 : 'single'}] Waiting ${waitTime}ms before retry ${retryCount}`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  
  throw new Error("Failed to process chunk after retries");
}

/**
 * Create a meta-summary from individual summaries
 */
async function createMetaSummary(summaries, originalChunkCount) {
  const maxRetries = 3;
  let retryCount = 0;
  
  // Add section numbers for better context
  const numberedSummaries = summaries.map((summary, index) => 
    `## Section ${index + 1} of ${summaries.length}\n\n${summary}`
  );
  
  const combinedSummaries = numberedSummaries.join("\n\n---\n\n");
  // Use Haiku for faster meta-summaries
  const model = 'claude-3-5-haiku-latest';
  
  console.log(`Creating meta-summary from ${summaries.length} chunks (original content had ${originalChunkCount} chunks)`);
  console.log(`Using model: ${model} for meta-summary generation`);
  const startTime = Date.now();
  
  while (retryCount < maxRetries) {
    try {
      const apiStartTime = Date.now();
      const response = await anthropic.messages.create({
        model,
        max_tokens: 2000,
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
      const totalTime = Date.now() - startTime;
      console.log(`Meta-summary created in ${processingTime}ms (total: ${totalTime}ms) using ${model}`);
      
      return {
        summary: response.content[0].text,
        model,
        processingTime
      };
    } catch (error) {
      retryCount++;
      const waitTime = 2 ** retryCount * 1000; // Exponential backoff
      
      console.error(`Error creating meta-summary: ${error.message}`);
      
      if (retryCount >= maxRetries) {
        console.error(`All ${maxRetries} retry attempts failed for meta-summary`);
        throw error;
      }
      
      console.log(`Waiting ${waitTime}ms before meta-summary retry ${retryCount}`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  
  throw new Error("Failed to create meta-summary after retries");
}

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
  console.log(`[${requestId}] Client IP: ${req.ip || 'unknown'}`);
  console.log(`[${requestId}] User agent: ${req.headers['user-agent'] || 'unknown'}`);

  // Set up SSE headers
  try {
    console.log(`[${requestId}] Setting up SSE headers`);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no' // Disable buffering for Nginx
    });
    console.log(`[${requestId}] SSE headers sent successfully`);
  } catch (err) {
    console.error(`[${requestId}] Error setting SSE headers:`, err);
    return res.status(500).json({ error: 'Server error setting up connection' });
  }
  
  // Helper function to send SSE events
  const sendEvent = (event, data) => {
    try {
      const eventData = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      const result = res.write(eventData);
      console.log(`[${requestId}] Sent '${event}' event (${eventData.length} bytes), buffer empty: ${result}`);
      return result;
    } catch (err) {
      console.error(`[${requestId}] Error sending SSE event '${event}':`, err);
      return false;
    }
  };
  
  // Setup heartbeat to keep connection alive
  const heartbeatInterval = setInterval(() => {
    try {
      const result = sendEvent('heartbeat', { timestamp: Date.now() });
      if (!result) {
        console.warn(`[${requestId}] Heartbeat event write buffer is full, connection may be stalled`);
      }
    } catch (err) {
      console.error(`[${requestId}] Error in heartbeat:`, err);
    }
  }, 15000); // Send heartbeat every 15 seconds
  
  // Function to clean up resources when finished
  const cleanup = () => {
    console.log(`[${requestId}] Cleaning up resources`);
    clearInterval(heartbeatInterval);
    // Clean up session after processing
    activeSessions.delete(sessionId);
    console.log(`[${requestId}] Removed session ${sessionId}`);
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
    const startTime = Date.now();
    
    // Send processing started message
    console.log(`[${requestId}] Sending initial processing event`);
    sendEvent('processing', { 
      message: 'Processing started',
      timestamp: Date.now(),
      requestId,
      sessionId
    });
    
    // Handle very large documents with a warning
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
      const result = await processChunk(text);
      
      const totalTime = Date.now() - startTime;
      console.log(`[${requestId}] Completed small content summarization in ${totalTime}ms`);
      
      // Send final result
      sendEvent('result', {
        summary: result.summary,
        model: result.model,
        processingTime: `${totalTime}ms`
      });
      cleanup();
      res.end();
      return;
    }
    
    // For larger content, use chunking
    console.log(`Large content detected (${text.length} chars). Using chunk-based processing.`);
    console.log('Chunking text...');
    const chunkStartTime = Date.now();
    const chunks = chunkText(text, MAX_CHUNK_SIZE);
    console.log(`Chunking completed in ${Date.now() - chunkStartTime}ms. Split into ${chunks.length} chunks.`);

    // Send chunking info to client
    sendEvent('info', {
      message: `Document split into ${chunks.length} chunks`,
      chunkCount: chunks.length,
      chunksProcessed: 0
    });

    // Process chunks with limited parallelism
    console.log(`Processing ${chunks.length} chunks with parallelism of ${MAX_PARALLEL_CHUNKS}`);
    const summaries = new Array(chunks.length).fill(null);
    const processStartTime = Date.now();
    
    // Process chunks in batches to limit parallelism
    for (let i = 0; i < chunks.length; i += MAX_PARALLEL_CHUNKS) {
      const batch = [];
      
      // Send batch processing update
      sendEvent('info', {
        message: `Starting batch ${Math.floor(i/MAX_PARALLEL_CHUNKS) + 1} of ${Math.ceil(chunks.length/MAX_PARALLEL_CHUNKS)}`,
        currentBatch: Math.floor(i/MAX_PARALLEL_CHUNKS) + 1,
        totalBatches: Math.ceil(chunks.length/MAX_PARALLEL_CHUNKS)
      });
      
      // Create batch of promises for parallel processing
      for (let j = 0; j < MAX_PARALLEL_CHUNKS && i + j < chunks.length; j++) {
        const chunkIndex = i + j;
        batch.push(
          processChunk(chunks[chunkIndex], chunkIndex)
            .then(result => {
              summaries[chunkIndex] = result.summary;
              
              // Send progress update to client
              sendEvent('progress', {
                chunkIndex: chunkIndex,
                totalChunks: chunks.length,
                progress: Math.round(((chunkIndex + 1) / chunks.length) * 100),
                timestamp: Date.now()
              });
              
              return result;
            })
            .catch(err => {
              console.error(`Error processing chunk ${chunkIndex}:`, err);
              
              // Send chunk error to client but continue processing
              sendEvent('warning', {
                message: `Error processing chunk ${chunkIndex + 1}: ${err.message}`,
                chunkIndex: chunkIndex,
                error: err.message
              });
              
              // Return empty summary to avoid breaking the process
              return { summary: `[Error processing this section: ${err.message}]` };
            })
        );
      }
      
      try {
        // Wait for current batch to complete before starting next batch
        await Promise.all(batch);
      } catch (batchError) {
        console.error('Error processing batch:', batchError);
        sendEvent('warning', {
          message: `Error in batch processing: ${batchError.message}`,
          error: batchError.message
        });
        // Continue with next batch despite errors
      }
    }
    
    console.log(`Chunk processing completed in ${Date.now() - processStartTime}ms`);
    
    // If only one chunk was processed, return its summary
    if (summaries.length === 1) {
      const totalTime = Date.now() - startTime;
      console.log(`Single chunk summary completed in ${totalTime}ms`);
      
      sendEvent('result', {
        summary: summaries[0],
        chunkCount: chunks.length,
        processedChunks: 1,
        model: 'claude-3-5-haiku-20241022',
        processingTime: `${totalTime}ms`
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
    
    // For multiple chunks, create a meta-summary
    sendEvent('info', {
      message: 'Creating final summary from all processed chunks...',
      chunksProcessed: validSummaries.length,
      totalChunks: chunks.length
    });
    
    console.log(`Creating meta-summary from ${validSummaries.length} processed chunks`);
    const metaSummaryStartTime = Date.now();
    const metaSummary = await createMetaSummary(validSummaries, chunks.length);
    console.log(`Meta-summary creation completed in ${Date.now() - metaSummaryStartTime}ms`);
    
    const totalTime = Date.now() - startTime;
    console.log(`Complete summarization process finished in ${totalTime}ms`);
    
    // Send final result
    sendEvent('result', {
      summary: metaSummary.summary,
      chunkCount: chunks.length,
      processedChunks: validSummaries.length,
      model: metaSummary.model,
      processingTime: `${totalTime}ms`
    });
    cleanup();
    res.end();
  } catch (error) {
    console.error(`[${requestId}] Error during summarization:`, error);
    
    // Handle rate limits and overloads specially
    if (error.status === 429) {
      const retryAfter = error.headers?.get('retry-after') || 60;
      console.error(`[${requestId}] Rate limit exceeded. Retry after: ${retryAfter}s`);
      sendEvent('error', { 
        error: `Rate limit exceeded. Please try again later.`, 
        retryAfter,
        errorCode: 429,
        requestId
      });
    } else if (error.status === 503) {
      console.error(`[${requestId}] AI service overloaded`);
      sendEvent('error', { 
        error: `The AI service is currently overloaded. Please try again later.`, 
        isOverloaded: true,
        errorCode: 503,
        requestId
      });
    } else if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT' || error.code === 'ECONNABORTED') {
      console.error(`[${requestId}] Network timeout occurred:`, error);
      sendEvent('error', { 
        error: `The request timed out. This often happens with very large documents. Try splitting your document into smaller parts.`,
        isTimeout: true,
        errorCode: 'TIMEOUT',
        requestId
      });
    } else {
      console.error(`[${requestId}] Unexpected error:`, error);
      sendEvent('error', { 
        error: `Summarization failed: ${error.message}`,
        errorDetails: error.stack,
        requestId
      });
    }
    
    cleanup();
    try {
      res.end();
      console.log(`[${requestId}] Connection closed due to error`);
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