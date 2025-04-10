import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

// Initialize the Anthropic client
// Note: You'll need to set ANTHROPIC_API_KEY in your Vercel environment variables
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

export async function POST(request: NextRequest) {
  try {
    const { text, type } = await request.json();
    
    if (!text) {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }
    
    // Simple prompt for now - will be improved with prompt engineering later
    const prompt = type === 'code' 
      ? `Please summarize the following code:\n\n${text}\n\nSummary:`
      : `Please summarize the following documentation:\n\n${text}\n\nSummary:`;
    
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1000,
      messages: [
        { role: 'user', content: prompt }
      ],
    });
    
    return NextResponse.json({ summary: response.content[0].text });
  } catch (error) {
    console.error('Error during summarization:', error);
    return NextResponse.json(
      { error: 'Failed to summarize text' },
      { status: 500 }
    );
  }
} 