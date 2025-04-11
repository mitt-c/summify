/**
 * Breaks text into chunks of approximately the specified size
 * Tries to break at meaningful boundaries (paragraphs, sentences, or code blocks)
 * Uses more intelligent boundary detection for better results
 */
export function chunkText(text: string, maxChunkSize: number = 8000): string[] {
  // If text is already small enough, return it as is
  if (text.length <= maxChunkSize) {
    return [text];
  }

  const chunks: string[] = [];
  let currentIndex = 0;
  
  // Look for code block and markdown section markers
  const codeBlockRegex = /```[\s\S]*?```/g;
  const headerRegex = /^#{1,6}\s+.+$/gm;
  const codeBlocks: { start: number, end: number }[] = [];
  const headers: number[] = [];
  
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
 * Utilities for handling API rate limits
 */

export interface RateLimitInfo {
  inputTokensRemaining?: number;
  outputTokensRemaining?: number;
  requestsRemaining?: number;
  resetTime?: string;
  retryAfter?: number;
}

/**
 * Extracts rate limit information from API response headers
 */
export function extractRateLimitInfo(headers?: Headers): RateLimitInfo {
  if (!headers) return {};
  
  return {
    inputTokensRemaining: parseInt(headers.get('anthropic-ratelimit-input-tokens-remaining') || '0'),
    outputTokensRemaining: parseInt(headers.get('anthropic-ratelimit-output-tokens-remaining') || '0'),
    requestsRemaining: parseInt(headers.get('anthropic-ratelimit-requests-remaining') || '0'),
    resetTime: headers.get('anthropic-ratelimit-tokens-reset') || undefined,
    retryAfter: parseInt(headers.get('retry-after') || '0')
  };
}

/**
 * Rate limit constants based on Claude tiers
 */
export const RateLimits = {
  // Using Claude 3.5 Haiku limits (most generous for basic tier)
  requestsPerMinute: 50,
  inputTokensPerMinute: 50000,
  outputTokensPerMinute: 10000,
  
  // Default model to use
  model: 'claude-3-5-sonnet-20240620',
  
  // Output tokens to request per call - optimized for performance
  defaultMaxTokens: 600, // Reduced for faster individual chunk processing
  metaSummaryMaxTokens: 1500, // Increased for more comprehensive meta-summaries
  
  // Parallel processing optimization
  maxChunksPerRequest: 3, // Reduced to prevent rate limit issues
  maxChunksTotal: 6, // Reduced to prevent rate limit issues
  maxBatches: 2, // Reduced for faster overall processing
  
  // Optimized chunk size in characters (reduced for faster processing)
  maxChunkSize: 20000, // Reduced for better balance
  
  // Temperature settings - lower for faster, more deterministic results
  defaultTemperature: 0.05, // Lower temperature for better performance
  metaSummaryTemperature: 0.15 // Slightly higher for better meta-summary generation
};

// Optimized model selection based on content size and processing needs
export function selectModelForContent(text: string): string {
  // For small content, always use Haiku for maximum speed
  if (text.length < 8000) {
    return 'claude-3-5-sonnet-20240620'; // Fastest option
  }
  // For larger content, still use Haiku but with optimized params
  else if (text.length < 25000) {
    return 'claude-3-5-sonnet-20240620'; // Good balance for medium content
  }
  // Only use Sonnet for very large content
  else {
    return 'claude-3-5-sonnet-20240620'; // For more complex content
  }
} 