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
async function processChunk(text: string) {
  const maxRetries = 3;
  let retryCount = 0;
  let lastError = null;

  while (retryCount < maxRetries) {
    try {
      console.log(`Processing chunk of ${text.length} characters (attempt ${retryCount + 1})`);
      
      const systemPrompt = `You are an expert at summarizing technical information, specializing in extracting key insights from documentation, code, and technical content. 
Focus on identifying:
1. Main concepts and their definitions
2. Core functionality and architecture
3. Key relationships between components
4. Important implementation details
5. Significant constraints or limitations

Your summaries should be well-structured, technically accurate, and preserve the most important information while removing redundancy.`;

      const userPrompt = `Extract and summarize the key information from the following content. 
Focus on the most important concepts, functionalities, and implementation details.
Make your summary clear, concise, and technically accurate.

${text}`;

      // Select appropriate model based on content size
      const model = selectModelForContent(text);
      console.log(`Using model: ${model} for chunk of size ${text.length}`);

      const response = await anthropic.messages.create({
        model: model,
        max_tokens: RateLimits.defaultMaxTokens,
        temperature: RateLimits.defaultTemperature, // Use optimized temperature setting
        messages: [
          { role: 'user', content: userPrompt }
        ],
        system: systemPrompt
      });
      
      return {
        summary: response.content[0].text,
        rateLimitInfo: getRateLimitInfo(response),
        model: model
      };
    } catch (error) {
      lastError = error;
      
      // Check if the error is because the service is overloaded (529)
      if (error instanceof Anthropic.APIError && error.status === 529) {
        retryCount++;
        if (retryCount < maxRetries) {
          // Exponential backoff: wait longer between each retry
          const backoffMs = 1000 * Math.pow(2, retryCount);
          console.log(`API overloaded, retrying in ${backoffMs/1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          continue;
        }
      }
      
      // For other errors or if we've exhausted retries, throw the error
      console.error("Error processing chunk:", error);
      throw error;
    }
  }
  
  // If we've exhausted retries, throw the last error
  throw lastError;
}

// Function to create a meta-summary from individual summaries
async function createMetaSummary(summaries: string[]) {
  const maxRetries = 3;
  let retryCount = 0;
  let lastError = null;

  while (retryCount < maxRetries) {
    try {
      console.log(`Creating meta-summary from ${summaries.length} summaries (attempt ${retryCount + 1})`);
      
      const systemPrompt = `You are an expert at synthesizing information from multiple summaries into a cohesive whole. 
Your task is to create a well-structured, comprehensive summary that integrates key insights from all source summaries.
Eliminate redundancy while preserving the most important technical information.`;

      const userPrompt = `Below are summaries of different sections of a document or codebase. 
Please synthesize these into a single coherent summary that captures all the important aspects.
Structure your summary logically with clear sections.

${summaries.join('\n\n--- NEXT SECTION ---\n\n')}`;

      // Always use Sonnet for meta-summaries to ensure high quality integration
      const model = 'claude-3-5-sonnet-20240620';
      console.log(`Using model: ${model} for meta-summary`);

      const response = await anthropic.messages.create({
        model: model,
        max_tokens: RateLimits.metaSummaryMaxTokens,
        temperature: RateLimits.metaSummaryTemperature, // Use optimized temperature setting
        messages: [
          { role: 'user', content: userPrompt }
        ],
        system: systemPrompt
      });
      
      return {
        summary: response.content[0].text,
        rateLimitInfo: getRateLimitInfo(response),
        model: model
      };
    } catch (error) {
      lastError = error;
      
      // Check if the error is because the service is overloaded (529)
      if (error instanceof Anthropic.APIError && error.status === 529) {
        retryCount++;
        if (retryCount < maxRetries) {
          // Exponential backoff: wait longer between each retry
          const backoffMs = 1000 * Math.pow(2, retryCount);
          console.log(`API overloaded, retrying meta-summary in ${backoffMs/1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          continue;
        }
      }
      
      // For other errors or if we've exhausted retries, throw the error
      console.error("Error creating meta-summary:", error);
      throw error;
    }
  }
  
  // If we've exhausted retries, throw the last error
  throw lastError;
}

export async function POST(request: NextRequest) {
  try {
    const { text } = await request.json();
    
    if (!text) {
      return NextResponse.json(
        { error: 'Text is required' }, 
        { status: 400 }
      );
    }
    
    if (!isApiConfigured()) {
      return NextResponse.json(
        { error: 'API key not configured' },
        { status: 500 }
      );
    }

    // Process based on text length
    if (text.length <= 10000) {
      // For shorter texts, process directly
      const { summary, rateLimitInfo, model } = await processChunk(text);
      
      return NextResponse.json({ 
        summary,
        model,
        rateLimitInfo
      });
    } else {
      // For longer texts, use chunking approach with parallel processing
      const chunks = chunkText(text, RateLimits.maxChunkSize);
      const processableChunks = chunks.slice(0, RateLimits.maxChunksPerRequest);
      console.log(`Processing ${processableChunks.length} chunks out of ${chunks.length} total`);
      
      try {
        // Process chunks in parallel for significant performance improvement
        console.log("Using parallel processing for chunks");
        const startTime = Date.now();
        
        const chunkResults = await Promise.all(
          processableChunks.map(chunk => processChunk(chunk))
        );
        
        const processingTime = Date.now() - startTime;
        console.log(`Parallel processing completed in ${processingTime}ms`);
        
        const summaries = chunkResults.map(result => result.summary);
        const lastRateLimitInfo = chunkResults[chunkResults.length - 1].rateLimitInfo;
        const usedModel = chunkResults[0].model;
        
        // Create meta-summary if needed
        let finalSummary, finalRateLimitInfo, finalModel;
        if (summaries.length > 1) {
          const metaSummaryResult = await createMetaSummary(summaries);
          finalSummary = metaSummaryResult.summary;
          finalRateLimitInfo = metaSummaryResult.rateLimitInfo;
          finalModel = metaSummaryResult.model;
        } else {
          finalSummary = summaries[0];
          finalRateLimitInfo = lastRateLimitInfo;
          finalModel = usedModel;
        }
        
        return NextResponse.json({ 
          summary: finalSummary,
          model: finalModel,
          chunkCount: chunks.length,
          processedChunks: summaries.length,
          processingTime: `${processingTime}ms (parallel)`,
          rateLimitInfo: finalRateLimitInfo,
          modelInfo: `Used ${finalModel} for summarization.`
        });
      } catch (error) {
        console.log("Parallel processing failed, falling back to sequential processing", error);
        
        // Fall back to sequential processing if parallel fails (e.g., due to rate limits)
        const startTime = Date.now();
        let summaries: string[] = [];
        let lastRateLimitInfo = {};
        let usedModel = '';
        
        // Process each chunk separately
        for (const chunk of processableChunks) {
          const { summary, rateLimitInfo, model } = await processChunk(chunk);
          summaries.push(summary);
          lastRateLimitInfo = rateLimitInfo;
          usedModel = model;
          
          // Stop if we're getting close to rate limits
          if (rateLimitInfo.requestsRemaining && rateLimitInfo.requestsRemaining < 3) {
            console.log("Approaching rate limits, stopping chunk processing");
            break;
          }
        }
        
        const processingTime = Date.now() - startTime;
        console.log(`Sequential processing completed in ${processingTime}ms`);
        
        // Create meta-summary if needed
        let finalSummary, finalRateLimitInfo, finalModel;
        if (summaries.length > 1) {
          const metaSummaryResult = await createMetaSummary(summaries);
          finalSummary = metaSummaryResult.summary;
          finalRateLimitInfo = metaSummaryResult.rateLimitInfo;
          finalModel = metaSummaryResult.model;
        } else {
          finalSummary = summaries[0];
          finalRateLimitInfo = lastRateLimitInfo;
          finalModel = usedModel;
        }
        
        return NextResponse.json({ 
          summary: finalSummary,
          model: finalModel,
          chunkCount: chunks.length,
          processedChunks: summaries.length,
          processingTime: `${processingTime}ms (sequential)`,
          rateLimitInfo: finalRateLimitInfo,
          modelInfo: `Used ${finalModel} for summarization.`
        });
      }
    }
  } catch (error) {
    console.error('Error during summarization:', error);
    
    if (error instanceof Anthropic.APIError) {
      if (error.status === 401) {
        return NextResponse.json(
          { error: 'Invalid API key' },
          { status: 401 }
        );
      }
      
      if (error.status === 429) {
        // Extract retry-after header if available
        let retrySeconds = 60;
        
        // Safely check for headers property
        const errorHeaders = error.headers as unknown as Headers;
        if (errorHeaders && typeof errorHeaders.get === 'function') {
          try {
            const retryHeader = errorHeaders.get('retry-after');
            if (retryHeader) {
              retrySeconds = parseInt(retryHeader, 10) || 60;
            }
          } catch (headerError) {
            console.error('Error accessing headers:', headerError);
          }
        }
        
        return NextResponse.json(
          { 
            error: 'Rate limit exceeded. Please try again later.',
            retryAfter: retrySeconds
          },
          { status: 429 }
        );
      }
      
      // Handle overloaded API errors (529)
      if (error.status === 529) {
        return NextResponse.json(
          { 
            error: 'The AI service is currently experiencing high demand. Please try again in a few moments.',
            isOverloaded: true
          },
          { status: 503 }  // Service Unavailable is more appropriate for client display
        );
      }
    }
    
    return NextResponse.json(
      { error: 'Failed to summarize text' },
      { status: 500 }
    );
  }
} 