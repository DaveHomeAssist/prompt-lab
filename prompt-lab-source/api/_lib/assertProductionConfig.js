function readStringEnv(name, env = process.env) {
  const value = env[name];
  return typeof value === 'string' ? value.trim() : '';
}

export function hasDurableStoreConfig(env = process.env) {
  return Boolean(
    readStringEnv('KV_URL', env) ||
    (readStringEnv('KV_REST_API_URL', env) && readStringEnv('KV_REST_API_TOKEN', env)) ||
    (readStringEnv('UPSTASH_REDIS_REST_URL', env) && readStringEnv('UPSTASH_REDIS_REST_TOKEN', env)),
  );
}

export function assertProductionConfig(env = process.env) {
  if (readStringEnv('NODE_ENV', env) !== 'production') return;

  const missing = [];
  if (!readStringEnv('STRIPE_SECRET_KEY', env)) missing.push('STRIPE_SECRET_KEY');
  if (!readStringEnv('CLERK_SECRET_KEY', env)) missing.push('CLERK_SECRET_KEY');
  if (!readStringEnv('STRIPE_WEBHOOK_SECRET', env)) missing.push('STRIPE_WEBHOOK_SECRET');
  if (!hasDurableStoreConfig(env)) {
    missing.push('KV_URL, KV_REST_API_URL+KV_REST_API_TOKEN, or UPSTASH_REDIS_REST_URL+UPSTASH_REDIS_REST_TOKEN');
  }

  if (missing.length > 0) {
    throw new Error(`[PromptLab] Production API configuration is incomplete. Missing: ${missing.join(', ')}.`);
  }
}
