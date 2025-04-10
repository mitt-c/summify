'use client';

import { useState, useRef, useEffect } from 'react';

interface Message {
  id: string;
  type: 'user' | 'assistant';
  content: string;
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
  const [modelInfoMap, setModelInfoMap] = useState<Record<string, string>>({});
  
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
    
    // Reset textarea height after sending
    resetTextarea();
    
    try {
      const response = await fetch('/api/summarize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: userMessage.content }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        if (response.status === 429 && data.retryAfter) {
          throw new Error(`Rate limit exceeded. Please try again in ${data.retryAfter} seconds.`);
        }
        if (response.status === 503 && data.isOverloaded) {
          throw new Error(`${data.error} This is a temporary issue with the AI service.`);
        }
        throw new Error(data.error || 'Failed to summarize');
      }
      
      // Add assistant response
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: data.summary
      };
      
      setMessages(prev => [...prev, assistantMessage]);
      
      // Build model info string
      let infoText = `Model: ${data.model || 'Unknown'}`;
      if (data.chunkCount) {
        infoText += ` | Text was split into ${data.chunkCount} chunks (processed ${data.processedChunks} chunks)`;
      }
      
      // Add rate limit info if available
      if (data.rateLimitInfo?.requestsRemaining) {
        infoText += ` | API requests remaining: ${data.rateLimitInfo.requestsRemaining}`;
      }
      
      setModelInfoMap(prev => ({ ...prev, [assistantMessage.id]: infoText }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
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
                  <div className="whitespace-pre-wrap overflow-auto max-h-[70vh]">{message.content}</div>
                  
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
                <div className="glass-card rounded-2xl px-6 py-4">
                  <div className="flex items-center">
                    <div className="loader-dots flex space-x-2">
                      <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></div>
                      <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                      <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                    </div>
                    <span className="ml-3 text-sm text-gray-400">Summarizing...</span>
                  </div>
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
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-full p-4 pr-14 chat-input text-gray-200 focus:outline-none resize-none overflow-hidden"
                  placeholder="Enter code, documentation, or any technical content to summarize..."
                  rows={1}
                  maxLength={100000}
                />
                <button
                  type="submit"
                  disabled={loading || !text.trim()}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-gray-300 hover:text-white focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-colors rounded-full hover:bg-[#2d3752]"
                  aria-label="Send message"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                    <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
                  </svg>
                </button>
              </div>
              {text.length > 75000 && (
                <div className="text-amber-400 text-xs mt-1 px-2">
                  Large text detected ({text.length.toLocaleString()} characters). Consider breaking into smaller parts for better results.
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
