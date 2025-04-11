# Summify: AI-Powered Documentation and Code Summarization


Summify is an advanced AI tool designed to summarize technical documentation and code, helping developers understand complex codebases faster and more efficiently.

## 🌟 [Live Demo](https://summify-seven.vercel.app/)

Try it out: [https://summify-seven.vercel.app/](https://summify-seven.vercel.app/)

## 📋 Features

- **Smart Summarization**: Quickly extract key insights from large technical documents or codebases
- **Structured Output**: Summaries include key takeaways, core concepts, implementation steps, and more
- **Context-Aware**: Intelligently identifies whether content is code or documentation and adapts accordingly
- **Large Text Support**: Handles large inputs by breaking them into manageable chunks and synthesizing the results
- **Modern UI**: Chat-style interface with responsive design that works across devices

## 🏗️ Architecture

Summify is built with a modern, separated frontend and backend architecture:

### Frontend
- **Next.js**: Static site built with React and Next.js for a fast, responsive UI
- **TailwindCSS**: Utility-first CSS framework for styling
- **React Markdown**: For rendering formatted summaries

### Backend
- **Node.js/Express**: Handles API requests and processing
- **Anthropic Claude API**: Powers the AI summarization capabilities
- **Smart Chunking**: Proprietary algorithm for processing large texts efficiently

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
npm run dev
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

1. **Input**: Paste your code or documentation into the text area
2. **Processing**: 
   - For small content (<10,000 characters): Direct summarization
   - For large content: Intelligent chunking and meta-summarization
3. **Output**: Receive a structured summary with:
   - Key Takeaways
   - Core Concepts
   - Implementation Path
   - Time-Saving Patterns
   - Risk Mitigation
   - Problem Areas
   - Business Impact

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

- **Smart Chunking**: The backend intelligently breaks large texts at meaningful boundaries (paragraphs, code blocks, headers) to preserve context
- **Meta-Summarization**: For multi-chunk processing, each chunk is summarized individually, then a meta-summary combines the insights
- **Exponential Backoff**: Built-in retry mechanism for API calls with intelligent backoff strategy
- **Error Handling**: Comprehensive error handling for API rate limits and service outages

## 📄 License

MIT License

---

🔗 [GitHub Repository](https://github.com/mitt-c/summify) | 🌐 [Live Demo](https://summify-seven.vercel.app/)
