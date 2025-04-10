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

const SUMMARY_PROMPT = `Analyze and extract key information from the following technical content.
Return your analysis in the structured format specified in your instructions, using Markdown formatting.
Focus on the most important concepts, components, and implementation details.`;

const META_SUMMARY_PROMPT = `Below are summaries of different sections of a document or codebase.
Synthesize these into a single coherent summary that follows the structured format specified in your instructions.
Ensure a logical flow between sections while maintaining the required markdown formatting.
Deduplicate overlapping information and prioritize the most important technical insights.`;

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
  const model = selectModelForContent(text);
  
  // Detect if content is primarily code or documentation
  const contentType = detectContentType(text);
  // Adapt prompt based on content type
  let adaptedPrompt = SUMMARY_PROMPT;
  if (contentType === 'code') {
    adaptedPrompt = `${SUMMARY_PROMPT}\n\nThis content appears to be code. Focus on architecture, functions, classes, and implementation patterns. Include code structure and key algorithms.`;
  } else {
    adaptedPrompt = `${SUMMARY_PROMPT}\n\nThis content appears to be documentation. Focus on concepts, workflows, API details, and usage guidelines.`;
  }
  
  while (retryCount < maxRetries) {
    try {
      const startTime = Date.now();
      
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
      
      const processingTime = Date.now() - startTime;
      console.log(`${model} processed chunk in ${processingTime}ms`);
      
      // Extract rate limit info from response headers if available
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
      
      console.error(`Error processing chunk: ${error.message}`);
      
      if (retryCount >= maxRetries) {
        console.error(`All ${maxRetries} retry attempts failed`);
        throw error;
      }
      
      console.log(`Waiting ${waitTime}ms before retry ${retryCount}`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  
  throw new Error("Failed to process chunk after retries");
}

// Function to create a meta-summary from individual summaries
async function createMetaSummary(summaries: string[]) {
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
  
  console.log(`Creating meta-summary from ${summaries.length} chunks`);
  
  while (retryCount < maxRetries) {
    try {
      const startTime = Date.now();
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
      
      const processingTime = Date.now() - startTime;
      console.log(`Meta-summary created in ${processingTime}ms using ${model}`);
      
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

export async function POST(request: NextRequest) {
  if (!isApiConfigured()) {
    return NextResponse.json({ error: 'API is not configured' }, { status: 401 });
  }

  const data = await request.json();
  const { text } = data;

  if (!text) {
    return NextResponse.json({ error: 'No text provided for summarization' }, { status: 400 });
  }

  try {
    const startTime = Date.now();
    
    // Determine processing strategy based on content size
    if (text.length <= 10000) {
      // For small content, process directly
      const result = await processChunk(text);
      
      return NextResponse.json({
        summary: result.summary,
        model: result.model,
        processingTime: `${Date.now() - startTime}ms`,
        rateLimitInfo: result.rateLimitInfo,
        contentType: result.contentType
      });
    }
    
    // For larger content, use chunking and parallel processing
    console.log('Chunking text');
    const chunks = chunkText(text, RateLimits.maxChunkSize);
    console.log(`Split into ${chunks.length} chunks`);

    // Limit number of chunks to process to manage API costs
    const chunksToProcess = chunks.slice(0, RateLimits.maxChunksPerRequest);
    if (chunksToProcess.length < chunks.length) {
      console.log(`Processing only first ${chunksToProcess.length} of ${chunks.length} chunks`);
    }

    // Process chunks in parallel
    console.log('Processing chunks in parallel');
    const chunkPromises = chunksToProcess.map(chunk => processChunk(chunk));
    
    let summaries;
    try {
      summaries = await Promise.all(chunkPromises);
    } catch (error) {
      // Fall back to sequential processing if parallel fails
      console.error('Parallel processing failed, falling back to sequential', error);
      summaries = [];
      for (const chunk of chunksToProcess) {
        summaries.push(await processChunk(chunk));
      }
    }
    
    // If only one chunk, return its summary
    if (summaries.length === 1) {
      return NextResponse.json({
        summary: summaries[0].summary,
        chunkCount: 1,
        processedChunks: 1,
        model: summaries[0].model,
        processingTime: `${Date.now() - startTime}ms`,
        rateLimitInfo: summaries[0].rateLimitInfo,
        contentType: summaries[0].contentType
      });
    }
    
    // For multiple chunks, create a meta-summary
    const summaryTexts = summaries.map(summary => summary.summary);
    const metaSummary = await createMetaSummary(summaryTexts);
    
    return NextResponse.json({
      summary: metaSummary.summary,
      chunkCount: chunks.length,
      processedChunks: chunksToProcess.length,
      model: metaSummary.model,
      processingTime: `${Date.now() - startTime}ms`,
      rateLimitInfo: metaSummary.rateLimitInfo,
      contentType: metaSummary.contentType
    });
  } catch (error: any) {
    console.error('Error during summarization:', error);
    
    // Handle rate limits and overloads specially
    if (error.status === 429) {
      const retryAfter = error.headers?.get('retry-after') || 60;
      return NextResponse.json({ 
        error: `Rate limit exceeded. Please try again later.`, 
        retryAfter 
      }, { status: 429 });
    }
    
    if (error.status === 503) {
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