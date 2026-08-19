import test from 'node:test';
import assert from 'node:assert/strict';

import { buildReport } from './notion-docs-agent.mjs';

test('buildReport returns a structured report in dry-run mode', async () => {
  const config = {
    provider: 'none',
    model: 'gpt-4.1-mini',
    pageTitle: 'Prompt Lab GitHub Docs Sync',
    notionToken: '',
    notionParentPageId: '',
    notionApiVersion: '2022-06-28',
    openAiApiKey: '',
    anthropicApiKey: '',
    maxDocs: 3,
    maxCharsPerDoc: 1200,
    dryRun: true,
  };

  const report = await buildReport(config, 'workflow_dispatch', {});

  assert.ok(report.pageTitle.includes('Prompt Lab GitHub Docs Sync'));
  assert.equal(report.runContext.eventName, 'workflow_dispatch');
  assert.ok(Array.isArray(report.repoDocs));
  assert.ok(report.repoDocs.length > 0);
  assert.ok(Array.isArray(report.blocks));
  assert.ok(report.blocks.length > 0);
  assert.equal(report.blocks[0].type, 'heading_1');
  assert.ok(
    report.insights.followUps.includes(
      'Review the generated snapshot before choosing an explicit live Notion sync.'
    )
  );
  assert.ok(!report.insights.followUps.some(item => item.includes('workflow_run')));
});
