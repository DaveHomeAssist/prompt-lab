import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HOSTED_QUOTA_STORAGE_KEY,
  getHostedQuota,
  nextHostedQuotaReset,
  recordHostedQuota,
  resetHostedQuotaCache,
} from '../lib/hostedQuota.js';
import { createProxyFetch } from '../lib/proxyFetch.js';
import { saveSettings } from '../lib/desktopApi.js';
import HostedQuotaBadge, { describeHostedQuota } from '../HostedQuotaBadge.jsx';

const NOW = Date.parse('2026-09-23T12:00:00.000Z');
const DEMO_RESET = '2026-09-24T05:54:53.529Z';
const GLOBAL_RESET = '2026-09-24T02:00:00.000Z';
const theme = { border: 'border-slate-700', btn: 'bg-slate-800', textMuted: 'text-slate-400' };

function proxyResponse(status, headers) {
  return new Response(JSON.stringify({ ok: status < 400 }), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const standardSuccess = () => proxyResponse(200, {
  'X-Hosted-Access': 'standard',
  'X-Demo-Limit': '3',
  'X-Demo-Remaining': '1',
  'X-Demo-Reset': DEMO_RESET,
  'X-Global-Limit': '100',
  'X-Global-Remaining': '92',
  'X-Global-Reset': GLOBAL_RESET,
});

beforeEach(() => {
  // The fixtures carry absolute reset instants (DEMO_RESET, GLOBAL_RESET), and
  // recordHostedQuota/getHostedQuota default to Date.now(). Without a pinned
  // clock these tests pass only until the wall clock crosses DEMO_RESET, then
  // the snapshot reads as expired and the badge renders nothing. Pin Date alone
  // so real timers, React scheduling and fetch keep working.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  localStorage.clear();
  resetHostedQuotaCache();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
  resetHostedQuotaCache();
});

describe('hosted quota snapshot', () => {
  it('records the demo and global windows from a served hosted request', () => {
    recordHostedQuota(standardSuccess(), NOW);

    expect(getHostedQuota(NOW)).toEqual({
      access: 'standard',
      demo: { remaining: 1, limit: 3, resetAt: DEMO_RESET },
      global: { remaining: 92, limit: 100, resetAt: GLOBAL_RESET },
    });
    expect(nextHostedQuotaReset(NOW)).toBe(Date.parse(GLOBAL_RESET));
  });

  it('shows owners as uncapped and clears a stale demo window', () => {
    recordHostedQuota(standardSuccess(), NOW);
    recordHostedQuota(proxyResponse(200, {
      'X-Hosted-Access': 'owner',
      'X-Global-Limit': '100',
      'X-Global-Remaining': '91',
      'X-Global-Reset': GLOBAL_RESET,
    }), NOW);

    const quota = getHostedQuota(NOW);
    expect(quota.access).toBe('owner');
    expect(quota.demo).toBeNull();
    expect(describeHostedQuota(quota).text).toBe('Owner access · no daily demo cap');
  });

  it('hides the badge once a personal key is in use', () => {
    recordHostedQuota(standardSuccess(), NOW);
    // A personal-key request reaches the provider without any hosted window.
    recordHostedQuota(proxyResponse(200, { 'X-Hosted-Access': 'standard' }), NOW);

    expect(getHostedQuota(NOW)).toBeNull();
  });

  it('merges a demo 429 into the snapshot and ignores a burst 429', () => {
    recordHostedQuota(standardSuccess(), NOW);
    recordHostedQuota(proxyResponse(429, {
      'X-Demo-Limit': '3',
      'X-Demo-Remaining': '0',
      'X-Demo-Reset': DEMO_RESET,
    }), NOW);

    let quota = getHostedQuota(NOW);
    expect(quota.demo).toEqual({ remaining: 0, limit: 3, resetAt: DEMO_RESET });
    expect(quota.global.remaining).toBe(92);

    recordHostedQuota(proxyResponse(429, { 'X-RateLimit-Reset': DEMO_RESET }), NOW);
    quota = getHostedQuota(NOW);
    expect(quota.demo.remaining).toBe(0);
  });

  it('drops windows whose reset time has passed', () => {
    recordHostedQuota(standardSuccess(), NOW);
    const afterGlobalReset = Date.parse(GLOBAL_RESET) + 1;

    expect(getHostedQuota(afterGlobalReset).global).toBeNull();
    expect(getHostedQuota(afterGlobalReset).demo.remaining).toBe(1);
    expect(getHostedQuota(Date.parse(DEMO_RESET) + 1)).toBeNull();
  });

  it('survives a reload through localStorage and tolerates corrupt storage', () => {
    recordHostedQuota(standardSuccess(), NOW);
    resetHostedQuotaCache();
    expect(getHostedQuota(NOW).demo.remaining).toBe(1);

    localStorage.setItem(HOSTED_QUOTA_STORAGE_KEY, '{not json');
    resetHostedQuotaCache();
    expect(getHostedQuota(NOW)).toBeNull();
  });

  it('is fed by the hosted proxy fetch without consuming the body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(standardSuccess()));

    const response = await createProxyFetch()('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(response.bodyUsed).toBe(false);
    expect(await response.json()).toEqual({ ok: true });
    expect(getHostedQuota(NOW).demo.remaining).toBe(1);
  });
});

describe('describeHostedQuota', () => {
  const window = (remaining, limit = 3) => ({ remaining, limit, resetAt: DEMO_RESET });

  it('grades the demo window by what is left', () => {
    expect(describeHostedQuota({ access: 'standard', demo: window(2), global: null }))
      .toMatchObject({ tone: 'info', offerKey: false });
    expect(describeHostedQuota({ access: 'standard', demo: window(2), global: null }).text)
      .toMatch(/^Hosted demo: 2 of 3 left today · resets /);
    expect(describeHostedQuota({ access: 'standard', demo: window(1), global: null }))
      .toMatchObject({ tone: 'warn', offerKey: true });
    expect(describeHostedQuota({ access: 'standard', demo: window(0), global: null }))
      .toMatchObject({ tone: 'danger', offerKey: true });
    expect(describeHostedQuota({ access: 'standard', demo: window(0), global: null }).text)
      .toMatch(/^Hosted demo used up for today · resets /);
  });

  it('reports an exhausted shared budget and tolerates a missing limit', () => {
    expect(describeHostedQuota({ access: 'owner', demo: null, global: window(0, 100) }).text)
      .toMatch(/^Shared hosted budget used up/);
    expect(describeHostedQuota({ access: 'standard', demo: { remaining: 2, limit: null, resetAt: null }, global: null }).text)
      .toBe('Hosted demo: 2 left today');
    expect(describeHostedQuota(null)).toBeNull();
  });
});

describe('HostedQuotaBadge', () => {
  it('renders nothing before any hosted request', () => {
    const { container } = render(<HostedQuotaBadge m={theme} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('updates live and offers Provider Settings once the demo is used up', () => {
    const onOpenSettings = vi.fn();
    render(<HostedQuotaBadge m={theme} onOpenSettings={onOpenSettings} />);

    act(() => recordHostedQuota(standardSuccess()));
    expect(screen.getByTestId('hosted-quota')).toHaveTextContent(/Hosted demo: 1 of 3 left today/);

    act(() => recordHostedQuota(proxyResponse(429, {
      'X-Demo-Limit': '3',
      'X-Demo-Remaining': '0',
      'X-Demo-Reset': DEMO_RESET,
    })));
    expect(screen.getByRole('status')).toHaveTextContent(/Hosted demo used up for today/);
    fireEvent.click(screen.getByRole('button', { name: 'Use your own key' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('drops the shared-key snapshot as soon as a personal key is saved', () => {
    render(<HostedQuotaBadge m={theme} />);
    act(() => recordHostedQuota(proxyResponse(429, {
      'X-Demo-Limit': '3',
      'X-Demo-Remaining': '0',
      'X-Demo-Reset': DEMO_RESET,
    })));
    expect(screen.getByTestId('hosted-quota')).toHaveTextContent(/used up/);

    act(() => saveSettings({ provider: 'anthropic', apiKey: 'sk-ant-personal' }));

    expect(screen.queryByTestId('hosted-quota')).toBeNull();
    expect(localStorage.getItem(HOSTED_QUOTA_STORAGE_KEY)).toBeNull();
    expect(getHostedQuota()).toBeNull();
  });
});
