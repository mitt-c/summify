import { NextRequest, NextResponse } from 'next/server';

/**
 * API route that forwards summarization requests to the backend server
 * This is primarily useful for local development to avoid CORS issues
 */
export async function POST(request: NextRequest) {
  try {
    // Get the backend URL from environment variable
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';
    
    // Parse the request body
    const data = await request.json();
    
    if (!data.text) {
      return NextResponse.json({ error: 'No text provided for summarization' }, { status: 400 });
    }
    
    // Forward the request to the backend
    const response = await fetch(`${backendUrl}/api/summarize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    
    // Forward the response back to the client
    const responseData = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(responseData, { status: response.status });
    }
    
    return NextResponse.json(responseData);
  } catch (error: any) {
    console.error('Error forwarding request to backend:', error);
    
    return NextResponse.json({ 
      error: `Error forwarding request: ${error.message}` 
    }, { status: 500 });
  }
}