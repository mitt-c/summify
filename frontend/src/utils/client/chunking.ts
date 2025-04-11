/**
 * Client-side utilities for chunking and processing large texts
 * Designed to work around Vercel's 10-second function timeout limit
 */

// Maximum chunk size to ensure processing within the Vercel timeout
const MAX_CHUNK_SIZE = 5000;

/**
 * Interface for tracking chunked processing progress
 */
export interface ChunkProgress {
  total: number;
  processed: number;
  inProgress: boolean;
  processingChunk?: number;
}

/**
 * Client-side implementation of the chunkText function
 * Breaks text into smaller pieces that can be processed within Vercel's timeout limit
 */
export function chunkTextForClient(text: string): string[] {
  // If text is already small enough, return it as is
  if (text.length <= MAX_CHUNK_SIZE) {
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
    let endIndex = Math.min(currentIndex + MAX_CHUNK_SIZE, text.length);
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
 * Process a single chunk of text through the summarize API
 */
export async function processSingleChunk(chunk: string) {
  // Get the backend URL from environment variable
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';
  
  // Create an AbortController for timeout handling
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
  
  try {
    // Send the request to the backend API
    const response = await fetch(`${backendUrl}/api/summarize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: chunk }),
      signal: controller.signal
    });
    
    // Clear the timeout
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const data = await response.json();
      if (response.status === 429 && data.retryAfter) {
        throw new Error(`Rate limit exceeded. Please try again in ${data.retryAfter} seconds.`);
      }
      if (response.status === 503 && data.isOverloaded) {
        throw new Error(`${data.error} This is a temporary issue with the AI service.`);
      }
      throw new Error(data.error || 'Failed to summarize');
    }
    
    return await response.json();
  } catch (error: any) {
    // Clear the timeout to prevent potential memory leaks
    clearTimeout(timeoutId);
    
    // Handle specific abort error
    if (error.name === 'AbortError') {
      throw new Error('Request timed out. The backend service may be experiencing high load.');
    }
    
    // Re-throw other errors
    throw error;
  }
}

/**
 * Extract and merge sections from multiple summaries
 */
export function mergeSummaries(summaries: string[]): string {
  // Section patterns to extract from summaries
  const sectionPatterns = {
    keyTakeaways: /## Key Takeaways\s*([\s\S]*?)(?=\s*##|$)/i,
    coreConcepts: /## Core Concepts\s*([\s\S]*?)(?=\s*##|$)/i,
    implementationPath: /## Implementation Path\s*([\s\S]*?)(?=\s*##|$)/i,
    timeSavingPatterns: /## Time-Saving Patterns\s*([\s\S]*?)(?=\s*##|$)/i,
    riskMitigation: /## Risk Mitigation\s*([\s\S]*?)(?=\s*##|$)/i,
    problemAreas: /## Problem Areas\s*([\s\S]*?)(?=\s*##|$)/i,
    businessImpact: /## Business Impact\s*([\s\S]*?)(?=\s*##|$)/i,
  };
  
  // Store all extracted sections
  const extractedSections: Record<string, string[]> = {
    keyTakeaways: [],
    coreConcepts: [],
    implementationPath: [],
    timeSavingPatterns: [],
    riskMitigation: [],
    problemAreas: [],
    businessImpact: [],
  };
  
  // Extract sections from each summary
  summaries.forEach(summary => {
    Object.entries(sectionPatterns).forEach(([section, pattern]) => {
      const match = summary.match(pattern);
      if (match && match[1]) {
        extractedSections[section].push(match[1].trim());
      }
    });
  });
  
  // Construct the merged summary
  let mergedSummary = '';
  
  // Key Takeaways - take the most important ones
  mergedSummary += '## Key Takeaways\n\n';
  mergedSummary += extractedSections.keyTakeaways.flatMap(section => 
    section.split('\n').filter(line => line.trim().startsWith('-'))
  ).slice(0, 5).join('\n');
  
  // Core Concepts - deduplicate and merge
  mergedSummary += '\n\n## Core Concepts\n\n';
  const conceptLines = new Set<string>();
  extractedSections.coreConcepts.forEach(section => {
    section.split('\n').forEach(line => {
      if (line.trim().startsWith('-')) {
        conceptLines.add(line.trim());
      }
    });
  });
  mergedSummary += Array.from(conceptLines).join('\n');
  
  // Implementation Path - numbered steps
  mergedSummary += '\n\n## Implementation Path\n\n';
  const implementationSteps = new Set<string>();
  extractedSections.implementationPath.forEach(section => {
    section.split('\n').forEach(line => {
      // Extract just the step content without numbers
      const stepMatch = line.trim().match(/^\d+\.\s*(.+)$/);
      if (stepMatch) {
        implementationSteps.add(stepMatch[1].trim());
      }
    });
  });
  Array.from(implementationSteps).forEach((step, index) => {
    mergedSummary += `${index + 1}. ${step}\n`;
  });
  
  // Time-Saving Patterns - deduplicate
  mergedSummary += '\n## Time-Saving Patterns\n\n';
  const patternLines = new Set<string>();
  extractedSections.timeSavingPatterns.forEach(section => {
    section.split('\n').forEach(line => {
      if (line.trim().startsWith('-')) {
        patternLines.add(line.trim());
      }
    });
  });
  mergedSummary += Array.from(patternLines).join('\n');
  
  // Risk Mitigation - deduplicate
  mergedSummary += '\n\n## Risk Mitigation\n\n';
  const riskLines = new Set<string>();
  extractedSections.riskMitigation.forEach(section => {
    section.split('\n').forEach(line => {
      if (line.trim().startsWith('-')) {
        riskLines.add(line.trim());
      }
    });
  });
  mergedSummary += Array.from(riskLines).join('\n');
  
  // Problem Areas - deduplicate
  mergedSummary += '\n\n## Problem Areas\n\n';
  const problemLines = new Set<string>();
  extractedSections.problemAreas.forEach(section => {
    section.split('\n').forEach(line => {
      if (line.trim().startsWith('-')) {
        problemLines.add(line.trim());
      }
    });
  });
  mergedSummary += Array.from(problemLines).join('\n');
  
  // Business Impact - deduplicate and prioritize
  mergedSummary += '\n\n## Business Impact\n\n';
  const impactLines = new Set<string>();
  extractedSections.businessImpact.forEach(section => {
    section.split('\n').forEach(line => {
      if (line.trim().startsWith('-')) {
        impactLines.add(line.trim());
      }
    });
  });
  mergedSummary += Array.from(impactLines).join('\n');
  
  return mergedSummary;
}

/**
 * Process a large text by chunking it and handling each chunk separately
 * This avoids Vercel's 10-second function timeout
 */
export async function processLargeText(
  text: string, 
  updateProgress: (progress: ChunkProgress) => void,
  onError: (error: string) => void
): Promise<{ summary: string, processedChunks: number, totalChunks: number }> {
  // Split text into smaller chunks
  const chunks = chunkTextForClient(text);
  const totalChunks = chunks.length;
  const summaries: string[] = [];
  
  // Initialize progress tracking
  updateProgress({
    total: totalChunks,
    processed: 0,
    inProgress: true
  });
  
  try {
    // Process chunks sequentially to avoid overwhelming the API
    for (let i = 0; i < totalChunks; i++) {
      updateProgress({
        total: totalChunks,
        processed: i,
        inProgress: true,
        processingChunk: i + 1
      });
      
      const result = await processSingleChunk(chunks[i]);
      summaries.push(result.summary);
      
      // Small delay to allow UI updates and prevent overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    // For a single chunk, return the summary as is
    if (summaries.length === 1) {
      return {
        summary: summaries[0],
        processedChunks: 1,
        totalChunks: 1
      };
    }
    
    // For multiple chunks, merge the summaries
    const mergedSummary = mergeSummaries(summaries);
    
    return {
      summary: mergedSummary,
      processedChunks: totalChunks,
      totalChunks
    };
  } catch (error) {
    onError(error instanceof Error ? error.message : 'An error occurred during processing');
    throw error;
  } finally {
    updateProgress({
      total: totalChunks,
      processed: totalChunks,
      inProgress: false
    });
  }
}
