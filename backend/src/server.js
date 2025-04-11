const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { Anthropic } = require('@anthropic-ai/sdk');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || '*', // Allow specified frontend or all origins in development
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' })); // Increased limit for larger texts

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Constants and configuration
const MAX_CHUNK_SIZE = 20000;

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

Keep language clear and concise. Aim to save developer time through effective knowledge transfer.`;

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

Below are summaries of different sections. Create a cohesive summary that maximizes knowledge transfer efficiency.`;

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
  const model = 'claude-3-5-sonnet-20240620';
  
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

// API Routes
// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Main summarization endpoint
app.post('/api/summarize', async (req, res) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'No text provided for summarization' });
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
      
      return res.json({
        summary: result.summary,
        model: result.model,
        processingTime: `${totalTime}ms`
      });
    }
    
    // For larger content, use chunking
    console.log(`Large content detected (${text.length} chars). Using chunk-based processing.`);
    console.log('Chunking text...');
    const chunkStartTime = Date.now();
    const chunks = chunkText(text);
    console.log(`Chunking completed in ${Date.now() - chunkStartTime}ms. Split into ${chunks.length} chunks.`);

    // Process chunks sequentially to avoid rate limits
    console.log(`Processing ${chunks.length} chunks sequentially`);
    const summaries = [];
    const processStartTime = Date.now();
    
    for (let i = 0; i < chunks.length; i++) {
      console.log(`Processing chunk ${i + 1}/${chunks.length}`);
      const result = await processChunk(chunks[i], i);
      summaries.push(result.summary);
    }
    
    console.log(`Chunk processing completed in ${Date.now() - processStartTime}ms`);
    
    // If only one chunk was processed, return its summary
    if (summaries.length === 1) {
      const totalTime = Date.now() - startTime;
      console.log(`Single chunk summary completed in ${totalTime}ms`);
      
      return res.json({
        summary: summaries[0],
        chunkCount: chunks.length,
        processedChunks: 1,
        model: 'claude-3-5-sonnet-20240620',
        processingTime: `${totalTime}ms`
      });
    }
    
    // For multiple chunks, create a meta-summary
    console.log(`Creating meta-summary from ${summaries.length} processed chunks`);
    const metaSummaryStartTime = Date.now();
    const metaSummary = await createMetaSummary(summaries, chunks.length);
    console.log(`Meta-summary creation completed in ${Date.now() - metaSummaryStartTime}ms`);
    
    const totalTime = Date.now() - startTime;
    console.log(`Complete summarization process finished in ${totalTime}ms`);
    
    return res.json({
      summary: metaSummary.summary,
      chunkCount: chunks.length,
      processedChunks: chunks.length,
      model: metaSummary.model,
      processingTime: `${totalTime}ms`
    });
  } catch (error) {
    console.error('Error during summarization:', error);
    
    // Handle rate limits and overloads specially
    if (error.status === 429) {
      const retryAfter = error.headers?.get('retry-after') || 60;
      console.error(`Rate limit exceeded. Retry after: ${retryAfter}s`);
      return res.status(429).json({ 
        error: `Rate limit exceeded. Please try again later.`, 
        retryAfter
      });
    }
    
    if (error.status === 503) {
      console.error('AI service overloaded');
      return res.status(503).json({ 
        error: `The AI service is currently overloaded. Please try again later.`, 
        isOverloaded: true 
      });
    }
    
    return res.status(500).json({ 
      error: `Summarization failed: ${error.message}`
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API is${process.env.ANTHROPIC_API_KEY ? '' : ' NOT'} configured with Anthropic API key`);
});
