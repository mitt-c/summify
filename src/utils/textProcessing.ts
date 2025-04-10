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
 * Performs rudimentary text analysis to determine if content is likely code or documentation
 */
export function detectContentType(text: string): 'code' | 'documentation' {
  // Look for common code indicators
  const codeIndicators = [
    // Code syntax indicators
    /function\s+\w+\s*\(/i,  // function definitions
    /class\s+\w+/i,  // class definitions
    /(const|let|var)\s+\w+\s*=/i,  // variable assignments
    /import\s+[\w\s,{}]*\s+from/i,  // import statements
    /\{\s*[\w\s]*:\s*[\w\s"']*\}/i,  // object literals
    /if\s*\([^)]*\)\s*\{/i,  // if statements with braces
    /<\w+(\s+\w+="[^"]*")*\s*>/i,  // HTML/XML tags
    /\[\s*[\w\s,'"]*\s*\]/i,  // array literals
    /=>/i,  // arrow functions
    /return\s+[\w\s.()]*;/i,  // return statements
  ];
  
  // Count occurrences of code indicators
  let codeIndicatorCount = 0;
  codeIndicators.forEach(regex => {
    const matches = text.match(new RegExp(regex, 'g'));
    if (matches) {
      codeIndicatorCount += matches.length;
    }
  });
  
  // Check for high code-specific character density
  const specialChars = text.match(/[{}[\]()<>:;=+\-*/%&|^!~?]/g)?.length || 0;
  const specialCharDensity = specialChars / text.length;
  
  // Simple heuristic: if either we have many code indicators or high special char density
  if (codeIndicatorCount > 5 || specialCharDensity > 0.05) {
    return 'code';
  }
  
  return 'documentation';
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
  defaultMaxTokens: 800, // Reduced from 1000 for faster responses
  metaSummaryMaxTokens: 1200, // Reduced from 1500 for faster responses
  
  // Parallel processing optimization
  maxChunksPerRequest: 4, // Increased from 3 for better parallelization
  
  // Optimized chunk size in characters (reduced for faster processing)
  maxChunkSize: 28000, // Reduced from 32000 for better balance
  
  // Temperature settings - lower for faster, more deterministic results
  defaultTemperature: 0.1, // Lower temperature for better performance
  metaSummaryTemperature: 0.15
};

// Optimized model selection based on content size and processing needs
export function selectModelForContent(text: string): string {
  // For very short content, use Haiku for maximum speed
  if (text.length < 5000) {
    return 'claude-3-5-haiku-latest'; // Fastest option for small content
  }
  // For medium content, still use Haiku but with optimized params
  else if (text.length < 12000) {
    return 'claude-3-5-haiku-20241022'; // Good balance for medium content
  }
  // For larger content, switch to Sonnet for better comprehension
  else {
    return 'claude-3-5-sonnet-20240620'; // Better quality for larger, more complex content
  }
} 