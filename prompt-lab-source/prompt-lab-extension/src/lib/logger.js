const PREFIX = '[PromptLab]';

export function logWarn(context, error) {
  console.warn(PREFIX, context, error instanceof Error ? error.message : error);
}

export function logError(context, error) {
  console.error(PREFIX, context, error instanceof Error ? error.message : error);
}
