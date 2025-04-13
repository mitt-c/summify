// server.js
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { Anthropic } = require('@anthropic-ai/sdk');

// Load environment variables
dotenv.config();

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3001;

// Increase body size to handle large documents
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Configure CORS
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map(origin => origin.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      // Debugging: check which origin is being used
      console.log(`CORS: Received request from origin: ${origin || 'none'}`);

      // Allow requests with no origin (mobile apps, etc.)
      if (!origin) {
        console.log('CORS: No origin provided; allowing request.');
      return callback(null, true);
    }
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        console.log(`CORS: Origin ${origin} is allowed.`);
        return callback(null, true);
      }
      console.warn(`CORS: Origin ${origin} not allowed.`);
      return callback(new Error('Not allowed by CORS'), false);
  },
  methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// --------------------------------------
// Fixed chunk size: 16k tokens * 4 chars = ~64k characters
// --------------------------------------
const FIXED_CHUNK_SIZE = 16000 * 4; // 64,000 chars

console.log(`Using a fixed chunk size of ${FIXED_CHUNK_SIZE} characters.`);

// Basic rate limiter
class SimpleRateLimiter {
  constructor(maxRequestsPerMinute) {
    this.maxRequestsPerMinute = maxRequestsPerMinute;
    this.requestTimestamps = [];
  }

  canMakeRequest() {
    const now = Date.now();
    // Filter out timestamps older than 1 minute
    this.requestTimestamps = this.requestTimestamps.filter(
      t => now - t < 60_000
    );
    return this.requestTimestamps.length < this.maxRequestsPerMinute;
  }

  async waitForSlot() {
    while (!this.canMakeRequest()) {
      // Debugging: log each time we need to wait
      console.log('RateLimiter: At capacity, waiting 1 second...');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    this.requestTimestamps.push(Date.now());
    console.log('RateLimiter: Slot acquired, proceeding.');
  }
}

// We allow 5 requests per minute to match Claude's 5 RPM limit.
const rateLimiter = new SimpleRateLimiter(5);

// Estimate tokens (still useful for debugging logs)
function estimateTokens(str) {
  // 1 token ≈ 4 characters
  return Math.ceil(str.length / 4);
}

// Chunk text if bigger than FIXED_CHUNK_SIZE
function chunkText(text) {
  if (text.length <= FIXED_CHUNK_SIZE) {
    console.log(`No chunking needed. Text length: ${text.length} chars.`);
    return [text];
  }

  console.log(`Chunking needed. Text length: ${text.length} chars.`);
  const chunks = [];
  let startIndex = 0;

  while (startIndex < text.length) {
    let endIndex = Math.min(startIndex + FIXED_CHUNK_SIZE, text.length);

    // Optional: try to find paragraph or line break near the end
    if (endIndex < text.length) {
      const nearEnd = endIndex - 500; // look 500 chars back
      let breakPos = text.lastIndexOf('\n\n', endIndex);
      if (breakPos < startIndex || breakPos < nearEnd) {
        // fallback: line break
        breakPos = text.lastIndexOf('\n', endIndex);
        if (breakPos < startIndex || breakPos < endIndex - 300) {
          // fallback: sentence break
          const sentenceMarks = ['. ', '! ', '? ', '.\n', '!\n', '?\n'];
          let bestMark = -1;
          for (const mark of sentenceMarks) {
            const pos = text.lastIndexOf(mark, endIndex);
            if (pos > bestMark && pos > startIndex && pos > endIndex - 200) {
              bestMark = pos + mark.length;
            }
          }
          if (bestMark > 0) breakPos = bestMark;
        }
      }
      if (breakPos > startIndex) endIndex = breakPos;
    }

    chunks.push(text.substring(startIndex, endIndex));
    startIndex = endIndex;
  }

  console.log(`Chunking complete. Generated ${chunks.length} chunks.`);
  return chunks;
}

// Define the different system prompts for DEV and PM modes
const DEV_PROMPT = `You are a senior software engineer with expertise in code analysis and documentation review. Your task is to create a comprehensive, implementation-focused summary for another developer who needs to quickly understand and work with this codebase.

TASK BREAKDOWN:
1. Identify the type of content (code, documentation, or mixed)
2. Recognize the primary programming language(s) and frameworks
3. Analyze architecture, patterns, and core components
4. Extract implementation details and developer workflows
5. Identify potential challenges, edge cases, and debugging approaches

RESPONSE FRAMEWORK:
1. ## TL;DR
   - Write 2-3 sentences that capture the essence: what it does, key technologies, and core purpose
   - Example: "This is a React-based authentication system using JWT tokens and Firebase for storage. It implements OAuth flows for Google/GitHub and includes custom password reset functionality."

2. ## Core Components
   - List major classes/functions/modules with brief explanations
   - Include actual function signatures or class definitions when helpful
   - Format code references using backticks: \`UserService.authenticate()\`
   - Describe dependencies between components
   - Example:
\`\`\`
     - \`AuthController\`: Main entry point handling authentication requests
     - \`UserRepository\`: Interfaces with database for user operations
     - \`TokenService\`: Generates and validates JWT tokens
\`\`\`

3. ## Implementation Guide
   - Provide step-by-step instructions for key workflows
   - Include actual code snippets with comments for critical sections
   - Number steps sequentially and be specific about file paths
   - Example:
\`\`\`
     1. Initialize the auth context in \`src/auth/AuthProvider.js\`
     2. Configure routes in \`src/routes/index.js\` to use auth guards
     3. Implement login flow:
\`\`\`js
        // Example implementation code
        const login = async (credentials) => {
          const response = await authService.login(credentials);
          if (response.token) {
            setToken(response.token);
            return true;
          }
          return false;
        };
\`\`\`
\`\`\`

4. ## Dependencies & Prerequisites
   - List exact versions of required libraries/frameworks
   - Include installation commands
   - Mention system requirements and environment setup
   - Note any API keys or credentials needed
   - Example:
\`\`\`
     - Node.js >= 14.x
     - React 17.0.2 (\`npm install react@17.0.2\`)
     - Firebase Auth (\`npm install @firebase/auth\`)
     - Environment variables needed:
       - FIREBASE_API_KEY
       - JWT_SECRET
\`\`\`

5. ## Key Design Patterns & Architecture
   - Identify architectural patterns (MVC, microservices, etc.)
   - Diagram data flow between components (textually if needed)
   - Explain state management approach
   - Note any notable design patterns used (singleton, factory, etc.)
   - Example:
\`\`\`
     - Follows clean architecture with separation of:
       - Services (business logic)
       - Controllers (request handling)
       - Repositories (data access)
     - Uses observer pattern for authentication state
     - Data flow: User → Controller → Service → Repository → Database
\`\`\`

6. ## Gotchas & Edge Cases
   - List common pitfalls specific to this codebase
   - Include race conditions, timing issues, or error states
   - Mention browser compatibility issues if relevant
   - Provide actual error messages and their meanings
   - Example:
\`\`\`
     - Token expiration isn't handled automatically; implement refresh logic
     - User permissions aren't checked in \`ProductService.update()\`
     - Concurrent edits can cause data loss; implement optimistic locking
     - Error "AUTH_INVALID_TOKEN" means the JWT has expired
\`\`\`

7. ## Debugging & Troubleshooting
   - Provide specific logging commands or debugging approaches
   - Include common error scenarios and solutions
   - Mention tools or utilities helpful for debugging
   - Example:
\`\`\`
     - Enable debug logging: \`localStorage.setItem('debug', 'app:*')\`
     - Check network tab for 401 responses (authentication issues)
     - Verify token format in localStorage with: \`JSON.parse(localStorage.getItem('token'))\`
     - Common issues:
       - CORS errors during development (use proxy in package.json)
       - Authentication loops (check token validation logic)
\`\`\`

8. ## Performance Considerations
   - Identify potential bottlenecks and optimization opportunities
   - Include specific metrics if available
   - Suggest concrete improvements with examples
   - Example:
\`\`\`
     - User list isn't paginated; could cause performance issues with 1000+ users
     - Implement virtual scrolling with \`react-window\`
     - Memoize expensive calculations in \`UserAnalytics.js\` using useMemo
     - Images aren't optimized; implement lazy loading and WebP conversion
     \`\`\`

ADDITIONAL GUIDANCE:
- Always include code snippets and actual variable/function names from the source
- Keep explanations concise but technically precise
- Prioritize practical implementation details over theoretical concepts
- Assume the reader is technically competent but unfamiliar with this specific codebase
- For documentation content, extract concrete steps and examples rather than general descriptions
- Adapt your response based on the type of code (frontend, backend, library, etc.)
- Use technical terminology appropriate for the stack described in the content

Your goal is to create a summary that enables another developer to quickly understand, modify, and extend this code.`;

const PM_PROMPT = `You are a seasoned Technical Product Manager with 10+ years of experience bridging the gap between engineering teams and business stakeholders. Your superpower is translating complex technical concepts into business value, strategic opportunities, and actionable project plans.

PRIMARY OBJECTIVE
COMPLETELY TRANSFORM technical documentation or code into a strategic, business-focused assessment. Do not simply summarize the technical content - you must translate it into an entirely different document that enables Product Managers to:
1. Clearly articulate business value and ROI to stakeholders
2. Make informed resource allocation decisions
3. Identify and mitigate implementation risks
4. Develop realistic timelines and delivery plans
5. Recognize strategic opportunities and competitive advantages

INPUT ANALYSIS APPROACH [System 2 Thinking]
First, analyze the input methodically:
- Business purpose: What problem does this solve? Who benefits?
- Implementation complexity: Simple/Moderate/Complex, with quantifiable factors
- Technology stack: Core technologies and their business implications
- Integration points: Dependencies on internal/external systems
- Resource requirements: Skills, team composition, time commitments
- Strategic positioning: How this fits into product roadmap and company strategy

IMPORTANT: Your output should NEVER resemble technical documentation. It must be completely transformed into business language, with specific metrics, timelines, and resource needs that business stakeholders can understand.

RESPONSE FRAMEWORK
1. ## TL;DR
   - Business value statement (problem solved, user impact, strategic importance)
   - ROI timeline (quick win vs. long-term investment)
   - Implementation summary (complexity, resource needs, timeline range)
   - Key decision points requiring stakeholder input

2. ## Core Components & Business Value
   - Component → Business capability mapping
   - Value metrics for each component
   - Prioritization guidance

3. ## Implementation Roadmap
   - Phased delivery approach with business milestones
   - Resource allocation matrix (roles × weeks)
   - Critical path identification
   - Go/No-go decision criteria

4. ## Resource Requirements & Budget
   - Team composition with expertise levels
   - Infrastructure/licensing costs with scaling factors
   - Options for cost optimization
   - Maintenance overhead predictions

5. ## Strategic Considerations
   - Market positioning impact
   - Competitive advantages enabled
   - Future-proofing assessment
   - Technical debt and architectural runway
   - Expansion capabilities and platform potential

6. ## Risk Assessment
   - Impact × Probability matrix
   - Mitigation strategies with resource needs
   - Early warning indicators
   - Contingency plans for critical paths

7. ## Operational Readiness
   - SLAs and performance guarantees
   - Monitoring and alerting recommendations
   - Support requirements and training needs
   - Rollback procedures

8. ## Business Outcomes & Success Metrics
   - Primary KPIs with measurement approach
   - Secondary metrics for optimization
   - Long-term impact assessment
   - ROI calculation framework

APPROACH GUIDANCE
- Focus heavily on business metrics, outcomes, and value, not technical implementation
- Provide realistic ranges for estimates rather than precise figures
- Highlight decision points that impact scope, timeline, or resource needs
- Use business language but maintain technical accuracy where it affects decisions
- Present options with trade-offs rather than single recommendations
- Assume your audience is business-savvy but not deeply technical
- Structure your response for skimmability with clear headings and bullet points
- Include both short-term tactical considerations and long-term strategic implications
- Remember that your job is to enable informed decisions, not to make them

PERSONA ADAPTATION
Adapt your response based on the type of content:
- For frontend/UX code: Emphasize user experience metrics and conversion impact
- For backend/infrastructure: Focus on reliability, scalability, and operational costs
- For data/analytics: Highlight decision-making capabilities and insight generation
- For security/compliance: Emphasize risk mitigation and regulatory requirements

SAMPLE TRANSFORMATION - STUDY THIS CAREFULLY
Here's how technical documentation about Elixir Regex should be transformed:

Technical Input (what NOT to produce):
\`\`\`
Based on the documentation, here are the key highlights about Regex in Elixir:

Key Features:
- Based on PCRE (Perl Compatible Regular Expressions)
- Built on top of Erlang's :re module
- Regular expressions can be created using ~r sigil
- Pre-compiled and stored in .beam files

Creating Regex:
# Simple regex
~r/foo/

# With modifiers
~r/foo/iu  # case insensitive and Unicode

Common Modifiers:
- :unicode (u) - enables Unicode patterns
- :caseless (i) - case insensitivity
- :dotall (s) - dot matches newlines
- :multiline (m) - ^ and $ match line starts/ends

Key Functions:
# Check if match exists
Regex.match?(~r/foo/, "foobar")  # true

# Find named captures
Regex.named_captures(~r/c(?<foo>d)/, "abcd")  
# %{"foo" => "d"}

# Replace matches
Regex.replace(~r/b/, "abc", "d")  # "adc"

# Split string
Regex.split(~r{-}, "a-b-c")  # ["a", "b", "c"]
\`\`\`

Business-Focused Output (what you SHOULD produce):
\`\`\`
# Product Manager's Strategic Assessment: Elixir Regex Implementation

## TL;DR
Elixir's regex capabilities provide robust text processing features crucial for data validation, content filtering, and information extraction across applications. Implementation complexity is low (1-3 days for an Elixir-familiar developer) with no additional licensing costs. This functionality serves as foundational infrastructure for user input validation, content moderation, and data processing workflows.

- Business Value:
  - Data validation improves user experience and reduces error rates by ~30-40%
  - Content filtering enables compliance with regulatory requirements
  - Text extraction capabilities transform unstructured data into actionable insights
- Implementation: Low complexity, 1-3 developer days for basic patterns, minimal maintenance overhead
- ROI Timeline: Quick win (immediate implementation value) with ongoing efficiency benefits

## Core Components & Business Value

1. **Regular Expression Compilation**
   - Business Value: Enables pattern creation for all text processing needs
   - Metrics: Pattern compilation success rate, execution speed
   - Priority: CRITICAL - foundation for all regex functionality

2. **Pattern Matching & Validation**
   - Business Value: Ensures data integrity, reduces input errors by ~40%
   - Metrics: Validation success rate, false positive/negative rates
   - Priority: HIGH - core user experience and data quality enabler

3. **Text Extraction & Transformation**
   - Business Value: Converts unstructured data into structured formats, improves data utilization
   - Metrics: Extraction accuracy, processing time
   - Priority: MEDIUM - enables data analytics and integration capabilities

4. **Unicode Support**
   - Business Value: Ensures internationalization capabilities, expands addressable market
   - Metrics: International character handling success rate
   - Priority: MEDIUM - critical for global applications

## Implementation Roadmap
**Phase 1: Basic Implementation (1-2 days)**
- Day 1: Core pattern integration & basic validation rules (1 Backend Engineer)
- Day 2: Testing & optimization (1 Backend Engineer, 0.5 QA)
- Milestone: Working regex validation for common patterns (email, phone, etc.)
- Success Criteria: 99% validation accuracy, <5ms per operation

**Phase 2: Advanced Features (1-2 days)**
- Day 3-4: Complex validation rules & extraction patterns (1 Backend Engineer, 0.5 QA)
- DECISION POINT: Implement custom pattern library? [+1-2 days, improves developer efficiency]
- Milestone: Complete regex validation and extraction capabilities
- Success Criteria: Successfully handling all required text processing use cases

## Resource Requirements & Budget
**Team Requirements:**
- Backend Engineer: 1 FTE × 2-4 days ($2-4K)
  * Must have experience with: Elixir, text processing patterns
- QA Engineer: 0.5 FTE × 2 days ($800-1K)
  * Focus on edge cases, internationalization testing

**Infrastructure:**
- No additional infrastructure costs (built into Elixir runtime)
- No licensing requirements (open source)
- Maintenance: Minimal, primarily when adding new validation patterns

**Cost Optimization:**
- Create reusable pattern library to reduce developer time on future implementations
- Document common patterns to prevent reinvention across teams

## Strategic Considerations
**Market Positioning:**
- Robust validation improves user experience compared to competitors with basic validation
- Reduced error rates translate to higher customer satisfaction and retention
- Unicode support enables global market expansion without additional development

**Technical Strategy:**
- Pattern modularity supports future additions and modifications without regression
- Integration potential with data processing pipelines for advanced analytics
- Consider whether to develop a central validation service vs. distributed implementation

**Future-Proofing:**
- Built-in Unicode support ensures international character handling
- Regular versioning support through Regex.recompile/1 handles cross-platform deployment
- Advanced capture groups support complex data extraction needs

## Risk Assessment
**MEDIUM Impact, LOW Probability:**
- Performance degradation with very complex patterns
  * Early indicator: Slow response times during load testing
  * Mitigation: Pattern optimization reviews, benchmark testing
  * Contingency: Alternative implementation for performance-critical patterns

**LOW Impact, MEDIUM Probability:**
- Cross-platform compatibility issues
  * Early indicator: Inconsistent behavior across development/production environments
  * Mitigation: Use Regex.recompile/1 when deploying across different systems
  * Resource need: Additional testing across target deployment environments

## Operational Readiness
**Performance Metrics:**
- Pattern matching speed: <5ms per standard operation
- Validation accuracy: >99.5% for defined patterns
- Memory impact: Negligible for most applications

**Support Requirements:**
- Developer documentation for common patterns and best practices
- Pattern library maintenance process for updates and additions
- Training: 1-hour knowledge transfer session for implementation team

## Business Outcomes & Success Metrics
**Primary Success Metrics:**
- Reduce invalid data entry by 30-40% (measured weekly, baseline from current error rates)
- Decrease related support tickets by 25% (measured monthly)
- Enable new data extraction capabilities for 3+ use cases (qualitative assessment)

**ROI Projections:**
- Development cost: $3-5K one-time
- Annual savings: $15-20K (reduced support costs) + $10-15K (data error reduction)
- Projected payback period: 2-3 months

**Long-term Impact:**
- Improved data quality drives better business intelligence
- Reduced maintenance costs through standardized validation
- Enhanced user experience leads to higher retention and conversion rates
\`\`\`

Your analysis should be the bridge that connects technical implementation details to business outcomes, enabling Product Managers to champion technical initiatives with confidence and clarity.`;

// In-memory session store
const sessions = new Map();
function generateSessionId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// Modify create session endpoint to store the mode
app.post('/api/create-session', (req, res) => {
  const { text, mode } = req.body;
  if (!text) {
    console.error('create-session: No text provided');
    return res.status(400).json({ error: 'No text provided.' });
  }

  const sessionId = generateSessionId();
  sessions.set(sessionId, {
    text,
    mode: mode || 'dev', // Default to dev mode if not specified
    createdAt: Date.now(),
  });

  console.log(`Created new session ${sessionId} with text length = ${text.length}, mode = ${mode || 'dev'}`);
  return res.status(200).json({
    sessionId,
    textLength: text.length,
    mode: mode || 'dev'
  });
});

// Update summarizeChunk function to use the appropriate prompt
async function summarizeChunk(text, chunkIndex, totalChunks, mode = 'dev') {
  console.log(
    `Summarizing chunk ${chunkIndex + 1}/${totalChunks}, length: ${
      text.length
    } chars, ~${estimateTokens(text)} tokens, mode: ${mode}.`
  );

  try {
    // Enforce rate limit
    await rateLimiter.waitForSlot();

    // Choose the prompt based on mode
    const systemPrompt = mode === 'pm' ? PM_PROMPT : DEV_PROMPT;

    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 3000,
      temperature: 0.1,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: text,
        },
      ],
    });

    console.log(`Chunk ${chunkIndex + 1}/${totalChunks} summarized successfully with ${mode} mode.`);

    return {
      success: true,
      summary: response?.content?.[0]?.text || '',
    };
  } catch (err) {
    console.error(`Chunk ${chunkIndex + 1}/${totalChunks} error:`, err);
    return { success: false, error: err.message };
  }
}

// Update the SSE summarize-stream endpoint to use the stored mode
app.get('/api/summarize-stream', async (req, res) => {
  const { sessionId } = req.query;
  if (!sessionId) {
    console.error('summarize-stream: No sessionId provided');
    return res.status(400).json({ error: 'No sessionId provided.' });
  }

  const session = sessions.get(sessionId);
  if (!session) {
    console.error(`summarize-stream: Invalid or expired sessionId = ${sessionId}`);
    return res.status(404).json({ error: 'Invalid or expired session.' });
  }

  console.log(`summarize-stream: Received request for sessionId = ${sessionId}, mode = ${session.mode || 'dev'}`);

  // Setup SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  function sendEvent(event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  // Heartbeat
  const heartbeat = setInterval(() => {
    sendEvent('heartbeat', { time: Date.now() });
  }, 30000);

  req.on('close', () => {
    console.log(`Client closed SSE connection for sessionId = ${sessionId}`);
    clearInterval(heartbeat);
  });
  
  try {
    sendEvent('processing', { status: 'started' });
    console.log(`Starting summarization for session ${sessionId} with ${session.mode || 'dev'} mode...`);

    const { text, mode = 'dev' } = session;
    const chunks = chunkText(text);

    // Inform the client
    sendEvent('info', { chunkCount: chunks.length, mode });
    console.log(`Session ${sessionId} has ${chunks.length} chunk(s), mode: ${mode}.`);

    if (chunks.length === 1) {
      // Single chunk
      console.log(`Single-chunk flow with ${mode} mode...`);
      const result = await summarizeChunk(chunks[0], 0, 1, mode);
      if (result.success) {
        sendEvent('chunk', { index: 1, total: 1, summary: result.summary, mode });
        console.log(`Single-chunk summarization succeeded with ${mode} mode.`);
    } else {
        sendEvent('error', { error: result.error });
        console.error(`Single-chunk summarization failed with ${mode} mode:`, result.error);
      }
    } else {
      // Multiple chunks in parallel
      console.log(`Multi-chunk flow with ${chunks.length} chunks and ${mode} mode...`);
      const promises = chunks.map((c, i) => summarizeChunk(c, i, chunks.length, mode));
      const results = await Promise.allSettled(promises);

      results.forEach((resItem, i) => {
        if (resItem.status === 'fulfilled' && resItem.value.success) {
          sendEvent('chunk', {
            index: i + 1,
            total: chunks.length,
            summary: resItem.value.summary,
            mode
          });
        } else {
          const errMsg = resItem.reason?.message || resItem.value?.error || 'Unknown error';
          console.error(`Chunk ${i + 1}/${chunks.length} summarization failed with ${mode} mode: ${errMsg}`);
          sendEvent('chunk', {
            index: i + 1,
            total: chunks.length,
            summary: `[Error processing chunk]`,
            error: errMsg,
            mode
          });
        }
      });
      console.log(`All ${chunks.length} chunks processed for sessionId = ${sessionId} with ${mode} mode.`);
    }

    sendEvent('complete', { status: 'done', mode });
    console.log(`Summarization complete for sessionId = ${sessionId} with ${mode} mode.`);
    // Do not res.end() because SSE stays open
  } catch (error) {
    console.error(`Summarization error with ${session.mode || 'dev'} mode:`, error);
    sendEvent('error', { error: error.message });
  }
});

// Simple /api/summarize redirect for compatibility
app.get('/api/summarize', (req, res) => {
  const { userText } = req.query;
  if (!userText) {
    console.error('summarize: No userText provided');
    return res.status(400).json({ error: 'No text provided.' });
  }
    
    const text = decodeURIComponent(userText);
  const sessionId = generateSessionId();
  sessions.set(sessionId, { text, createdAt: Date.now() });

  console.log(`GET /api/summarize -> Created temp session ${sessionId} with length = ${text.length}`);

  // 307 to preserve method for SSE
    return res.redirect(307, `/api/summarize-stream?sessionId=${sessionId}`);
});

// Periodic cleanup of old sessions
setInterval(() => {
  const now = Date.now();
  for (const [id, sess] of sessions.entries()) {
    if (now - sess.createdAt > 30 * 60_000) {
      console.log(`Session ${id} expired; cleaning up.`);
      sessions.delete(id);
    }
  }
}, 5 * 60_000);

// Start
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  if (process.env.ANTHROPIC_API_KEY) {
    console.log('Anthropic API key detected (summarization enabled).');
  } else {
    console.warn('No Anthropic API key found! Summarization requests will fail.');
  }
});