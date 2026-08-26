import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);

const DEFAULT_PAGE_TITLE = 'Prompt Lab GitHub Docs Sync';
const DEFAULT_PROVIDER = 'none';
const DEFAULT_MODEL = 'gpt-4.1-mini';
const DEFAULT_MAX_DOCS = 6;
const DEFAULT_MAX_CHARS_PER_DOC = 5000;
const MAX_NOTION_TEXT = 1800;
const MAX_BULLETS = 8;

function truncate(text, maxChars) {
  const value = String(text || '').trim();
  if (!value || value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function compactWhitespace(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitParagraph(text, maxChars = MAX_NOTION_TEXT) {
  const clean = compactWhitespace(text);
  if (!clean) return [];

  const chunks = [];
  let remaining = clean;

  while (remaining.length > maxChars) {
    let slicePoint = remaining.lastIndexOf(' ', maxChars);
    if (slicePoint < maxChars * 0.5) slicePoint = maxChars;
    chunks.push(remaining.slice(0, slicePoint).trim());
    remaining = remaining.slice(slicePoint).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function coerceInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envFlag(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function stripMarkdown(text) {
  return compactWhitespace(
    String(text || '')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  );
}

function titleCaseFromPath(filePath) {
  return filePath
    .split('/')
    .at(-1)
    ?.replace(/\.md$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, match => match.toUpperCase()) || filePath;
}

function extractHeadings(markdown) {
  return String(markdown || '')
    .split('\n')
    .map(line => line.match(/^#{1,6}\s+(.+)$/)?.[1]?.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function summarizeDiff(diffText) {
  const added = [];
  const removed = [];

  for (const line of String(diffText || '').split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) continue;
    if (line.startsWith('+')) added.push(line.slice(1).trim());
    if (line.startsWith('-')) removed.push(line.slice(1).trim());
  }

  const addSnippet = truncate(stripMarkdown(added.find(Boolean) || ''), 180);
  const removeSnippet = truncate(stripMarkdown(removed.find(Boolean) || ''), 180);

  if (addSnippet && removeSnippet) {
    return `Added "${addSnippet}" and removed "${removeSnippet}".`;
  }
  if (addSnippet) return `Added "${addSnippet}".`;
  if (removeSnippet) return `Removed "${removeSnippet}".`;
  return 'Documentation changed, but the diff did not contain readable line-level additions or removals.';
}

function buildRunUrl(eventName, event) {
  const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
  const repo = process.env.GITHUB_REPOSITORY;
  const runId =
    process.env.GITHUB_RUN_ID ||
    event?.workflow_run?.id ||
    event?.run_id ||
    event?.check_run?.run_id;

  if (!repo || !runId) return '';
  return `${serverUrl}/${repo}/actions/runs/${runId}`;
}

function normalizeRunContext(eventName, event) {
  const workflowRun = event?.workflow_run || null;

  return {
    repository: process.env.GITHUB_REPOSITORY || event?.repository?.full_name || 'local',
    eventName,
    workflowName:
      workflowRun?.name ||
      process.env.GITHUB_WORKFLOW ||
      event?.workflow?.name ||
      'manual',
    status:
      workflowRun?.status ||
      event?.workflow_job?.status ||
      event?.check_run?.status ||
      'completed',
    conclusion:
      workflowRun?.conclusion ||
      event?.workflow_job?.conclusion ||
      event?.check_run?.conclusion ||
      'unknown',
    branch:
      workflowRun?.head_branch ||
      event?.ref_name ||
      process.env.GITHUB_REF_NAME ||
      '',
    sha:
      workflowRun?.head_sha ||
      event?.after ||
      process.env.GITHUB_SHA ||
      '',
    actor:
      workflowRun?.actor?.login ||
      event?.sender?.login ||
      process.env.GITHUB_ACTOR ||
      '',
    runUrl: buildRunUrl(eventName, event),
    timestamp: new Date().toISOString(),
  };
}

function buildPageTitle(config, runContext) {
  const workflow = truncate(runContext.workflowName, 48);
  const branch = truncate(runContext.branch || 'no-branch', 24);
  return truncate(
    `${config.pageTitle} - ${workflow} - ${branch}`.replace(/\s+/g, ' ').trim(),
    96
  );
}

function shouldTrackDoc(filePath) {
  return ![
    'node_modules/',
    '/node_modules/',
    'dist/',
    '/dist/',
    '_archive/',
    'package-lock.json',
  ].some(segment => filePath.includes(segment));
}

async function git(args, { allowFailure = false } = {}) {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (error) {
    if (allowFailure) return '';
    const stderr = error.stderr ? String(error.stderr).trim() : '';
    throw new Error(`git ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`);
  }
}

async function listTrackedMarkdownFiles() {
  const stdout = await git(['ls-files', '*.md'], { allowFailure: true });
  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(shouldTrackDoc)
    .sort();
}

async function changedMarkdownFilesForEvent(eventName, event) {
  if (eventName === 'push' && event?.before && event?.after) {
    const stdout = await git(
      ['diff', '--name-only', event.before, event.after, '--', '*.md'],
      { allowFailure: true }
    );
    return stdout
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .filter(shouldTrackDoc);
  }

  const sha = event?.workflow_run?.head_sha || event?.after || process.env.GITHUB_SHA;
  if (!sha) return [];

  const stdout = await git(
    ['diff-tree', '--no-commit-id', '--name-only', '-r', sha, '--', '*.md'],
    { allowFailure: true }
  );

  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(shouldTrackDoc);
}

async function readDocSnapshot(filePath, maxCharsPerDoc) {
  const content = await fs.readFile(path.resolve(process.cwd(), filePath), 'utf8');
  const headings = extractHeadings(content);
  return {
    path: filePath,
    title: titleCaseFromPath(filePath),
    headings,
    excerpt: truncate(content, maxCharsPerDoc),
    size: content.length,
  };
}

async function readDocDiff(filePath, eventName, event) {
  if (eventName === 'push' && event?.before && event?.after) {
    return git(
      ['diff', '--unified=0', event.before, event.after, '--', filePath],
      { allowFailure: true }
    );
  }

  const sha = event?.workflow_run?.head_sha || event?.after || process.env.GITHUB_SHA;
  if (!sha) return '';

  return git(['show', '--unified=0', `${sha}`, '--', filePath], {
    allowFailure: true,
  });
}

function selectSourceDocs(allDocs, changedDocs, maxDocs) {
  const priority = ['DOCS_INVENTORY.md', 'ARCHITECTURE.md', 'ROADMAP.md', 'MOBILE_DEPLOYMENT_ROADMAP.md'];
  const selected = [...changedDocs];

  for (const filePath of priority) {
    if (allDocs.includes(filePath)) selected.push(filePath);
  }

  for (const filePath of allDocs) {
    if (selected.length >= maxDocs) break;
    selected.push(filePath);
  }

  return unique(selected).slice(0, maxDocs);
}

function buildFallbackInsights(runContext, changedDocs, repoDocs) {
  const highlights = [];

  const runLabel = `${runContext.workflowName} concluded with ${runContext.conclusion}.`;
  highlights.push(runLabel);

  if (changedDocs.length > 0) {
    highlights.push(
      `Detected documentation changes in ${changedDocs.length} file${changedDocs.length === 1 ? '' : 's'}.`
    );
  } else {
    highlights.push('No markdown docs changed in the triggering commit, so the page reflects the current tracked documentation snapshot.');
  }

  const keyDocs = repoDocs
    .slice(0, 3)
    .map(doc => doc.path)
    .join(', ');

  if (keyDocs) {
    highlights.push(`Primary source files reviewed: ${keyDocs}.`);
  }

  const changedDocSummaries = changedDocs.map(doc => ({
    path: doc.path,
    summary:
      doc.diffSummary ||
      `Updated ${doc.path}${doc.headings[0] ? ` with emphasis on ${doc.headings[0]}.` : '.'}`,
    impact:
      doc.headings.length > 0
        ? `Headings touched include ${doc.headings.slice(0, 3).join(', ')}.`
        : 'No markdown headings were detected in the stored excerpt.',
  }));

  const followUps = [];
  if (
    runContext.conclusion &&
    !['success', 'neutral', 'skipped', 'unknown'].includes(runContext.conclusion)
  ) {
    followUps.push(
      `Review the failing run before treating this Notion page as release-ready documentation.`
    );
  }
  if (changedDocs.length === 0) {
    followUps.push(
      runContext.eventName === 'workflow_dispatch'
        ? 'Review the generated snapshot before choosing an explicit live Notion sync.'
        : 'If this workflow should react to more than markdown file changes, expand the tracked path list or trigger conditions.'
    );
  } else {
    followUps.push('Verify that the updated markdown files remain the canonical source of truth for the Notion page.');
  }
  if (runContext.eventName === 'workflow_run') {
    followUps.push('Adjust the workflow_run names in .github/workflows/notion-docs-agent.yml if your CI workflows use different titles.');
  }

  return {
    summary: highlights.join(' '),
    highlights: highlights.slice(0, MAX_BULLETS),
    changedDocs: changedDocSummaries.slice(0, MAX_BULLETS),
    followUps: followUps.slice(0, MAX_BULLETS),
  };
}

function parseJsonResponse(text) {
  const clean = String(text || '').trim();
  if (!clean) return null;

  try {
    return JSON.parse(clean);
  } catch {}

  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(clean.slice(start, end + 1));
    } catch {}
  }

  return null;
}

function sanitizeAiInsights(raw, fallback) {
  const data = raw && typeof raw === 'object' ? raw : {};

  const highlights = Array.isArray(data.highlights)
    ? data.highlights.map(item => truncate(stripMarkdown(item), 260)).filter(Boolean)
    : fallback.highlights;

  const changedDocs = Array.isArray(data.changedDocs)
    ? data.changedDocs
        .map(item => ({
          path: truncate(String(item?.path || ''), 120),
          summary: truncate(stripMarkdown(item?.summary || ''), 260),
          impact: truncate(stripMarkdown(item?.impact || ''), 220),
        }))
        .filter(item => item.path && item.summary)
    : fallback.changedDocs;

  const followUps = Array.isArray(data.followUps)
    ? data.followUps.map(item => truncate(stripMarkdown(item), 240)).filter(Boolean)
    : fallback.followUps;

  return {
    summary: truncate(stripMarkdown(data.summary || fallback.summary), 900),
    highlights: highlights.slice(0, MAX_BULLETS),
    changedDocs: changedDocs.slice(0, MAX_BULLETS),
    followUps: followUps.slice(0, MAX_BULLETS),
  };
}

function buildAiPayload(runContext, changedDocs, repoDocs) {
  return {
    run: {
      repository: runContext.repository,
      workflowName: runContext.workflowName,
      eventName: runContext.eventName,
      status: runContext.status,
      conclusion: runContext.conclusion,
      branch: runContext.branch,
      sha: runContext.sha,
      actor: runContext.actor,
      runUrl: runContext.runUrl,
    },
    changedDocs: changedDocs.map(doc => ({
      path: doc.path,
      headings: doc.headings,
      diffSummary: doc.diffSummary,
      excerpt: truncate(stripMarkdown(doc.excerpt), 1200),
    })),
    repoDocs: repoDocs.map(doc => ({
      path: doc.path,
      headings: doc.headings,
      excerpt: truncate(stripMarkdown(doc.excerpt), 1200),
    })),
    instruction:
      'Summarize the documentation state grounded only in these inputs. Be factual. Do not invent implementation details or files.',
  };
}

async function callOpenAI(config, payload) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openAiApiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are a documentation sync agent. Return strict JSON with keys summary, highlights, changedDocs, followUps. changedDocs must be an array of objects with path, summary, impact.',
        },
        {
          role: 'user',
          content: JSON.stringify(payload),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return parseJsonResponse(data?.choices?.[0]?.message?.content);
}

async function callAnthropic(config, payload) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.anthropicApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 1000,
      temperature: 0.2,
      system:
        'You are a documentation sync agent. Return strict JSON with keys summary, highlights, changedDocs, followUps. changedDocs must be an array of objects with path, summary, impact.',
      messages: [
        {
          role: 'user',
          content: JSON.stringify(payload),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic request failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const text = Array.isArray(data?.content)
    ? data.content
        .map(block => (block?.type === 'text' ? block.text : ''))
        .join('\n')
    : '';

  return parseJsonResponse(text);
}

async function generateInsights(config, runContext, changedDocs, repoDocs) {
  const fallback = buildFallbackInsights(runContext, changedDocs, repoDocs);
  if (config.provider === 'none') return fallback;

  try {
    const payload = buildAiPayload(runContext, changedDocs, repoDocs);
    let raw = null;

    if (config.provider === 'openai') {
      raw = await callOpenAI(config, payload);
    } else if (config.provider === 'anthropic') {
      raw = await callAnthropic(config, payload);
    } else {
      throw new Error(`Unsupported DOCS_AGENT_PROVIDER: ${config.provider}`);
    }

    return sanitizeAiInsights(raw, fallback);
  } catch (error) {
    console.warn(`[notion-docs-agent] Falling back to deterministic summary: ${error.message}`);
    return fallback;
  }
}

function richText(content, { url } = {}) {
  const text = {
    content: truncate(String(content || ''), MAX_NOTION_TEXT),
  };

  if (url) {
    text.link = { url };
  }

  return [
    {
      type: 'text',
      text,
    },
  ];
}

function paragraphBlocks(text) {
  return splitParagraph(text).map(chunk => ({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: richText(chunk),
    },
  }));
}

function bulletBlock(text) {
  return {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: richText(text),
    },
  };
}

function headingBlock(level, text) {
  const key = `heading_${level}`;
  return {
    object: 'block',
    type: key,
    [key]: {
      rich_text: richText(text),
      is_toggleable: false,
    },
  };
}

function dividerBlock() {
  return { object: 'block', type: 'divider', divider: {} };
}

function buildNotionBlocks(runContext, insights, changedDocs, repoDocs) {
  const blocks = [];

  blocks.push(headingBlock(1, 'Sync Summary'));
  blocks.push(...paragraphBlocks(insights.summary));

  blocks.push(headingBlock(2, 'Workflow Run'));
  blocks.push(bulletBlock(`Repository: ${runContext.repository}`));
  blocks.push(bulletBlock(`Workflow: ${runContext.workflowName}`));
  blocks.push(bulletBlock(`Event: ${runContext.eventName}`));
  blocks.push(bulletBlock(`Status: ${runContext.status}`));
  blocks.push(bulletBlock(`Conclusion: ${runContext.conclusion}`));
  if (runContext.branch) blocks.push(bulletBlock(`Branch: ${runContext.branch}`));
  if (runContext.sha) blocks.push(bulletBlock(`Commit: ${runContext.sha.slice(0, 12)}`));
  if (runContext.actor) blocks.push(bulletBlock(`Actor: ${runContext.actor}`));
  if (runContext.runUrl) {
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          { type: 'text', text: { content: 'Run URL: ' } },
          { type: 'text', text: { content: runContext.runUrl, link: { url: runContext.runUrl } } },
        ],
      },
    });
  }

  blocks.push(dividerBlock());
  blocks.push(headingBlock(2, 'Highlights'));
  for (const item of insights.highlights) {
    blocks.push(bulletBlock(item));
  }

  blocks.push(dividerBlock());
  blocks.push(headingBlock(2, 'Changed Docs'));
  if (changedDocs.length === 0) {
    blocks.push(...paragraphBlocks('No markdown documentation files changed in the triggering commit.'));
  } else {
    for (const item of insights.changedDocs) {
      blocks.push(headingBlock(3, item.path));
      blocks.push(...paragraphBlocks(item.summary));
      if (item.impact) blocks.push(...paragraphBlocks(item.impact));
    }
  }

  blocks.push(dividerBlock());
  blocks.push(headingBlock(2, 'Source Files Considered'));
  for (const doc of repoDocs) {
    const headingPreview = doc.headings.length > 0 ? ` | headings: ${doc.headings.join(', ')}` : '';
    blocks.push(bulletBlock(`${doc.path}${headingPreview}`));
  }

  blocks.push(dividerBlock());
  blocks.push(headingBlock(2, 'Follow Up'));
  for (const item of insights.followUps) {
    blocks.push(bulletBlock(item));
  }

  return blocks;
}

class NotionClient {
  constructor({ token, apiVersion, dryRun }) {
    this.token = token;
    this.apiVersion = apiVersion;
    this.dryRun = dryRun;
  }

  async request(pathname, { method = 'GET', body } = {}) {
    if (this.dryRun) {
      return {};
    }

    const response = await fetch(`https://api.notion.com${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'Notion-Version': this.apiVersion,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`Notion request failed: ${response.status} ${await response.text()}`);
    }

    return response.status === 204 ? {} : response.json();
  }

  async listBlockChildren(blockId) {
    let nextCursor = undefined;
    const results = [];

    do {
      const query = new URLSearchParams();
      if (nextCursor) query.set('start_cursor', nextCursor);
      const suffix = query.toString() ? `?${query}` : '';
      const data = await this.request(`/v1/blocks/${blockId}/children${suffix}`);
      results.push(...(data.results || []));
      nextCursor = data.has_more ? data.next_cursor : undefined;
    } while (nextCursor);

    return results;
  }

  async findChildPage(parentPageId, title) {
    const blocks = await this.listBlockChildren(parentPageId);
    return (
      blocks.find(block => block.type === 'child_page' && block.child_page?.title === title) || null
    );
  }

  async createChildPage(parentPageId, title) {
    return this.request('/v1/pages', {
      method: 'POST',
      body: {
        parent: { page_id: parentPageId },
        properties: {
          title: {
            title: richText(title),
          },
        },
      },
    });
  }

  async updatePageTitle(pageId, title) {
    return this.request(`/v1/pages/${pageId}`, {
      method: 'PATCH',
      body: {
        properties: {
          title: {
            title: richText(title),
          },
        },
      },
    });
  }

  async archiveBlock(blockId) {
    return this.request(`/v1/blocks/${blockId}`, {
      method: 'PATCH',
      body: {
        archived: true,
      },
    });
  }

  async clearPageChildren(pageId) {
    const children = await this.listBlockChildren(pageId);
    for (const child of children) {
      await this.archiveBlock(child.id);
    }
  }

  async appendChildren(blockId, children) {
    for (let index = 0; index < children.length; index += 100) {
      const chunk = children.slice(index, index + 100);
      await this.request(`/v1/blocks/${blockId}/children`, {
        method: 'PATCH',
        body: { children: chunk },
      });
    }
  }
}

function parseConfig() {
  const provider = String(process.env.DOCS_AGENT_PROVIDER || DEFAULT_PROVIDER).toLowerCase();
  const config = {
    provider,
    model: process.env.DOCS_AGENT_MODEL || DEFAULT_MODEL,
    pageTitle: process.env.NOTION_DOCS_PAGE_TITLE || DEFAULT_PAGE_TITLE,
    notionToken: process.env.NOTION_TOKEN || '',
    notionParentPageId: process.env.NOTION_PARENT_PAGE_ID || '',
    notionApiVersion: process.env.NOTION_API_VERSION || '2022-06-28',
    openAiApiKey: process.env.OPENAI_API_KEY || '',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    maxDocs: coerceInt(process.env.DOCS_AGENT_MAX_DOCS, DEFAULT_MAX_DOCS),
    maxCharsPerDoc: coerceInt(
      process.env.DOCS_AGENT_MAX_CHARS_PER_DOC,
      DEFAULT_MAX_CHARS_PER_DOC
    ),
    dryRun: envFlag('DOCS_AGENT_DRY_RUN', false),
  };

  if (!config.dryRun) {
    if (!config.notionToken) throw new Error('Missing NOTION_TOKEN');
    if (!config.notionParentPageId) throw new Error('Missing NOTION_PARENT_PAGE_ID');
  }

  if (config.provider === 'openai' && !config.openAiApiKey) {
    throw new Error('DOCS_AGENT_PROVIDER=openai requires OPENAI_API_KEY');
  }
  if (config.provider === 'anthropic' && !config.anthropicApiKey) {
    throw new Error('DOCS_AGENT_PROVIDER=anthropic requires ANTHROPIC_API_KEY');
  }

  return config;
}

async function loadEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return {};
  const raw = await fs.readFile(eventPath, 'utf8');
  return JSON.parse(raw);
}

export async function buildReport(config, eventName, event) {
  const runContext = normalizeRunContext(eventName, event);
  const allDocs = await listTrackedMarkdownFiles();
  const changedPaths = unique(await changedMarkdownFilesForEvent(eventName, event));
  const sourcePaths = selectSourceDocs(allDocs, changedPaths, config.maxDocs);

  const repoDocs = [];
  for (const filePath of sourcePaths) {
    repoDocs.push(await readDocSnapshot(filePath, config.maxCharsPerDoc));
  }

  const changedDocs = [];
  for (const filePath of changedPaths.slice(0, config.maxDocs)) {
    const snapshot = await readDocSnapshot(filePath, config.maxCharsPerDoc);
    const diff = await readDocDiff(filePath, eventName, event);
    changedDocs.push({
      ...snapshot,
      diffSummary: summarizeDiff(diff),
    });
  }

  const insights = await generateInsights(config, runContext, changedDocs, repoDocs);
  const pageTitle = buildPageTitle(config, runContext);

  return {
    pageTitle,
    runContext,
    repoDocs,
    changedDocs,
    insights,
    blocks: buildNotionBlocks(runContext, insights, changedDocs, repoDocs),
  };
}

async function upsertNotionPage(config, report) {
  const notion = new NotionClient({
    token: config.notionToken,
    apiVersion: config.notionApiVersion,
    dryRun: config.dryRun,
  });

  if (config.dryRun) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const existing = await notion.findChildPage(config.notionParentPageId, report.pageTitle);
  const page =
    existing ||
    (await notion.createChildPage(config.notionParentPageId, report.pageTitle));

  await notion.updatePageTitle(page.id, report.pageTitle);
  await notion.clearPageChildren(page.id);
  await notion.appendChildren(page.id, report.blocks);

  console.log(
    `[notion-docs-agent] Updated Notion page "${report.pageTitle}" (${page.url || page.id})`
  );
}

export async function main() {
  const config = parseConfig();
  const eventName = process.env.GITHUB_EVENT_NAME || 'workflow_dispatch';
  const event = await loadEvent();
  const report = await buildReport(config, eventName, event);
  await upsertNotionPage(config, report);
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  main().catch(error => {
    console.error(`[notion-docs-agent] ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}
