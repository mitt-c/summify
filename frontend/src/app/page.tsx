'use client';

import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';

interface Message {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  contentType?: 'code' | 'documentation';
  chunkIndex?: number;
  totalChunks?: number;
  mode?: 'dev' | 'pm';
  timestamp?: number;
}

// Storage key for localStorage
const STORAGE_KEY = 'summify_conversation_history';

// Maximum number of conversations to store
const MAX_STORED_CONVERSATIONS = 10;

export default function Home() {
  const [text, setText] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      type: 'assistant',
      content:
        "Welcome to Summify! 👋\n\nPaste any code, documentation, or technical content, and I'll provide you with a concise summary. You can send large files or snippets, and I'll handle the processing automatically.",
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [textTruncated, setTextTruncated] = useState(false);

  // Tracks SSE chunk progress & messages
  const [processingProgress, setProcessingProgress] = useState<{
    status: string;
    progress: number;
    currentChunk: number;
    totalChunks: number;
    message?: string;
    stage?: 'splitting' | 'processing' | 'finalizing' | 'initial';
    overallProgress?: number; // 0-100 overall progress
  } | null>(null);

  const [chunkSummaries, setChunkSummaries] = useState<Map<number, string>>(new Map());
  const [viewMode, setViewMode] = useState<'dev' | 'pm'>('dev');
  const [hasLoadedHistory, setHasLoadedHistory] = useState(false);
  const [conversationId, setConversationId] = useState<string>('');
  const [showConversationMenu, setShowConversationMenu] = useState(false);
  const [storedConversations, setStoredConversations] = useState<any[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 1) Create initial conversation ID on mount
  useEffect(() => {
    setConversationId(`conv-${Date.now()}`);
  }, []);

  // 2) Load conversation from localStorage (if any)
  useEffect(() => {
    if (!hasLoadedHistory) {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const urlConvId = urlParams.get('conversation');

        const savedConversationsString = localStorage.getItem(STORAGE_KEY);
        const savedConversations = savedConversationsString
          ? JSON.parse(savedConversationsString)
          : [];

        if (urlConvId) {
          // If URL param has a conversation
          setConversationId(urlConvId);
          const targetConversation = savedConversations.find(
            (conv: { id: string; messages: Message[] }) => conv.id === urlConvId
          );
          if (targetConversation) {
            setMessages(targetConversation.messages);
            console.log(
              `Loaded conversation: ${urlConvId} with ${targetConversation.messages.length} messages`
            );
          }
        } else {
          // No conversation in URL -> create new one
          const newConvId = `conv-${Date.now()}`;
          setConversationId(newConvId);

          const newUrl = `${window.location.pathname}?conversation=${newConvId}`;
          window.history.pushState({ path: newUrl }, '', newUrl);
        }
        setHasLoadedHistory(true);
      } catch (error) {
        console.error('Failed to load conversation history:', error);
        setHasLoadedHistory(true);
      }
    }
  }, [hasLoadedHistory]);

  // 3) Save conversation to localStorage whenever messages change
  useEffect(() => {
    if (hasLoadedHistory && messages.length > 1) {
      try {
        const savedConversationsString = localStorage.getItem(STORAGE_KEY);
        let savedConversations = savedConversationsString
          ? JSON.parse(savedConversationsString)
          : [];

        // find existing or create new
        const existingConvIndex = savedConversations.findIndex(
          (conv: { id: string }) => conv.id === conversationId
        );

        if (existingConvIndex >= 0) {
          savedConversations[existingConvIndex].messages = messages;
          savedConversations[existingConvIndex].lastUpdated = Date.now();
        } else {
          savedConversations.push({
            id: conversationId,
            messages,
            lastUpdated: Date.now(),
          });
        }

        // sort by last updated
        savedConversations.sort((a: any, b: any) => b.lastUpdated - a.lastUpdated);
        // keep only 10
        savedConversations = savedConversations.slice(0, MAX_STORED_CONVERSATIONS);

        localStorage.setItem(STORAGE_KEY, JSON.stringify(savedConversations));
        setStoredConversations(savedConversations);
      } catch (error) {
        console.error('Failed to save conversation history:', error);
      }
    }
  }, [messages, conversationId, hasLoadedHistory]);

  // 4) Scroll to bottom on messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 5) Auto-resize textarea
  useEffect(() => {
    const textarea = inputRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      const newHeight = Math.min(Math.max(textarea.scrollHeight, 24), 200);
      textarea.style.height = `${newHeight}px`;
      textarea.style.overflowY = newHeight >= 200 ? 'auto' : 'hidden';
    }
  }, [text]);

  // Helpers
  const startNewConversation = () => {
    const newConvId = `conv-${Date.now()}`;
    setConversationId(newConvId);

    const newUrl = `${window.location.pathname}?conversation=${newConvId}`;
    window.history.pushState({ path: newUrl }, '', newUrl);

    setMessages([
      {
        id: 'welcome',
        type: 'assistant',
        content:
          "Welcome to Summify! 👋\n\nPaste any code, documentation, or technical content, and I'll provide you with a concise summary. You can send large files or snippets, and I'll handle the processing automatically.",
      },
    ]);
  };

  const resetTextarea = () => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = '56px';
      inputRef.current.style.overflowY = 'hidden';
      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    }
  };

  // 6) Sending a message
  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!text.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: text.trim(),
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setText('');
    setLoading(true);
    setError('');
    setTextTruncated(false);

    // Immediately set processing state to show the UI indicator
    setProcessingProgress({
      status: 'processing',
      progress: 5,
      currentChunk: 0,
      totalChunks: 1,
      stage: 'initial',
      overallProgress: 5,
      message: 'Initializing...',
    });

    // Create placeholder for assistant response
    const placeholderId = `placeholder-${Date.now()}`;
    const placeholderMessage: Message = {
      id: placeholderId,
      type: 'assistant',
      content: 'Processing your content...',
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, placeholderMessage]);

    resetTextarea();

    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

    try {
      // 1) POST create session
      console.log(
        `Creating session at ${backendUrl}/api/create-session with ${userMessage.content.length} chars, mode: ${viewMode}`
      );
      const sessionResponse = await fetch(`${backendUrl}/api/create-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: userMessage.content,
          mode: viewMode,
        }),
      });

      if (!sessionResponse.ok) {
        throw new Error(
          `Failed to create session: ${sessionResponse.status} ${sessionResponse.statusText}`
        );
      }

      const sessionData = await sessionResponse.json();
      console.log('Session created with ID:', sessionData.sessionId, 'mode:', sessionData.mode);

      // 2) SSE streaming
      const eventSource = new EventSource(
        `${backendUrl}/api/summarize-stream?sessionId=${sessionData.sessionId}`
      );
      let finalSummary = '';
      let hasReceivedAnyEvent = false;

      // if no event after 10s, assume connection failure
      const connectionTimeout = setTimeout(() => {
        if (!finalSummary && !error) {
          console.error('Connection timeout: no SSE events within 10s');
          setError('Unable to connect to the server. Please try again.');
          eventSource.close();
        }
      }, 10000);

      eventSource.onopen = () => {
        console.log('SSE connection opened');
      };

      // -------------- EVENT LISTENERS -------------- //

      // "processing" event
      eventSource.addEventListener('processing', (ev: MessageEvent) => {
        hasReceivedAnyEvent = true;
        clearTimeout(connectionTimeout);
        console.log('processing event:', ev.data);

        // If we want, show an initial 5% or so
        setProcessingProgress(() => ({
          status: 'processing',
          progress: 5,
          currentChunk: 0,
          totalChunks: 1,
          stage: 'initial',
          overallProgress: 5,
          message: "We've started summarizing...",
        }));
      });

      // "heartbeat" event
      eventSource.addEventListener('heartbeat', (ev: MessageEvent) => {
        console.log('heartbeat:', ev.data, new Date().toISOString());
      });

      // "info" event
      eventSource.addEventListener('info', (ev: MessageEvent) => {
        hasReceivedAnyEvent = true;
        clearTimeout(connectionTimeout);
        const data = JSON.parse(ev.data);
        console.log('info:', data);

        if (data.message?.includes('Document split into')) {
          setProcessingProgress(() => ({
            status: 'processing',
            progress: 10,
            currentChunk: 0,
            totalChunks: data.chunkCount || 1,
            stage: 'splitting',
            overallProgress: 10,
            message: data.message,
          }));
        } else if (data.message?.includes('Creating final summary')) {
          setProcessingProgress(() => ({
            status: 'processing',
            progress: 80,
            currentChunk: 1,
            totalChunks: data.chunkCount || 1,
            stage: 'finalizing',
            overallProgress: 80,
            message: 'Creating final summary...',
          }));
        } else if (data.message && data.message.includes('batches')) {
          setProcessingProgress(() => ({
            status: 'processing',
            progress: 30,
            currentChunk: 0,
            totalChunks: data.chunkCount || 1,
            stage: 'processing',
            overallProgress: 30,
            message: data.message,
          }));
        } else {
          // Fallback for other messages
          setProcessingProgress(() => ({
            status: 'processing',
            progress: 5,
            currentChunk: 0,
            totalChunks: data.chunkCount || 1,
            stage: 'initial',
            overallProgress: 5,
            message: data.message || 'Summarizing...',
          }));
        }
      });

      // "warning" event
      eventSource.addEventListener('warning', (ev: MessageEvent) => {
        const data = JSON.parse(ev.data);
        console.warn('warning:', data);
        setError(`Warning: ${data.message}`);
      });

      // "progress" event
      let lastProgressUpdate = 0;
      eventSource.addEventListener('progress', (ev: MessageEvent) => {
        hasReceivedAnyEvent = true;
        clearTimeout(connectionTimeout);
        const data = JSON.parse(ev.data);
        const now = Date.now();

        if (now - lastProgressUpdate < 1000) return;
        lastProgressUpdate = now;

        let overallProgress = 10;
        if (data.progress) {
          overallProgress = 10 + (data.progress / 100) * 70; // from 10% to 80%
        }
        setProcessingProgress((prev) => ({
          ...(prev || { status: 'processing', totalChunks: data.totalChunks || 1 }),
          stage: 'processing',
          progress: data.progress || 0,
          currentChunk: data.chunkIndex + 1 || 1,
          totalChunks: data.totalChunks || 1,
          overallProgress: Math.round(overallProgress),
          message: data.message || 'Processing content...',
        }));
      });

      // "result" event (final chunk or single-chunk result)
      eventSource.addEventListener('result', (ev: MessageEvent) => {
        hasReceivedAnyEvent = true;
        clearTimeout(connectionTimeout);
        const data = JSON.parse(ev.data);
        finalSummary = data.summary || '';

        // Insert final summary into messages and remove placeholder
        const assistantMessage: Message = {
          id: `assistant-final-${Date.now()}`,
          type: 'assistant',
          content: finalSummary,
          contentType: data.contentType,
          mode: data.mode || viewMode,
          timestamp: Date.now(),
        };
        
        // Replace the placeholder message with the final summary
        setMessages((prev) => {
          // Find and remove the placeholder message
          const withoutPlaceholder = prev.filter(m => !m.id.startsWith('placeholder-'));
          // Add the final summary
          return [...withoutPlaceholder, assistantMessage];
        });

        setProcessingProgress(null);
        eventSource.close();
      });

      // "chunk" event (partial summaries)
      eventSource.addEventListener('chunk', (ev: MessageEvent) => {
        hasReceivedAnyEvent = true;
        clearTimeout(connectionTimeout);

        const data = JSON.parse(ev.data);
        console.log('chunk event:', data);

        setChunkSummaries((prev) => {
          const newMap = new Map(prev);
          newMap.set(data.chunkIndex, data.summary);
          return newMap;
        });

        const chunkMessage: Message = {
          id: `chunk-${data.chunkIndex}`,
          type: 'assistant',
          content: data.summary,
          chunkIndex: data.chunkIndex,
          totalChunks: data.totalChunks,
          mode: data.mode || viewMode,
          timestamp: Date.now(),
        };

        // Insert or update chunk message
        setMessages((prev) => {
          const existingIndex = prev.findIndex((m) => m.id === `chunk-${data.chunkIndex}`);
          if (existingIndex >= 0) {
            const newMessages = [...prev];
            newMessages[existingIndex] = chunkMessage;
            return newMessages;
          } else {
            return [...prev, chunkMessage];
          }
        });
      });

      // "complete" event
      eventSource.addEventListener('complete', (ev: MessageEvent) => {
        console.log('complete event:', ev.data);
        setLoading(false);
        setProcessingProgress(null);
      });

      // SSE "error" event
      eventSource.addEventListener('error', (ev: MessageEvent) => {
        clearTimeout(connectionTimeout);
        console.error('SSE error event:', ev);

        let errorMessage = 'An error occurred during processing';
        try {
          if (ev.data) {
            const errorData = JSON.parse(ev.data);
            errorMessage = errorData.error || errorMessage;
            if (errorData.isTimeout) {
              errorMessage += ' Try splitting your document into smaller sections.';
            }
          }
        } catch {
          /* do nothing */
        }
        setError(errorMessage);
        eventSource.close();
      });

      // Raw onerror
      eventSource.onerror = (err) => {
        console.error('EventSource.onerror triggered:', err, 'readyState:', eventSource.readyState);
        clearTimeout(connectionTimeout);

        let errorMsg = 'Connection to the server failed.';
        if (eventSource.readyState === 2) {
          errorMsg += ' The connection was closed unexpectedly.';
        } else if (eventSource.readyState === 0) {
          errorMsg += ' Unable to establish connection.';
        }
        errorMsg +=
          ' This may happen with very large documents. Try splitting your content into smaller chunks.';

        setError(errorMsg);
        eventSource.close();
      };
    } catch (err) {
      console.error('Exception in SSE setup:', err);
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  // Press Enter => submit
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // 7) Load a specific conversation from localStorage
  const loadConversation = (convId: string) => {
    try {
      const savedConversationsString = localStorage.getItem(STORAGE_KEY);
      if (savedConversationsString) {
        const savedConversations = JSON.parse(savedConversationsString);
        const targetConversation = savedConversations.find(
          (conv: { id: string; messages: Message[] }) => conv.id === convId
        );
        if (targetConversation) {
          setConversationId(convId);
          setMessages(targetConversation.messages);

          const newUrl = `${window.location.pathname}?conversation=${convId}`;
          window.history.pushState({ path: newUrl }, '', newUrl);
        }
      }
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  };

  // Helper to get stored conversation list
  const getStoredConversations = () => {
    try {
      const savedConversationsString = localStorage.getItem(STORAGE_KEY);
      if (savedConversationsString) {
        return JSON.parse(savedConversationsString);
      }
    } catch (error) {
      console.error('Failed to get stored conversations:', error);
    }
    return [];
  };

  // Load conversation list initially
  useEffect(() => {
    setStoredConversations(getStoredConversations());
  }, []);

  // 8) Render
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

          {/* Conversation history dropdown */}
          <div className="mt-4 flex justify-center">
            <div className="relative inline-block text-left">
              <button
                type="button"
                className="inline-flex justify-center rounded-md border border-gray-700 px-4 py-1.5 bg-gray-800 text-sm font-medium text-gray-300 hover:bg-gray-700 transition-colors"
                id="menu-button"
                aria-expanded="true"
                aria-haspopup="true"
                onClick={() => setShowConversationMenu(!showConversationMenu)}
              >
                Conversation History
                <svg
                  className="-mr-1 ml-2 h-5 w-5"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
              {showConversationMenu && (
                <div
                  className="absolute right-0 mt-2 w-56 rounded-md shadow-lg bg-gray-800 ring-1 ring-black ring-opacity-5 z-10"
                  role="menu"
                  aria-orientation="vertical"
                  aria-labelledby="menu-button"
                  id="conversation-menu"
                >
                  <div className="py-1" role="none">
                    <button
                      className="text-gray-300 hover:bg-gray-700 hover:text-white block px-4 py-2 text-sm w-full text-left"
                      onClick={() => {
                        setShowConversationMenu(false);
                        startNewConversation();
                      }}
                    >
                      + New Conversation
                    </button>
                    <div className="border-t border-gray-700 my-1"></div>
                    {storedConversations.length > 0 ? (
                      storedConversations.map((conv: any) => {
                        // label with first user message or fallback
                        const firstUserMsg = conv.messages.find(
                          (m: Message) => m.type === 'user'
                        );
                        const title = firstUserMsg
                          ? firstUserMsg.content.substring(0, 30) +
                            (firstUserMsg.content.length > 30 ? '...' : '')
                          : 'Conversation';

                        const date = new Date(conv.lastUpdated);
                        const formattedDate = date.toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        });

                        return (
                          <button
                            key={conv.id}
                            className={`${
                              conv.id === conversationId
                                ? 'bg-gray-700 text-white'
                                : 'text-gray-300'
                            } hover:bg-gray-700 hover:text-white block px-4 py-2 text-sm w-full text-left`}
                            onClick={() => {
                              setShowConversationMenu(false);
                              loadConversation(conv.id);
                            }}
                          >
                            <div className="font-medium truncate">{title}</div>
                            <div className="text-xs text-gray-400">{formattedDate}</div>
                          </button>
                        );
                      })
                    ) : (
                      <div className="text-gray-500 px-4 py-2 text-sm">No saved conversations</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 flex flex-col max-w-5xl mx-auto w-full">
          {/* Conversation area */}
          <div className="flex-1 overflow-y-auto px-4 pt-4 pb-32">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-gray-500 py-12">
                <div className="glass-card p-8 max-w-md text-center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-12 w-12 mx-auto mb-4 opacity-50"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <h2 className="text-xl font-semibold mb-2 text-gray-300">Welcome to Summify</h2>
                  <p>
                    Paste any code, documentation, or technical content below to get an AI-powered
                    summary.
                  </p>
                </div>
              </div>
            )}

            {messages.map((message) => (
              <div
                key={message.id}
                className={`mb-6 flex ${
                  message.type === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                <div
                  className={`max-w-[85%] px-4 py-3 ${
                    message.type === 'user' ? 'user-message' : 'assistant-message'
                  }`}
                >
                  {message.type === 'user' ? (
                    <div className="whitespace-pre-wrap overflow-auto max-h-[70vh]">
                      {message.content}
                    </div>
                  ) : (
                    <div className="markdown-content overflow-auto max-h-[70vh]">
                      <div className="flex items-center mb-2">
                        {message.chunkIndex !== undefined && (
                          <div className="text-sm text-gray-400 mr-2">
                            Chunk {message.chunkIndex} of {message.totalChunks}
                          </div>
                        )}
                        {message.mode && (
                          <div
                            className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                              message.mode === 'dev'
                                ? 'bg-blue-900/50 text-blue-300'
                                : 'bg-purple-900/50 text-purple-300'
                            }`}
                          >
                            {message.mode === 'dev' ? 'Developer' : 'Project Manager'}
                          </div>
                        )}
                      </div>
                      <ReactMarkdown>{message.content}</ReactMarkdown>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* The "AI Processing" card if loading is true */}
            {loading && (
              <div className="mb-6 flex justify-start">
                <div className="glass-card rounded-2xl px-6 py-4 max-w-md w-full">
                  {/* Summarizing or Processing label */}
                  <div className="flex items-center mb-3">
                    <div className="relative mr-3">
                      <div className="w-3 h-3 rounded-full bg-indigo-500"></div>
                      <div className="absolute inset-0 w-3 h-3 rounded-full bg-indigo-500 animate-ping opacity-75"></div>
                    </div>
                    <span className="text-sm font-medium text-indigo-400">
                      Summarizing...
                    </span>
                    {processingProgress?.overallProgress ? (
                      <span className="ml-auto text-sm font-medium text-gray-300">
                        {processingProgress.overallProgress}%
                      </span>
                    ) : null}
                  </div>

                  {/* Simplified progress indicator */}
                  {processingProgress?.overallProgress ? (
                    <div className="w-full space-y-2 my-4">
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>Processing</span>
                        <span>{processingProgress.overallProgress}%</span>
                      </div>
                      <div className="h-1 w-full bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 transition-all duration-300 ease-in-out"
                          style={{ width: `${processingProgress.overallProgress || 0}%` }}
                        />
                      </div>
                      <div className="text-xs text-gray-500 text-center animate-pulse">
                        {processingProgress?.message || 'Summarizing your content...'}
                      </div>
                    </div>
                  ) : (
                    <div className="w-full my-4 flex justify-center">
                      <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-indigo-500"></div>
                    </div>
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
            <div className="max-w-5xl mx-auto w-full mb-4">
              {/* Mode toggle */}
              <div className="flex justify-center mb-3">
                <div className="glass-card p-1 rounded-full flex items-center">
                  <button
                    onClick={() => setViewMode('dev')}
                    className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                      viewMode === 'dev'
                        ? 'bg-indigo-500 text-white'
                        : 'text-gray-300 hover:text-white'
                    }`}
                  >
                    Developer
                  </button>
                  <button
                    onClick={() => setViewMode('pm')}
                    className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                      viewMode === 'pm'
                        ? 'bg-indigo-500 text-white'
                        : 'text-gray-300 hover:text-white'
                    }`}
                  >
                    Project Manager
                  </button>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="relative shadow-lg">
                <div className="relative">
                  <textarea
                    ref={inputRef}
                    value={text}
                    onChange={(e) => {
                      const newText = e.target.value;
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
                      <svg
                        className="animate-spin h-5 w-5 text-white"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        ></circle>
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                    ) : (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className="w-6 h-6"
                      >
                        <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
                      </svg>
                    )}
                  </button>
                </div>
                {text.length > 75000 && !textTruncated && (
                  <div className="text-amber-400 text-xs mt-1 px-2">
                    Large text detected ({text.length.toLocaleString()} characters). Consider
                    breaking into smaller parts for better results.
                  </div>
                )}
                {textTruncated && (
                  <div className="text-red-400 text-xs mt-1 px-2 font-medium">
                    Text has been truncated to 100,000 characters. The remaining text was removed.
                  </div>
                )}
              </form>
            </div>
            <div className="text-center mt-4 text-gray-500 text-xs">
              &copy; {new Date().getFullYear()} Summify - AI-powered summarization tool
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}