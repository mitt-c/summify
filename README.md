# Summify

Summify is an AI-powered documentation and code summarization tool that leverages Claude AI (Anthropic) to automatically extract and summarize key information from extensive documentation and implementations.

## Features

- Web-based interface for easy text/code summarization
- Automatic content type detection (code vs documentation)
- Support for large documents through chunking
- Optimized API usage to avoid Vercel's timeout limitations

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- An Anthropic API key (get one from [Anthropic Console](https://console.anthropic.com/))

### Setup

1. Clone the repository
2. Install dependencies:

```bash
npm install
```

3. Copy the example environment file and add your Anthropic API key:

```bash
cp .env.example .env.local
```

Edit `.env.local` and add your Anthropic API key.

4. Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the application.

## Deployment on Vercel

This application is designed to be deployed on Vercel:

1. Push your code to a GitHub repository
2. Go to [Vercel](https://vercel.com) and create a new project from your repository
3. Add the required environment variable:
   - `ANTHROPIC_API_KEY`: Your Anthropic API key

## How It Works

Summify processes text in these steps:

1. The user pastes documentation or code into the text area
2. The application automatically detects if the content is code or documentation
3. For large texts, the application splits the content into manageable chunks
4. Each chunk is sent to Claude AI for summarization
5. If multiple chunks were processed, a meta-summary is created to synthesize all chunks
6. The final summary is presented to the user

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
