export const PROMPT_LAB_APP_URL = 'https://promptlab.tools/app';
export const PROMPT_LAB_MAX_URL_LENGTH = 1800;

export function buildPromptLabDraftUrl({ draft = '', title = '', source = '', tab = '', clipboard = false } = {}) {
  const url = new URL(PROMPT_LAB_APP_URL);
  if (draft) url.searchParams.set('draft', draft);
  if (title) url.searchParams.set('title', title);
  if (source) url.searchParams.set('source', source);
  if (tab) url.searchParams.set('tab', tab);
  if (clipboard) url.searchParams.set('clipboard', '1');
  return url.toString();
}

export function hasPromptLabDraftOverflow(payload) {
  return buildPromptLabDraftUrl(payload).length > PROMPT_LAB_MAX_URL_LENGTH;
}

export function readPromptLabDraftParams(search = '') {
  const params = new URLSearchParams(search);
  const draft = params.get('draft') || '';
  const title = params.get('title') || '';
  const source = params.get('source') || '';
  const tab = params.get('tab') || '';
  const clipboard = params.get('clipboard') === '1';

  return {
    draft,
    title,
    source,
    tab,
    clipboard,
    hasPayload: Boolean(draft || title || source || tab || clipboard),
  };
}

export function clearPromptLabDraftParams() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.delete('draft');
  url.searchParams.delete('title');
  url.searchParams.delete('source');
  url.searchParams.delete('tab');
  url.searchParams.delete('clipboard');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}
