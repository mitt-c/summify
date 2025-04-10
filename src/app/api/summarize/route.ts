import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicApiKey, isApiConfigured } from '@/utils/env';
import { chunkText, detectContentType, extractRateLimitInfo, RateLimits, RateLimitInfo, selectModelForContent } from '@/utils/textProcessing';

// Initialize with API key
const apiKey = getAnthropicApiKey();
console.log("API Key configured:", isApiConfigured());

const anthropic = new Anthropic({
  apiKey,
});

// Prompts used for summarization
const SYSTEM_PROMPT = `You are an AI Documentation and Code Analysis Agent specializing in extracting key insights from technical content.

Your task is to analyze and summarize technical documents, code, or implementation details in a highly structured format.

You MUST follow these output format requirements:
1. Begin with a "## Overview" section that provides a high-level summary in 1-3 sentences
2. Include a "## Key Components" section with bullet points for main components/concepts
3. Include a "## Implementation Details" section with the most important technical specifics
4. If applicable, include a "## Usage Example" section showing how to use a component/api/function
5. End with a "## Limitations and Considerations" section that outlines any constraints or important notes

Use Markdown formatting for all output. Keep the summary clear, concise, and technically accurate.
Maintain a neutral, professional tone throughout.`;

// Enhanced primary summarization prompt with better content-specific guidance
const SUMMARY_PROMPT = `Analyze and extract key information from the following technical content.

Focus on:
- Core functionality and purpose
- Architecture and design patterns
- API interfaces and contracts
- Key algorithms or processing logic
- Dependencies and integration points

For CODE:
- Identify class/function relationships
- Note architectural patterns (MVC, observer, etc.)
- Highlight error handling approaches
- Extract API contracts and interfaces
- Focus on control flow and data transformations

For DOCUMENTATION:
- Extract conceptual frameworks
- Identify setup and configuration requirements
- Highlight best practices and recommendations
- Note versioning and compatibility information
- Capture user workflow patterns

Return your analysis in the structured format specified in your instructions, using Markdown formatting.`;

// Significantly enhanced meta-summarization prompt
const META_SUMMARY_PROMPT = `Synthesize the following section summaries into a coherent, unified technical summary.

IMPORTANT GUIDELINES:
1. CREATE A UNIFIED NARRATIVE - not just a collection of sections
2. RESOLVE CONTRADICTIONS between sections by favoring more specific information
3. ELIMINATE REDUNDANCY - consolidate repeated information
4. PRESERVE TECHNICAL PRECISION - maintain accuracy over brevity
5. ESTABLISH CLEAR HIERARCHIES - organize concepts from foundational to specific
6. CONNECT RELATED CONCEPTS across different sections
7. HIGHLIGHT CROSS-CUTTING CONCERNS that appear in multiple sections
8. MAINTAIN THE REQUIRED STRUCTURED FORMAT with all sections

For CODE meta-summaries:
- Reconstruct the overall architecture from component descriptions
- Create a mental model of the system's operation
- Connect implementation details to architectural patterns

For DOCUMENTATION meta-summaries:
- Organize information from conceptual to practical
- Establish relationships between different workflows
- Ensure configuration details connect to their relevant features

Below are summaries of different sections. Create a single coherent summary that follows the structured format in your instructions.`;

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
  
  // Detect if content is primarily code or documentation
  const contentType = detectContentType(text);
  console.log(`[Chunk ${chunkIndex !== undefined ? chunkIndex + 1 : 'single'}] Detected content type: ${contentType}`);
  
  // Adapt prompt based on content type
  let adaptedPrompt = SUMMARY_PROMPT;
  if (contentType === 'code') {
    adaptedPrompt = `${SUMMARY_PROMPT}\n\nThis content appears to be code. Focus on architecture, functions, classes, and implementation patterns. Include code structure and key algorithms.`;
  } else {
    adaptedPrompt = `${SUMMARY_PROMPT}\n\nThis content appears to be documentation. Focus on concepts, workflows, API details, and usage guidelines.`;
  }

  while (retryCount < maxRetries) {
    try {
      const apiStartTime = Date.now();
      
      const response = await anthropic.messages.create({
        model,
        max_tokens: 4000,
        temperature: RateLimits.defaultTemperature,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `${adaptedPrompt} ${text}`
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
        contentType,
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
  const combinedSummaries = summaries.join("\n\n---\n\n");
  const model = selectModelForContent(combinedSummaries);
  
  // Determine if we're summarizing mostly code or documentation
  const contentType = detectContentType(combinedSummaries);
  let adaptedMetaPrompt = META_SUMMARY_PROMPT;
  
  if (contentType === 'code') {
    adaptedMetaPrompt = `${META_SUMMARY_PROMPT}\n\nThis summary is primarily about code. Ensure your meta-summary emphasizes architecture, functions, and implementation patterns. Maintain the structured format.`;
  } else {
    adaptedMetaPrompt = `${META_SUMMARY_PROMPT}\n\nThis summary is primarily about documentation. Ensure your meta-summary emphasizes concepts, workflows, and usage guidelines. Maintain the structured format.`;
  }
  
  console.log(`Creating meta-summary from ${summaries.length} chunks (original content had ${originalChunkCount} chunks)`);
  console.log(`Using model: ${model} for meta-summary generation`);
  const startTime = Date.now();
  
  while (retryCount < maxRetries) {
    try {
      const apiStartTime = Date.now();
      const response = await anthropic.messages.create({
        model,
        max_tokens: 4000,
        temperature: RateLimits.metaSummaryTemperature,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `${adaptedMetaPrompt} Here are the individual summaries:\n\n${combinedSummaries}`
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
        processingTime,
        contentType
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
        rateLimitInfo: result.rateLimitInfo,
        contentType: result.contentType
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
        rateLimitInfo: summaries[0].rateLimitInfo,
        contentType: summaries[0].contentType
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
      rateLimitInfo: metaSummary.rateLimitInfo,
      contentType: metaSummary.contentType
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