'use client';

import { useState } from 'react';
import { SummaryType } from '@/types';

export default function Home() {
  const [text, setText] = useState('');
  const [type, setType] = useState<SummaryType>('documentation');
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!text.trim()) {
      setError('Please enter some text to summarize');
      return;
    }
    
    setLoading(true);
    setError('');
    setSummary('');
    
    try {
      const response = await fetch('/api/summarize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text, type }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to summarize');
      }
      
      setSummary(data.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col p-6 max-w-5xl mx-auto">
      <header className="mb-8 text-center">
        <h1 className="text-4xl font-bold mb-2">Summify</h1>
        <p className="text-lg text-gray-600">
          AI-powered documentation and code summarization
        </p>
      </header>

      <main className="flex-1">
        <form onSubmit={handleSubmit} className="mb-8">
          <div className="mb-4">
            <label className="block mb-2 font-medium">
              Select content type:
            </label>
            <div className="flex gap-4">
              <button
                type="button"
                className={`px-4 py-2 rounded ${
                  type === 'documentation'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200'
                }`}
                onClick={() => setType('documentation')}
              >
                Documentation
              </button>
              <button
                type="button"
                className={`px-4 py-2 rounded ${
                  type === 'code' ? 'bg-blue-600 text-white' : 'bg-gray-200'
                }`}
                onClick={() => setType('code')}
              >
                Code
              </button>
            </div>
          </div>

          <div className="mb-4">
            <label htmlFor="text" className="block mb-2 font-medium">
              Paste your {type} here:
            </label>
            <textarea
              id="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full h-64 p-3 border rounded"
              placeholder={`Enter ${type} to summarize...`}
            ></textarea>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-blue-600 text-white rounded font-medium hover:bg-blue-700 disabled:bg-blue-400"
          >
            {loading ? 'Summarizing...' : 'Summarize'}
          </button>
        </form>

        {error && (
          <div className="p-4 mb-6 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}

        {summary && (
          <div className="border rounded p-6 bg-gray-50">
            <h2 className="text-xl font-semibold mb-4">Summary</h2>
            <div className="whitespace-pre-wrap">{summary}</div>
          </div>
        )}
      </main>

      <footer className="mt-8 py-4 text-center text-gray-500 text-sm">
        &copy; {new Date().getFullYear()} Summify - AI-powered summarization tool
      </footer>
    </div>
  );
}
