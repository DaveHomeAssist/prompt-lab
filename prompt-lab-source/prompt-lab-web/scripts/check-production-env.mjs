const isProduction = process.env.NODE_ENV === 'production';
const clerkKey = process.env.VITE_CLERK_PUBLISHABLE_KEY;

if (isProduction && !clerkKey) {
  throw new Error('VITE_CLERK_PUBLISHABLE_KEY is required for production web releases.');
}

console.log('[PromptLab] Web production auth environment check passed.');
