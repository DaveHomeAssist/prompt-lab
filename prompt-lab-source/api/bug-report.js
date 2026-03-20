const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const NOTION_API_URL = 'https://api.notion.com/v1/pages';
const MAX_BLOCK_TEXT = 1800;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

function clampText(value, max = 6000) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function splitChunks(text, max = MAX_BLOCK_TEXT) {
  const source = clampText(text, 20000);
  if (!source) return [];
  const chunks = [];
  for (let index = 0; index < source.length; index += max) {
    chunks.push(source.slice(index, index + max));
  }
  return chunks;
}

function richText(content) {
  const chunks = splitChunks(content);
  return chunks.length
    ? chunks.map((chunk) => ({ type: 'text', text: { content: chunk } }))
    : [{ type: 'text', text: { content: '' } }];
}

function paragraphBlocks(text) {
  return splitChunks(text).map((chunk) => ({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content: chunk } }],
    },
  }));
}

function codeBlocks(text) {
  return splitChunks(text).map((chunk) => ({
    object: 'block',
    type: 'code',
    code: {
      language: 'json',
      rich_text: [{ type: 'text', text: { content: chunk } }],
    },
  }));
}

function headingBlock(text) {
  return {
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: text } }],
    },
  };
}

function detailsParagraph(label, value) {
  if (!value) return null;
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [
        { type: 'text', text: { content: `${label}: ` }, annotations: { bold: true } },
        { type: 'text', text: { content: value } },
      ],
    },
  };
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const notionToken = process.env.NOTION_TOKEN;
  const parentPageId = process.env.NOTION_BUG_REPORT_PARENT_PAGE_ID;

  if (!notionToken || !parentPageId) {
    return json({ error: 'Bug reporting is not configured.' }, 503);
  }

  try {
    const payload = await request.json();

    if (payload?.website) {
      return json({ ok: true, ignored: true });
    }

    const title = clampText(payload?.title, 160);
    const severity = clampText(payload?.severity, 40) || 'Medium';
    const surface = clampText(payload?.surface, 120);
    const product = clampText(payload?.product, 80) || 'Prompt Lab';
    const steps = clampText(payload?.steps, 6000);
    const expected = clampText(payload?.expected, 6000);
    const actual = clampText(payload?.actual, 6000);
    const contact = clampText(payload?.contact, 160);
    const url = clampText(payload?.url, 1000);
    const context = payload?.context && typeof payload.context === 'object' ? payload.context : {};
    const promptContext = payload?.promptContext && typeof payload.promptContext === 'object' ? payload.promptContext : null;

    if (!title || !steps) {
      return json({ error: 'Title and steps are required.' }, 400);
    }

    const createdAt = new Date().toISOString();
    const contextJson = JSON.stringify(
      {
        ...context,
        submittedAt: createdAt,
      },
      null,
      2,
    );

    const children = [
      headingBlock('Bug Summary'),
      ...paragraphBlocks(`${severity} severity report for ${product}${surface ? ` / ${surface}` : ''}.`),
      detailsParagraph('URL', url),
      detailsParagraph('Contact', contact),
      detailsParagraph('Browser', clampText(context.browser, 500)),
      detailsParagraph('Environment', clampText(context.environment, 120)),
      detailsParagraph('View', clampText(context.viewPath, 240)),
      detailsParagraph('App Version', clampText(context.appVersion, 64)),
      detailsParagraph('Submitted', createdAt),
      headingBlock('Steps to Reproduce'),
      ...paragraphBlocks(steps),
    ].filter(Boolean);

    if (expected) {
      children.push(headingBlock('Expected'));
      children.push(...paragraphBlocks(expected));
    }
    if (actual) {
      children.push(headingBlock('Actual'));
      children.push(...paragraphBlocks(actual));
    }

    children.push(headingBlock('Client Context'));
    children.push(...codeBlocks(contextJson));

    if (promptContext && (promptContext.raw || promptContext.enhanced)) {
      children.push(headingBlock('Prompt Context'));
      if (promptContext.mode) {
        children.push(...paragraphBlocks(`Enhance mode: ${clampText(promptContext.mode, 80)}`));
      }
      if (promptContext.raw) {
        children.push(headingBlock('Raw Prompt'));
        children.push(...codeBlocks(clampText(promptContext.raw, 12000)));
      }
      if (promptContext.enhanced) {
        children.push(headingBlock('Enhanced Prompt'));
        children.push(...codeBlocks(clampText(promptContext.enhanced, 12000)));
      }
    }

    const notionResponse = await fetch(NOTION_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${notionToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2025-09-03',
      },
      body: JSON.stringify({
        parent: {
          type: 'page_id',
          page_id: parentPageId,
        },
        properties: {
          title: {
            title: richText(`[${severity}] ${title}`),
          },
        },
        children,
      }),
    });

    const notionData = await notionResponse.json();
    if (!notionResponse.ok) {
      return json({ error: notionData?.message || 'Notion request failed', detail: notionData }, notionResponse.status);
    }

    return json({ ok: true, id: notionData.id, pageUrl: notionData.url });
  } catch (error) {
    return json({ error: error?.message || 'Bug report failed' }, 500);
  }
}
