/**
 * Environment variable utilities to ensure consistent access throughout the app
 */

// Get the Anthropic API key from environment
export const getAnthropicApiKey = (): string => {
  const key = process.env.ANTHROPIC_API_KEY || '';
  if (!key) {
    // Log warning in development, but don't expose sensitive info in production
    if (process.env.NODE_ENV === 'development') {
      console.warn('ANTHROPIC_API_KEY is not configured in environment variables');
    }
  }
  return key;
};

// Verify if API key is configured
export const isApiConfigured = (): boolean => {
  return !!getAnthropicApiKey();
}; 