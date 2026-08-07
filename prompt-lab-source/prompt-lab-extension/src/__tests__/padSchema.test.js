import { beforeEach, describe, expect, it } from 'vitest';
import {
  PADS_KEY,
  PADS_SCHEMA_VERSION_KEY,
  PADS_V2_BACKUP_KEY,
  loadAndMigratePads,
  padDocumentToPlainText,
  persistPadsPayload,
  sanitizePastedPadHtml,
} from '../lib/padSchema.js';

describe('pad schema version 3', () => {
  beforeEach(() => localStorage.clear());

  it('backs up and migrates version-2 pads without losing text', () => {
    const v2 = {
      pads: [
        { id: 'default', name: 'Scratchpad', content: 'Line one\n\nLine three', timestamp: 1785931200000 },
        { id: 'second', name: 'Run notes', content: 'Camera A\nCamera B', timestamp: 1785931300000 },
      ],
      activePadId: 'second',
    };
    localStorage.setItem(PADS_KEY, JSON.stringify(v2));
    localStorage.setItem(PADS_SCHEMA_VERSION_KEY, '2');

    const result = loadAndMigratePads(localStorage, '2026-08-05T12:00:00.000Z');

    expect(result.migrated).toBe(true);
    expect(result.payload.schemaVersion).toBe(3);
    expect(result.payload.pads.map((pad) => pad.plainText)).toEqual(['Line one\n\nLine three', 'Camera A\nCamera B']);
    expect(padDocumentToPlainText(result.payload.pads[0].doc)).toBe('Line one\n\nLine three');
    expect(JSON.parse(localStorage.getItem(PADS_V2_BACKUP_KEY)).payload).toEqual(v2);
  });

  it('preserves structured marks, task lists, and colors after reload', () => {
    const result = loadAndMigratePads(localStorage, '2026-08-05T12:00:00.000Z');
    const payload = {
      ...result.payload,
      pads: [{
        ...result.payload.pads[0],
        plainText: 'Ready\n- [x] Verified',
        doc: {
          type: 'doc',
          content: [
            { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Ready', marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { color: '#22c55e' } }] }] },
            { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Verified', marks: [{ type: 'underline' }] }] }] }] },
          ],
        },
      }],
    };

    persistPadsPayload(payload, localStorage);
    const reloaded = loadAndMigratePads(localStorage);

    expect(reloaded.migrated).toBe(false);
    expect(reloaded.payload.pads[0].doc).toEqual(payload.pads[0].doc);
    expect(reloaded.payload.pads[0].plainText).toBe('Ready\n- [x] Verified');
  });

  it('removes unsafe pasted content and unapproved inline styles', () => {
    const sanitized = sanitizePastedPadHtml(
      '<p onclick="bad()" style="font-size:60px;color:#22c55e">Safe<script>bad()</script></p><span style="color:magenta">Plain</span>',
      ['#22c55e'],
    );

    expect(sanitized).toContain('color: rgb(34, 197, 94)');
    expect(sanitized).not.toContain('font-size');
    expect(sanitized).not.toContain('onclick');
    expect(sanitized).not.toContain('<script');
    expect(sanitized).not.toContain('magenta');
  });
});
