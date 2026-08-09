const vercelEnvironment = String(process.env.VERCEL_ENV || '').trim().toLowerCase();
const isReleaseBuild = (
  process.env.NODE_ENV === 'production'
  || vercelEnvironment === 'preview'
  || vercelEnvironment === 'production'
);
const clerkKey = String(process.env.VITE_CLERK_PUBLISHABLE_KEY || '').trim();

if (isReleaseBuild && !clerkKey) {
  throw new Error('VITE_CLERK_PUBLISHABLE_KEY is required for Vercel preview and production web releases.');
}

console.log('[PromptLab] Web release auth environment check passed.');
