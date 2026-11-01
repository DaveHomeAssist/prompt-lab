import { beforeEach, describe, expect, it } from 'vitest';
import seedData from '../data/promptlab-seed-libraries.json';
import { getStarterLibraries, loadStarterPack } from '../lib/seedTransform.js';

const pack = (id) => seedData.libraries.find((library) => library.id === id);

beforeEach(() => localStorage.clear());

describe('Stream Deck Buttons starter library', () => {
  it('offers GPTGO as a Stream Deck key prompt with a valid key label', () => {
    const library = pack('lib_stream_deck_buttons');
    expect(library.prompts.map((prompt) => prompt.id)).toEqual(['sd_gpt_go_001']);
    library.prompts.forEach((prompt) => {
      const label = prompt.title.split(' · ')[0];
      expect(label).toMatch(/^[A-Z0-9]+(?: [A-Z0-9]+)?$/);
      expect(label.replace(' ', '').length).toBeLessThanOrEqual(8);
      expect(prompt.tags).toContain('stream-deck');
    });
    const go = library.prompts[0].prompt;
    expect(go).toMatch(/^Proceed with the last request now\./);
    expect(go).toContain('Do not ask for confirmation');
    expect(go).toMatch(/delete or overwrite data, spend money, send or publish/);
  });
});

describe('Agent Briefs starter library', () => {
  it('ships both briefs with fillable fields and the full brief structure', () => {
    const library = pack('lib_agent_briefs');
    expect(library.prompts.map((prompt) => prompt.title)).toEqual([
      'Diagnostics & Error Reporting',
      'Screen Sizes & Touchscreen Access',
    ]);
    library.prompts.forEach((prompt) => {
      expect(prompt.tags).toContain('agent-brief');
      for (const section of ['ROLE', 'SHARED CONVENTIONS', 'METHOD', 'OUTPUT', 'CONSTRAINTS']) {
        expect(prompt.prompt).toContain(`\n${section}\n`);
      }
      expect(prompt.prompt).toMatch(/^Target: </m);
      expect(prompt.prompt).toMatch(/^Mode: <audit only \| audit then implement>$/m);
      expect(prompt.prompt).not.toMatch(/\{\{/);
    });
    expect(library.prompts[1].prompt).toContain('1470x956');
  });

  it('loads both new starters through the real starter loader without touching user rows', () => {
    const existing = [{ id: 'mine', title: 'Mine', original: 'Keep', enhanced: 'Keep' }];
    const ids = getStarterLibraries().map((library) => library.id);
    expect(ids).toEqual(expect.arrayContaining(['lib_stream_deck_buttons', 'lib_agent_briefs']));
    const deck = loadStarterPack('lib_stream_deck_buttons', existing, []);
    expect(deck.count).toBe(1);
    expect(deck.library.find((row) => row.id === 'mine')).toMatchObject({ title: 'Mine' });
    const briefs = loadStarterPack('lib_agent_briefs', deck.library, deck.collections);
    expect(briefs.count).toBe(2);
    expect(briefs.library.filter((row) => row.metadata?.packId === 'lib_agent_briefs').map((row) => row.collection))
      .toEqual(['Agent Briefs', 'Agent Briefs']);
  });

  it('keeps private addresses out of starter content', () => {
    // The only address allowed in shipped starter content is the public support email.
    const text = JSON.stringify(seedData);
    const addresses = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
    expect(addresses.filter((address) => address.toLowerCase() !== 'avbydave@gmail.com')).toEqual([]);
  });
});
