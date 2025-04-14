# Summify: AI-Powered Documentation and Code Summarization

Summify is an advanced AI tool designed to summarize technical documentation and code, helping developers understand complex codebases faster and more efficiently. It offers both developer-focused and product manager-focused summaries.

## 🌟 [Live Demo](https://summify-seven.vercel.app/)

Try it out: [https://summify-seven.vercel.app/](https://summify-seven.vercel.app/)

## 📋 Features

- **Dual Summarization Modes**: 
  - **Developer Mode**: Technical, implementation-focused summaries for developers
  - **Product Manager Mode**: Business-focused assessments for strategic planning
- **Smart Summarization**: Quickly extract key insights from large technical documents or codebases
- **Structured Output**: Summaries include key takeaways, core concepts, implementation steps, and more
- **Context-Aware**: Intelligently identifies whether content is code or documentation and adapts accordingly
- **Large Text Support**: Handles large inputs by breaking them into manageable chunks with intelligent boundary detection
- **Modern UI**: Chat-style interface with responsive design that works across devices
- **Server-Sent Events**: Real-time progress updates during summarization

## 🏗️ Architecture

Summify is built with a modern, separated frontend and backend architecture:

### Frontend
- **Next.js**: Static site built with React and Next.js for a fast, responsive UI
- **TailwindCSS**: Utility-first CSS framework for styling
- **React Markdown**: For rendering formatted summaries
- **SSE Client**: For receiving real-time updates from the backend

### Backend
- **Node.js/Express**: Handles API requests and processing
- **Anthropic Claude API**: Powers the AI summarization capabilities
- **Claude 3.5 Haiku**: Latest model for efficient and accurate summaries
- **Fixed-Size Chunking**: Intelligent algorithm with natural boundary detection for processing large texts
- **Rate Limiting**: Built-in rate limiting to comply with Claude API limits (5 RPM)
- **Server-Sent Events**: For streaming progress updates to the client

## 🚀 Getting Started

### Prerequisites

- Node.js (v16+)
- npm or yarn
- Anthropic API key (for the backend)

### Local Development

1. **Clone the repository**

```bash
git clone https://github.com/mitt-c/summify.git
cd summify
```

2. **Set up the Backend**

```bash
cd backend
npm install

# Create a .env file with your Anthropic API key
echo "ANTHROPIC_API_KEY=your_api_key_here" >> .env
echo "PORT=3001" >> .env
echo "FRONTEND_URL=http://localhost:3000" >> .env

# Start the backend server
npm start
```

3. **Set up the Frontend**

```bash
cd ../frontend
npm install

# Create a .env.local file with the backend URL
echo "NEXT_PUBLIC_BACKEND_URL=http://localhost:3001" >> .env.local

# Start the frontend development server
npm run dev
```

4. **Access the application**

Open your browser and go to http://localhost:3000

## 📝 How It Works

1. **Input**: Paste your code or documentation into the text area and select mode (Developer or Product Manager)
2. **Processing**: 
   - Text is analyzed and chunked if necessary (fixed 64K character chunks with natural boundaries)
   - Each chunk is processed in parallel through the Claude API
   - Server sends real-time progress updates to the client
3. **Output**: Receive a structured summary based on the selected mode:

   **Developer Mode**:
   - TL;DR Overview
   - Core Components
   - Implementation Guide
   - Dependencies & Prerequisites
   - Key Design Patterns & Architecture
   - Gotchas & Edge Cases
   - Debugging & Troubleshooting
   - Performance Considerations

   **Product Manager Mode**:
   - TL;DR Business Value
   - Core Components & Business Value
   - Implementation Roadmap
   - Resource Requirements & Budget
   - Strategic Considerations
   - Risk Assessment
   - Operational Readiness
   - Business Outcomes & Success Metrics

## 🌐 Deployment

### Backend (Render)

1. Create a new Web Service on [Render](https://render.com/)
2. Connect to your GitHub repository
3. Configure the build settings:
   - Build Command: `npm install`
   - Start Command: `npm start`
4. Add environment variables:
   - `ANTHROPIC_API_KEY`
   - `FRONTEND_URL` (your Vercel frontend URL)

### Frontend (Vercel)

1. Create a new project on [Vercel](https://vercel.com/)
2. Connect to your GitHub repository
3. Configure the build settings:
   - Framework Preset: Next.js
   - Root Directory: `frontend`
4. Add environment variables:
   - `NEXT_PUBLIC_BACKEND_URL` (your Render backend URL)

## 🔧 Technical Details

- **Advanced Chunking Logic**: Texts are split into 64K character chunks, with intelligent boundary detection at paragraph, line, or sentence breaks
- **Parallel Processing**: Multiple chunks are processed simultaneously for faster results
- **Server-Sent Events**: Real-time progress updates and individual chunk results streamed to the client
- **Session Management**: In-memory session management with automatic cleanup of expired sessions
- **Rate Limiting**: Simple rate limiter ensuring compliance with API limits (5 RPM)
- **Error Handling**: Comprehensive error handling for API rate limits and service outages

## 📄 License

MIT License

---

🔗 [GitHub Repository](https://github.com/mitt-c/summify) | 🌐 [Live Demo](https://summify-seven.vercel.app/)
