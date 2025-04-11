import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicApiKey, isApiConfigured } from '@/utils/env';
import { chunkText, extractRateLimitInfo, RateLimits, RateLimitInfo, selectModelForContent } from '@/utils/textProcessing';

// Initialize with API key
const apiKey = getAnthropicApiKey();
console.log("API Key configured:", isApiConfigured());

const anthropic = new Anthropic({
  apiKey,
});

// Prompts used for summarization
const SYSTEM_PROMPT = `You are an AI Documentation and Code Analysis Agent specializing in extracting business-critical insights from technical content.

Your task is to analyze technical documents or code and create summaries that maximize knowledge transfer and developer productivity.

You MUST follow these output format requirements:
1. Begin with a "## Key Takeaways" section highlighting the 2-3 most important insights for developers
2. Include a "## Core Concepts" section with bullet points for main components/concepts explained in plain language
3. Include a "## Implementation Path" section with specific steps needed to make it work successfully
4. Add a "## Time-Saving Patterns" section that highlights reusable strategies applicable across projects
5. Include a "## Risk Mitigation" section with common errors, debugging tips, architectural anti-patterns, and security considerations
6. Add a "## Problem Areas" section that identifies technical debt, unclear explanations, missing documentation, or problematic implementations
7. End with a "## Business Impact" section that outlines efficiency gains, cost savings, or other business value

Keep language clear and concise. Aim to save developer time through effective knowledge transfer.

Here are examples of well-formatted summaries for both code and documentation:

EXAMPLE CODE SUMMARY:
## Key Takeaways
- This authentication service implements JWT token validation with role-based access control
- Uses a Redis cache to minimize database lookups, reducing latency by ~80%

## Core Concepts
- **JWT Authentication**: Stateless token validation with encoded permissions
- **Role Hierarchy**: Admin > Manager > User permission cascade
- **Cache Strategy**: Two-tier caching (in-memory + Redis) with 15-minute TTL

## Implementation Path
1. Initialize the AuthClient with your API keys
2. Call auth.validateToken() before protected route handlers
3. Check permissions with auth.hasAccess(user, requiredRole)
4. Refresh tokens via auth.refreshTokens() when expired

## Time-Saving Patterns
- Use AuthGuard middleware pattern to avoid repetitive checks
- Leverage batch token validation for sequential API calls
- Implement exception-based flow rather than verbose condition checking

## Risk Mitigation
- Token hijacking: Implement IP binding with auth.linkToClientIP()
- Cache poisoning: Set strict TTL and validate against source-of-truth on write
- Failed refresh: Implement auth.gracefulDegradation() for outage handling
- DoS vulnerability: Enable auth.enableRateLimiting() in production

## Problem Areas
- The refresh token logic lacks atomic operations, creating race conditions under high load
- Error messages in validateToken() are cryptic and unhelpful for debugging
- The caching layer has no test coverage, making refactoring risky
- Role management is tightly coupled to the authentication service, violating separation of concerns

## Business Impact
- Reduces authentication overhead from ~120ms to ~15ms per request
- Cuts server load by 40% through optimized token validation
- Projected savings of 2-3 development days per project through reusable patterns
- Enables compliance with SOC2 and GDPR through audit trail options

EXAMPLE DOCUMENTATION SUMMARY:
## Key Takeaways
- AWS Lambda cold starts can be reduced by 70% using provisioned concurrency
- Lambda Layers should be used for dependencies >5MB to optimize deployment

## Core Concepts
- **Provisioned Concurrency**: Pre-initialized Lambda instances
- **Lambda Layers**: Reusable code packages shared across functions
- **Execution Context Reuse**: Strategy to maintain state between invocations

## Implementation Path
1. Analyze current Lambda metrics for cold start frequency
2. Apply provisioned concurrency to high-traffic functions via AWS CLI or Console
3. Move dependencies to Lambda Layers with compatibility version tagging
4. Implement keep-warm mechanisms for non-provisioned functions

## Time-Saving Patterns
- Use CloudFormation templates for consistent Lambda configurations
- Implement shared testing framework for Lambda unit and integration tests
- Apply parameter store pattern for configuration rather than environment variables

## Risk Mitigation
- Cost overruns: Implement auto-scaling of provisioned concurrency based on traffic
- Missing dependencies: Use layer versioning and compatibility check scripts
- Wrong IAM permissions: Apply least-privilege templates from security-validated repository
- Cold starts in VPC: Place Lambdas in private subnets with pre-allocated ENIs

## Problem Areas
- Documentation fails to address cross-account layer sharing limitations
- Cost implications of provisioned concurrency are understated and lack real-world examples
- The section on VPC connectivity is outdated and doesn't reflect 2023 AWS improvements
- No mention of Lambda function URL security considerations or custom domain setup

## Business Impact
- Saves 1-2 days of debugging time per development cycle
- Reduces average API latency by 65% on first request
- Lowers Lambda costs by 30% through optimized execution and shared layers
- Enables standard deployment patterns that reduce onboarding time by 50%`;

// Optimized primary summarization prompt
const SUMMARY_PROMPT = `Analyze the following technical content and create a summary that maximizes knowledge transfer and developer productivity.

Examine the content and determine whether it's primarily CODE or DOCUMENTATION:
- CODE: Source files, scripts, API implementations, class definitions
- DOCS: Tutorials, architecture overviews, configuration guides, API references

For CODE content:
- Focus on implementation patterns, reusable components, and error-handling approaches that save time
- Flag complex logic blocks that would benefit from additional documentation
- Identify optimization opportunities in the implementation
- Scrutinize for potential bugs, performance bottlenecks, security issues, or maintainability problems
- Look for code smells, tight coupling, or overly complex implementations that could be refactored

For DOCS content:
- Focus on workflows, configuration shortcuts, and best practices that prevent common pitfalls
- Identify any missing information that would help developers implement more effectively
- Highlight areas where documentation could be expanded for clarity
- Identify outdated information, contradictions, or unclear explanations
- Flag sections where examples are missing, incomplete, or don't follow best practices

Your goal is to create a summary that would save a developer hours of reading time while preserving all essential information for successful implementation.`;

// Optimized meta-summarization prompt
const META_SUMMARY_PROMPT = `Synthesize these section summaries into a unified technical summary that maximizes business value and developer productivity.

Guidelines:
1. Consolidate repetitive concepts across sections
2. Highlight workflows that reduce implementation time 
3. Identify patterns that can be reused across projects
4. Quantify potential time savings using these reference benchmarks:
   - Simple implementation: 2-4 hours saved
   - Medium complexity: 1-2 days saved
   - Architectural impact: Weeks saved
5. Emphasize scalable approaches that work across team boundaries
6. Flag any efficiency bottlenecks or areas for optimization
7. Structure information to minimize cognitive load for new developers
8. Consolidate problem areas to highlight systemic issues or recurring challenges

Examine the content and determine whether it's primarily CODE or DOCUMENTATION:
- For CODE: Emphasize architectural patterns that promote maintainability and team collaboration
- For DOCS: Highlight onboarding shortcuts and knowledge-sharing approaches

Prioritize insights that:
1. Enable cross-team collaboration
2. Reduce onboarding time for new developers
3. Prevent production incidents
4. Optimize cloud resource usage
5. Address technical debt or recurring pain points

Below are summaries of different sections. Create a cohesive summary that maximizes knowledge transfer efficiency.

Here's an example of a good meta-summary:

## Key Takeaways
- This distributed caching system reduces API response times by 80% (from 120ms to 24ms)
- Implements a write-through cache pattern with conflict resolution to prevent data inconsistency

## Core Concepts
- **Multi-level Caching**: Browser → CDN → API cache → Database approach
- **Cache Invalidation**: Event-driven invalidation with version control
- **Conflict Resolution**: Last-write-wins with vector clocks for distributed scenarios

## Implementation Path
1. Configure Redis cluster with the provided terraform modules
2. Implement CacheClient with appropriate serialization for your data types
3. Add cache lookup before database queries using the middleware pattern
4. Set up cache invalidation consumers for the messaging system

## Time-Saving Patterns
- Use the CacheAside decorator on repository methods to simplify cache logic
- Implement BackgroundRefresh pattern to eliminate cache misses during high traffic
- Apply CircuitBreaker pattern for graceful degradation when cache is unavailable

## Risk Mitigation
- Memory pressure: Implement TTL-based eviction policies with size limits
- Network partition: Configure fallback to database with automatic reconnection
- Cache stampede: Apply exponential backoff and jitter to refresh attempts
- Data leakage: Enable encryption-at-rest and sanitize sensitive fields

## Problem Areas
- The Redis connection pooling is not optimally configured, leading to connection exhaustion
- Serialization/deserialization overhead negates some performance benefits for small objects
- Error handling in the invalidation consumers lacks dead-letter-queue integration
- Documentation for custom cache key generation is missing, leading to frequent key collisions

## Business Impact
- Reduces infrastructure costs by approximately $12,000/year through improved efficiency
- Saves 3+ development days per project by standardizing caching approaches
- Improves user experience with 80% faster page loads and reduced timeouts
- Enables scaling to 5x current traffic without additional database resources`;

// Helper function to safely extract rate limit info from response
function getRateLimitInfo(response: any): RateLimitInfo {
  try {
    if (response && response.headers) {
      return extractRateLimitInfo(response.headers);
    }
    return {};
  } catch (error) {
    console.error("Error extracting rate limit info:", error);
    return {};
  }
}

// Function to process a single chunk of text with retry logic
async function processChunk(text: string, chunkIndex?: number) {
  const maxRetries = 3;
  let retryCount = 0;
  const model = selectModelForContent(text);
  
  // Log start of chunk processing with timing
  const startTime = Date.now();
  console.log(`[Chunk ${chunkIndex !== undefined ? chunkIndex + 1 : 'single'}] Starting processing (${text.length} chars) with ${model}`);
  
  while (retryCount < maxRetries) {
    try {
      const apiStartTime = Date.now();
      
      const response = await anthropic.messages.create({
        model,
        max_tokens: RateLimits.defaultMaxTokens,
        temperature: RateLimits.defaultTemperature,
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
      
      // Extract rate limit info from response headers if available
      const rateLimitInfo = getRateLimitInfo(response);
      if (rateLimitInfo.requestsRemaining !== undefined) {
        console.log(`[Chunk ${chunkIndex !== undefined ? chunkIndex + 1 : 'single'}] Rate limits - Requests remaining: ${rateLimitInfo.requestsRemaining}`);
      }
      
      return {
        summary: response.content[0].text,
        rateLimitInfo,
        model,
        processingTime,
        chunkIndex
      };
    } catch (error: any) {
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

// Function to create a meta-summary from individual summaries
async function createMetaSummary(summaries: string[], originalChunkCount: number) {
  const maxRetries = 3;
  let retryCount = 0;
  
  // Add section numbers for better context
  const numberedSummaries = summaries.map((summary, index) => 
    `## Section ${index + 1} of ${summaries.length}\n\n${summary}`
  );
  
  const combinedSummaries = numberedSummaries.join("\n\n---\n\n");
  // Always use Sonnet for meta-summaries to ensure best quality
  const model = 'claude-3-5-sonnet-20240620';
  
  console.log(`Creating meta-summary from ${summaries.length} chunks (original content had ${originalChunkCount} chunks)`);
  console.log(`Using model: ${model} for meta-summary generation`);
  const startTime = Date.now();
  
  while (retryCount < maxRetries) {
    try {
      const apiStartTime = Date.now();
      const response = await anthropic.messages.create({
        model,
        max_tokens: RateLimits.metaSummaryMaxTokens,
        temperature: RateLimits.metaSummaryTemperature,
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
      
      // Extract rate limit info
      const rateLimitInfo = getRateLimitInfo(response);
      
      return {
        summary: response.content[0].text,
        rateLimitInfo,
        model,
        processingTime
      };
    } catch (error: any) {
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

// Optimized chunk processing with adaptive batching
async function processChunksInParallel(chunks: string[], maxParallelCalls = RateLimits.maxChunksPerRequest) {
  console.log(`Starting to process ${chunks.length} chunks with max ${maxParallelCalls} in parallel`);
  
  // For very large inputs, use adaptive batching
  if (chunks.length > maxParallelCalls * 2) {
    console.log(`Large document detected (${chunks.length} chunks). Using adaptive batch processing.`);
    return await processBatches(chunks, maxParallelCalls);
  }
  
  // For smaller inputs, process all chunks in one parallel batch
  console.log(`Processing all ${chunks.length} chunks in parallel (up to ${maxParallelCalls} concurrent calls)`);
  try {
    // Create an array of promises, each processing a chunk
    const chunkPromises = chunks.slice(0, maxParallelCalls).map((chunk, index) => 
      processChunk(chunk, index)
    );
    
    // Wait for all chunks to be processed
    const results = await Promise.all(chunkPromises);
    console.log(`Successfully processed all ${results.length} chunks in parallel`);
    return results;
  } catch (error) {
    console.error('Parallel processing failed:', error);
    console.log('Falling back to sequential processing');
    
    // Fall back to sequential processing
    const results = [];
    for (let i = 0; i < Math.min(chunks.length, maxParallelCalls); i++) {
      console.log(`Sequential processing: chunk ${i + 1}/${Math.min(chunks.length, maxParallelCalls)}`);
      results.push(await processChunk(chunks[i], i));
    }
    return results;
  }
}

// Process chunks in batches to avoid overloading API
async function processBatches(chunks: string[], batchSize: number) {
  console.log(`Processing ${chunks.length} chunks in batches of ${batchSize}`);
  const results = [];
  const batchCount = Math.ceil(chunks.length / batchSize);
  
  for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
    if (batchIndex >= RateLimits.maxBatches) {
      console.log(`Reached maximum batch limit (${RateLimits.maxBatches}). Stopping processing.`);
      break;
    }
    
    const start = batchIndex * batchSize;
    const end = Math.min(start + batchSize, chunks.length);
    const batchChunks = chunks.slice(start, end);
    
    console.log(`Processing batch ${batchIndex + 1}/${batchCount} (chunks ${start + 1}-${end} of ${chunks.length})`);
    
    try {
      // Process batch in parallel
      const batchPromises = batchChunks.map((chunk, index) => 
        processChunk(chunk, start + index)
      );
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      console.log(`Batch ${batchIndex + 1} completed: processed ${batchResults.length} chunks`);
      
      // Small delay between batches to avoid rate limiting
      if (batchIndex < batchCount - 1) {
        const delayTime = 1000; // 1 second delay
        console.log(`Waiting ${delayTime}ms before next batch`);
        await new Promise(resolve => setTimeout(resolve, delayTime));
      }
    } catch (error) {
      console.error(`Error processing batch ${batchIndex + 1}:`, error);
      
      // Fall back to sequential processing for this batch
      console.log(`Falling back to sequential processing for batch ${batchIndex + 1}`);
      for (const chunk of batchChunks) {
        try {
          const result = await processChunk(chunk, results.length);
          results.push(result);
        } catch (error) {
          console.error(`Failed to process chunk ${results.length} sequentially:`, error);
          // Continue with next chunk if one fails
        }
      }
    }
  }
  
  console.log(`Completed processing ${results.length} chunks out of ${chunks.length}`);
  return results;
}

export async function POST(request: NextRequest) {
  if (!isApiConfigured()) {
    return NextResponse.json({ error: 'API is not configured' }, { status: 401 });
  }

  const data = await request.json();
  const { text } = data;

  if (!text) {
    return NextResponse.json({ error: 'No text provided for summarization' }, { status: 400 });
  }

  console.log(`==========================================`);
  console.log(`Starting new summarization request`);
  console.log(`Content length: ${text.length} characters`);

  try {
    const startTime = Date.now();
    
    // Determine processing strategy based on content size
    if (text.length <= 10000) {
      // For small content, process directly
      console.log(`Small content detected (${text.length} chars). Processing directly.`);
      const result = await processChunk(text);
      
      const totalTime = Date.now() - startTime;
      console.log(`Completed small content summarization in ${totalTime}ms`);
      
      return NextResponse.json({
        summary: result.summary,
        model: result.model,
        processingTime: `${totalTime}ms`,
        rateLimitInfo: result.rateLimitInfo
      });
    }
    
    // For larger content, use chunking and parallel processing
    console.log(`Large content detected (${text.length} chars). Using chunk-based processing.`);
    console.log('Chunking text...');
    const chunkStartTime = Date.now();
    const chunks = chunkText(text, RateLimits.maxChunkSize);
    console.log(`Chunking completed in ${Date.now() - chunkStartTime}ms. Split into ${chunks.length} chunks.`);

    // Process a limited number of chunks based on resource constraints
    const chunksToProcess = chunks.slice(0, RateLimits.maxChunksTotal);
    if (chunksToProcess.length < chunks.length) {
      console.log(`Content exceeds processing limit. Processing first ${chunksToProcess.length} of ${chunks.length} chunks.`);
    }

    // Process chunks with optimized batching
    console.log(`Starting optimized parallel processing of ${chunksToProcess.length} chunks`);
    const processStartTime = Date.now();
    const summaries = await processChunksInParallel(chunksToProcess);
    console.log(`Chunk processing completed in ${Date.now() - processStartTime}ms`);
    
    // If only one chunk was processed, return its summary
    if (summaries.length === 1) {
      const totalTime = Date.now() - startTime;
      console.log(`Single chunk summary completed in ${totalTime}ms`);
      
      return NextResponse.json({
        summary: summaries[0].summary,
        chunkCount: chunks.length,
        processedChunks: 1,
        model: summaries[0].model,
        processingTime: `${totalTime}ms`,
        rateLimitInfo: summaries[0].rateLimitInfo
      });
    }
    
    // For multiple chunks, create a meta-summary
    console.log(`Creating meta-summary from ${summaries.length} processed chunks`);
    const metaSummaryStartTime = Date.now();
    const summaryTexts = summaries.map(summary => summary.summary);
    const metaSummary = await createMetaSummary(summaryTexts, chunks.length);
    console.log(`Meta-summary creation completed in ${Date.now() - metaSummaryStartTime}ms`);
    
    const totalTime = Date.now() - startTime;
    console.log(`Complete summarization process finished in ${totalTime}ms`);
    
    return NextResponse.json({
      summary: metaSummary.summary,
      chunkCount: chunks.length,
      processedChunks: chunksToProcess.length,
      model: metaSummary.model,
      processingTime: `${totalTime}ms`,
      rateLimitInfo: metaSummary.rateLimitInfo
    });
  } catch (error: any) {
    console.error('Error during summarization:', error);
    
    // Handle rate limits and overloads specially
    if (error.status === 429) {
      const retryAfter = error.headers?.get('retry-after') || 60;
      console.error(`Rate limit exceeded. Retry after: ${retryAfter}s`);
      return NextResponse.json({ 
        error: `Rate limit exceeded. Please try again later.`, 
        retryAfter
      }, { status: 429 });
    }
    
    if (error.status === 503) {
      console.error('AI service overloaded');
      return NextResponse.json({ 
        error: `The AI service is currently overloaded. Please try again later.`, 
        isOverloaded: true 
      }, { status: 503 });
    }
    
    return NextResponse.json({ 
      error: `Summarization failed: ${error.message}`
    }, { status: 500 });
  }
}