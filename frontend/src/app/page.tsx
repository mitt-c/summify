'use client';

import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';

interface Message {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  contentType?: 'code' | 'documentation';
}

export default function Home() {
  const [text, setText] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      type: 'assistant',
      content: 'Welcome to Summify! 👋\n\nPaste any code, documentation, or technical content, and I\'ll provide you with a concise summary. You can send large files or snippets, and I\'ll handle the processing automatically.'
    }
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [textTruncated, setTextTruncated] = useState(false);
  const [modelInfoMap, setModelInfoMap] = useState<Record<string, string>>({});
  const [processingProgress, setProcessingProgress] = useState<{
    status: string;
    progress: number;
    currentChunk: number;
    totalChunks: number;
  } | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea as user types
  useEffect(() => {
    const textarea = inputRef.current;
    if (textarea) {
      // Reset height to auto to get correct scrollHeight
      textarea.style.height = 'auto';
      // Set new height based on content (min 24px, max 200px)
      const newHeight = Math.min(Math.max(textarea.scrollHeight, 24), 200);
      textarea.style.height = `${newHeight}px`;
      
      // Add scrollbar if content exceeds max height
      textarea.style.overflowY = newHeight >= 200 ? 'auto' : 'hidden';
    }
  }, [text]);

  // Reset textarea after submission
  const resetTextarea = () => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = '56px';
      inputRef.current.style.overflowY = 'hidden';
      // Keep focus on the textarea
      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
    if (!text.trim()) {
      return;
    }
    
    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: text.trim()
    };
    
    setMessages(prev => [...prev, userMessage]);
    setText('');
    setLoading(true);
    setError('');
    setTextTruncated(false);
    setProcessingProgress(null);
    
    // Reset textarea height after sending
    resetTextarea();
    
    // Get the backend URL from environment variable
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';
    
    // Create placeholder for assistant response
    const placeholderId = `placeholder-${Date.now()}`;
    const placeholderMessage: Message = {
      id: placeholderId,
      type: 'assistant',
      content: 'Processing your content...',
    };
    
    setMessages(prev => [...prev, placeholderMessage]);

    try {
      // Use Server-Sent Events for streaming
      console.log(`Attempting to connect to ${backendUrl}/api/summarize with ${userMessage.content.length} characters of text`);
      
      // First, make a POST request to initiate the session
      console.log('Making initial POST request to create session ID');
      const sessionResponse = await fetch(`${backendUrl}/api/create-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: userMessage.content }),
      });
      
      if (!sessionResponse.ok) {
        throw new Error(`Failed to create session: ${sessionResponse.status} ${sessionResponse.statusText}`);
      }
      
      const sessionData = await sessionResponse.json();
      console.log('Session created with ID:', sessionData.sessionId);
      
      // Then connect to SSE endpoint with just the session ID
      const eventSource = new EventSource(`${backendUrl}/api/summarize-stream?sessionId=${sessionData.sessionId}`);
      let finalData: any = {};
      let summary = '';
      
      console.log('EventSource instance created with session ID, adding event listeners...');
      
      // Set a timeout to detect initial connection issues
      const connectionTimeout = setTimeout(() => {
        if (!summary && !error) {
          console.error('Connection timeout reached after 10 seconds with no events received');
          setError("Unable to establish connection to the server. Please try again.");
          eventSource.close();
        }
      }, 10000); // 10 seconds timeout
      
      // Connection open event
      eventSource.onopen = () => {
        console.log('EventSource connection opened successfully');
      };
      
      // Handle different event types
      eventSource.addEventListener('processing', (event: MessageEvent) => {
        const data = JSON.parse(event.data);
        console.log('Processing event received:', data);
        // Clear the connection timeout since we received an event
        clearTimeout(connectionTimeout);
      });
      
      // Handle heartbeat to keep connection alive
      eventSource.addEventListener('heartbeat', (event: MessageEvent) => {
        console.log('Heartbeat received at', new Date().toISOString());
      });
      
      // Handle info messages
      eventSource.addEventListener('info', (event: MessageEvent) => {
        const data = JSON.parse(event.data);
        console.log('Info:', data);
        
        // Update placeholder message with info
        setMessages(prev => 
          prev.map(msg => 
            msg.id === placeholderId 
              ? { ...msg, content: `${msg.content}\n\n${data.message}` }
              : msg
          )
        );
      });
      
      // Handle warning messages
      eventSource.addEventListener('warning', (event: MessageEvent) => {
        const data = JSON.parse(event.data);
        console.warn('Warning:', data);
        
        // We don't set error state for warnings, just log them
        // Optionally update the placeholder to show warnings
        setMessages(prev => 
          prev.map(msg => 
            msg.id === placeholderId 
              ? { ...msg, content: `${msg.content}\n\n⚠️ Warning: ${data.message}` }
              : msg
          )
        );
      });
      
      eventSource.addEventListener('progress', (event: MessageEvent) => {
        const data = JSON.parse(event.data);
        // Clear the connection timeout since we received an event
        clearTimeout(connectionTimeout);
        
        setProcessingProgress({
          status: 'processing',
          progress: data.progress,
          currentChunk: data.chunkIndex + 1,
          totalChunks: data.totalChunks
        });
        
        // Update placeholder message to show progress
        setMessages(prev => 
          prev.map(msg => 
            msg.id === placeholderId 
              ? { ...msg, content: `Processing... ${data.progress}% complete` }
              : msg
          )
        );
      });
      
      eventSource.addEventListener('result', (event: MessageEvent) => {
        const data = JSON.parse(event.data);
        // Clear the connection timeout since we received the final result
        clearTimeout(connectionTimeout);
        
        finalData = data;
        summary = data.summary;
        
        // Create final assistant message with the summary
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          type: 'assistant',
          content: summary,
          contentType: finalData.contentType
        };
        
        // Replace placeholder with actual response
        setMessages(prev => prev.map(msg => 
          msg.id === placeholderId ? assistantMessage : msg
        ));
        
        // Build model info string
        let infoText = `Model: ${finalData.model || 'Unknown'}`;
        
        // Add content type if available
        if (finalData.contentType) {
          infoText += ` | Content type: ${finalData.contentType}`;
        }
        
        if (finalData.chunkCount) {
          infoText += ` | Text was split into ${finalData.chunkCount} chunks`;
          if (finalData.processedChunks && finalData.processedChunks < finalData.chunkCount) {
            infoText += ` (processed ${finalData.processedChunks} chunks)`;
          }
        }
        
        // Add processing time if available
        if (finalData.processingTime) {
          infoText += ` | Processing time: ${finalData.processingTime}`;
        }
        
        setModelInfoMap(prev => ({ ...prev, [assistantMessage.id]: infoText }));
        setProcessingProgress(null);
        
        // Close the connection once we have the result
        eventSource.close();
      });
      
      eventSource.addEventListener('error', (event: MessageEvent) => {
        // Clear the connection timeout since we received an event (even if it's an error)
        clearTimeout(connectionTimeout);
        
        console.error('SSE Error:', event);
        
        // Try to parse error data if available
        let errorMessage = 'An error occurred during processing';
        try {
          if (event.data) {
            const errorData = JSON.parse(event.data);
            errorMessage = errorData.error || errorMessage;
            
            // Add more context for timeout errors
            if (errorData.isTimeout) {
              errorMessage += ' Try splitting your document into smaller sections.';
            }
          }
        } catch (e) {
          // Use default error message if parsing fails
        }
        
        setError(errorMessage);
        setMessages(prev => prev.filter(msg => msg.id !== placeholderId));
        eventSource.close();
      });
      
      // Handle connection errors
      eventSource.onerror = (err) => {
        // Clear the connection timeout since we received an event (even if it's an error)
        clearTimeout(connectionTimeout);
        
        console.error('EventSource connection error:', err);
        console.error('EventSource readyState:', eventSource.readyState);
        // 0 = CONNECTING, 1 = OPEN, 2 = CLOSED
        
        let errorMsg = 'Connection to the server failed.';
        if (eventSource.readyState === 2) {
          errorMsg += ' The connection was closed unexpectedly.';
        } else if (eventSource.readyState === 0) {
          errorMsg += ' Unable to establish connection to the server.';
        }
        
        errorMsg += ' This may happen with very large documents. Try breaking your content into smaller chunks.';
        
        setError(errorMsg);
        setMessages(prev => prev.filter(msg => msg.id !== placeholderId));
        eventSource.close();
      };
    } catch (err) {
      console.error('Exception in EventSource setup:', err);
      setError(err instanceof Error ? err.message : 'An error occurred');
      // Remove placeholder message on error
      setMessages(prev => prev.filter(msg => !msg.id.startsWith('placeholder-')));
    } finally {
      setLoading(false);
    }
  };

  // Handle Enter key press to submit
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex flex-col flex-1 w-full mx-auto">
        <header className="text-center py-6 border-b border-gray-800">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-400 to-purple-500 bg-clip-text text-transparent">
            Summify
          </h1>
          <p className="text-gray-400 mt-1 text-sm">
            AI-powered documentation and code summarization
          </p>
        </header>

        <main className="flex-1 flex flex-col max-w-5xl mx-auto w-full">
          {/* Conversation area */}
          <div className="flex-1 overflow-y-auto px-4 pt-4 pb-32">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-gray-500 py-12">
                <div className="glass-card p-8 max-w-md text-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <h2 className="text-xl font-semibold mb-2 text-gray-300">Welcome to Summify</h2>
                  <p>Paste any code, documentation, or technical content below to get an AI-powered summary.</p>
                </div>
              </div>
            )}

            {messages.map((message) => (
              <div 
                key={message.id}
                className={`mb-6 flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div 
                  className={`max-w-[85%] px-4 py-3 ${
                    message.type === 'user'
                      ? 'user-message'
                      : 'assistant-message'
                  }`}
                >
                  {message.type === 'user' ? (
                    <div className="whitespace-pre-wrap overflow-auto max-h-[70vh]">{message.content}</div>
                  ) : (
                    <div className="markdown-content overflow-auto max-h-[70vh]">
                      <ReactMarkdown>{message.content}</ReactMarkdown>
                    </div>
                  )}
                  
                  {message.type === 'assistant' && modelInfoMap[message.id] && (
                    <div className="mt-2 pt-2 border-t border-gray-700 text-xs text-gray-400">
                      {modelInfoMap[message.id]}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="mb-6 flex justify-start">
                <div className="glass-card rounded-2xl px-6 py-4 max-w-md">
                  <div className="flex items-center">
                    <div className="loader-dots flex space-x-2">
                      <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></div>
                      <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                      <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                    </div>
                    <span className="ml-3 text-sm text-gray-300 font-medium">Summarizing your content...</span>
                  </div>
                  
                  {processingProgress && (
                    <div className="mt-3">
                      <div className="w-full bg-gray-700 rounded-full h-1.5">
                        <div 
                          className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300 ease-in-out" 
                          style={{ width: `${processingProgress.progress}%` }}
                        ></div>
                      </div>
                      <p className="text-xs text-gray-400 mt-2">
                        Processing chunk {processingProgress.currentChunk} of {processingProgress.totalChunks} 
                        ({processingProgress.progress}% complete)
                      </p>
                    </div>
                  )}
                  
                  {!processingProgress && (
                    <p className="text-xs text-gray-400 mt-2">
                      {text.length > 100000 
                        ? "This may take a minute for larger content..."
                        : "Generating a concise, structured summary..."}
                    </p>
                  )}
                </div>
              </div>
            )}

            {error && (
              <div className="mb-6 flex justify-center">
                <div className="p-4 bg-red-900/30 border border-red-700 text-red-200 rounded-lg max-w-md">
                  {error}
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>

          {/* Floating input bar */}
          <div className="fixed bottom-0 left-0 right-0 bg-gradient-to-t from-[#0f1729] via-[#0f1729] to-transparent py-6 px-4">
            <form 
              onSubmit={handleSubmit} 
              className="max-w-5xl mx-auto w-[80%] relative shadow-lg"
            >
              <div className="relative">
                <textarea
                  ref={inputRef}
                  value={text}
                  onChange={(e) => {
                    const newText = e.target.value;
                    // Apply hard limit of 100,000 characters
                    if (newText.length > 100000) {
                      setText(newText.substring(0, 100000));
                      setTextTruncated(true);
                    } else {
                      setText(newText);
                      setTextTruncated(false);
                    }
                  }}
                  onKeyDown={handleKeyDown}
                  className="w-full p-4 pr-14 chat-input text-gray-200 focus:outline-none resize-none overflow-hidden"
                  placeholder="Enter code, documentation, or any technical content to summarize..."
                  rows={1}
                  maxLength={100000}
                  disabled={loading}
                />
                <button
                  type="submit"
                  disabled={loading || !text.trim()}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-gray-300 hover:text-white focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-colors rounded-full hover:bg-[#2d3752]"
                  aria-label="Send message"
                >
                  {loading ? (
                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                      <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
                    </svg>
                  )}
                </button>
              </div>
              {text.length > 75000 && !textTruncated && (
                <div className="text-amber-400 text-xs mt-1 px-2">
                  Large text detected ({text.length.toLocaleString()} characters). Consider breaking into smaller parts for better results.
                </div>
              )}
              {textTruncated && (
                <div className="text-red-400 text-xs mt-1 px-2 font-medium">
                  Text has been truncated to 100,000 characters. The remaining text was removed.
                </div>
              )}
            </form>
            <div className="text-center mt-4 text-gray-500 text-xs">
              &copy; {new Date().getFullYear()} Summify - AI-powered summarization tool
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
