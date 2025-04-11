#!/bin/bash

# Summify Project Setup Script
# This script helps reorganize the project from a monolithic structure to a split frontend/backend structure.

echo "🔧 Setting up Summify project with frontend and backend separation..."

# Create necessary directories
echo "📁 Creating project structure..."
mkdir -p frontend/src
mkdir -p frontend/public
mkdir -p backend/src

# Move frontend files
echo "🔄 Moving frontend files..."
# Move Next.js source files
if [ -d "src" ]; then
  cp -r src/* frontend/src/
  echo "✅ Moved source files to frontend/src/"
fi

# Move public assets
if [ -d "public" ]; then
  cp -r public/* frontend/public/
  echo "✅ Moved public assets to frontend/public/"
fi

# Copy necessary config files for frontend
if [ -f "package.json" ]; then
  cp package.json frontend/
  echo "✅ Copied package.json to frontend/"
fi

if [ -f "tsconfig.json" ]; then
  cp tsconfig.json frontend/
  echo "✅ Copied tsconfig.json to frontend/"
fi

if [ -f "next.config.js" ]; then
  cp next.config.js frontend/
  echo "✅ Copied next.config.js to frontend/"
fi

# Create frontend environment file
cat > frontend/.env.local << EOL
# Backend API URL (replace with your Render URL in production)
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
EOL
echo "✅ Created frontend/.env.local"

# Set up backend
echo "🔧 Setting up backend..."

# Create backend package.json
cat > backend/package.json << EOL
{
  "name": "summify-backend",
  "version": "1.0.0",
  "description": "Backend API for Summify - AI-powered documentation and code summarization",
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js",
    "dev": "nodemon src/server.js"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.17.1",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "express": "^4.18.2"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
EOL
echo "✅ Created backend/package.json"

# Create backend environment file
cat > backend/.env << EOL
# Anthropic API key
ANTHROPIC_API_KEY=your_api_key_here

# Server settings
PORT=3001

# CORS settings (update with your Vercel frontend URL)
FRONTEND_URL=http://localhost:3000
EOL
echo "✅ Created backend/.env"

# Create updated next.config.js for frontend
cat > frontend/next.config.js << EOL
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow the frontend to connect to the backend
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 
          process.env.NODE_ENV === 'development'
            ? 'http://localhost:3001/api/:path*'
            : \`\${process.env.NEXT_PUBLIC_BACKEND_URL}/api/:path*\`,
      },
    ];
  },
}

module.exports = nextConfig
EOL
echo "✅ Created updated next.config.js for frontend"

echo ""
echo "🎉 Setup complete! Next steps:"
echo "1. Update frontend/src/utils/client/chunking.ts to use the backend API"
echo "2. Update frontend/src/app/page.tsx to use the backend API"
echo "3. Install dependencies in both frontend and backend directories:"
echo "   cd backend && npm install"
echo "   cd frontend && npm install"
echo "4. Start the backend: cd backend && npm run dev"
echo "5. Start the frontend: cd frontend && npm run dev"
echo ""
echo "Remember to update the environment variables with your actual values!"
