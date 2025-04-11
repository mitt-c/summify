'use client';

import { useState, useEffect } from 'react';
import { ChunkProgress, processLargeText } from '@/utils/client/chunking';

interface ChunkedTextProcessorProps {
  text: string;
  onComplete: (result: { summary: string; processedChunks: number; totalChunks: number }) => void;
  onError: (error: string) => void;
  onProcessingStatusChange: (isProcessing: boolean) => void;
}

export default function ChunkedTextProcessor({
  text,
  onComplete,
  onError,
  onProcessingStatusChange
}: ChunkedTextProcessorProps) {
  const [progress, setProgress] = useState<ChunkProgress>({ 
    total: 0, 
    processed: 0, 
    inProgress: false 
  });

  useEffect(() => {
    if (!text) return;
    
    const processText = async () => {
      try {
        onProcessingStatusChange(true);
        const result = await processLargeText(
          text,
          (newProgress: ChunkProgress) => {
            setProgress(newProgress);
          },
          onError
        );
        onComplete(result);
      } catch (error) {
        // Error is already handled by processLargeText
      } finally {
        onProcessingStatusChange(false);
      }
    };
    
    processText();
  }, [text, onComplete, onError, onProcessingStatusChange]);
  
  if (!progress.inProgress) return null;
  
  return (
    <div className="mb-6 flex justify-start">
      <div className="glass-card rounded-2xl px-6 py-4 max-w-md">
        <div className="flex items-center">
          <div className="loader-dots flex space-x-2">
            <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></div>
            <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" style={{ animationDelay: '0.2s' }}></div>
            <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" style={{ animationDelay: '0.4s' }}></div>
          </div>
          <span className="ml-3 text-sm text-gray-300 font-medium">
            {progress.processingChunk 
              ? `Processing chunk ${progress.processingChunk} of ${progress.total}...`
              : 'Summarizing your content...'}
          </span>
        </div>
        <div className="mt-3">
          <div className="w-full bg-gray-700 rounded-full h-2.5">
            <div 
              className="bg-indigo-500 h-2.5 rounded-full transition-all duration-300" 
              style={{ width: `${(progress.processed / progress.total) * 100}%` }}
            ></div>
          </div>
          <p className="text-xs text-gray-400 mt-2 text-right">
            {progress.processed} of {progress.total} chunks processed
          </p>
        </div>
      </div>
    </div>
  );
}
