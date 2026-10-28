// Product call 7: the desktop (Tauri) app cannot complete a purchase, so it
// shows the plan and a "Manage your plan at promptlab.tools" link instead of
// Upgrade / Manage Billing / the billing dialog. Pro detection is unchanged.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AppHeader from '../AppHeader.jsx';
import SettingsModal from '../modals/SettingsModal.jsx';
import {
  DESKTOP_PLAN_LINK_TEXT,
  DESKTOP_PLAN_URL,
  canAccessFeature,
  isDesktopAppSurface,
} from '../lib/billing.js';

vi.mock('../icons.jsx', () => ({ default: () => null }));

const platformState = vi.hoisted(() => ({ isExtension: false }));
vi.mock('../lib/platform.js', () => ({
  get isExtension() { return platformState.isExtension; },
}));

const noop = () => {};
const theme = {
  header: 'header', btn: 'button', textAlt: 'text-alt', textMuted: 'text-muted', textSub: 'text-sub',
  text: 'text', surface: 'surface', border: 'border', modal: 'modal', modalBg: 'modal-bg', textBody: 'text-body',
};

function renderHeader(overrides = {}) {
  const openBilling = vi.fn();
  render(
    <AppHeader
      m={theme} compact={false} libraryCount={0} colorMode="dark" setColorMode={noop}
      activeSection="create" openSection={noop} openCreateView={noop} openRunsView={noop}
      primaryView="create" setPrimaryView={noop} workspaceView="editor" runsView="history"
      effectiveEditorLayout="balanced" setEditorLayout={noop} createLayoutOptions={[]}
      setShowCmdPalette={noop} setCmdQuery={noop} setShowShortcuts={noop} setShowSettings={noop}
      billingPlan="free" billingLabel="Free" billingDisabled={false} openBilling={openBilling}
      {...overrides}
    />,
  );
  return { openBilling };
}

function renderSettings(overrides = {}) {
  const openBilling = vi.fn();
  render(
    <SettingsModal
      m={theme} showNotes={false} setShowNotes={vi.fn()} density="comfortable" setDensity={vi.fn()}
      collections={[]} deleteCollection={vi.fn()} exportLib={vi.fn()} importLib={vi.fn()}
      clearLibrary={vi.fn()} openOptions={vi.fn()} onClose={vi.fn()}
      billing={{ plan: 'free', planLabel: 'Free', statusCopy: 'Free plan is active.' }}
      openBilling={openBilling}
      {...overrides}
    />,
  );
  return { openBilling };
}

afterEach(() => {
  platformState.isExtension = false;
  vi.unstubAllEnvs();
  delete window.__TAURI_INTERNALS__;
});

describe('isDesktopAppSurface', () => {
  it('is false for the web app and plain test/extension builds', () => {
    vi.stubEnv('VITE_WEB_MODE', 'true');
    expect(isDesktopAppSurface()).toBe(false);
    vi.stubEnv('VITE_WEB_MODE', 'false');
    expect(isDesktopAppSurface()).toBe(false);
  });

  it('is true for the desktop build flag or the Tauri runtime', () => {
    vi.stubEnv('VITE_PROMPTLAB_SURFACE', 'desktop');
    expect(isDesktopAppSurface()).toBe(true);
  });

  it('is true inside the Tauri runtime without the build flag', () => {
    window.__TAURI_INTERNALS__ = {};
    expect(isDesktopAppSurface()).toBe(true);
  });

  it('is never true in the Chrome extension', () => {
    platformState.isExtension = true;
    vi.stubEnv('VITE_PROMPTLAB_SURFACE', 'desktop');
    window.__TAURI_INTERNALS__ = {};
    expect(isDesktopAppSurface()).toBe(false);
  });

  it('the desktop Vite config sets the surface flag', () => {
    const config = readFileSync(resolve(process.cwd(), '../prompt-lab-desktop/vite.config.js'), 'utf8');
    expect(config).toMatch(/'import\.meta\.env\.VITE_PROMPTLAB_SURFACE':\s*JSON\.stringify\('desktop'\)/);
  });

  it('keeps Pro detection: desktop never gates and Pro stays Pro', () => {
    window.__TAURI_INTERNALS__ = {};
    expect(canAccessFeature({ plan: 'pro' }, 'abTesting')).toBe(true);
    expect(canAccessFeature({ plan: 'free' }, 'abTesting')).toBe(true);
  });
});

describe('AppHeader on desktop', () => {
  it('replaces Upgrade with the promptlab.tools link and keeps the plan chip', () => {
    const { openBilling } = renderHeader({ desktopPlanLink: true });
    expect(screen.queryByTestId('billing-trigger')).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: DESKTOP_PLAN_LINK_TEXT });
    expect(link).toHaveAttribute('href', DESKTOP_PLAN_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByTestId('billing-plan-chip')).toHaveTextContent('Free');
    expect(openBilling).not.toHaveBeenCalled();
  });

  it('shows Pro detected on desktop with the same link', () => {
    renderHeader({ desktopPlanLink: true, billingPlan: 'pro', billingLabel: 'Pro Annual' });
    expect(screen.getByTestId('billing-plan-chip')).toHaveTextContent('Pro Annual');
    expect(screen.getByRole('link', { name: DESKTOP_PLAN_LINK_TEXT })).toBeInTheDocument();
  });

  it('web and other builds keep Upgrade and no desktop link', () => {
    renderHeader();
    expect(screen.getByTestId('billing-trigger')).toHaveTextContent('Upgrade');
    expect(screen.queryByTestId('desktop-plan-link')).not.toBeInTheDocument();
  });
});

describe('SettingsModal billing card on desktop', () => {
  it('shows the plan and the link instead of Upgrade to Pro', () => {
    const { openBilling } = renderSettings({ desktopPlanLink: true });
    expect(screen.getByText('Free plan is active.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upgrade to Pro' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: DESKTOP_PLAN_LINK_TEXT })).toHaveAttribute('href', DESKTOP_PLAN_URL);
    expect(openBilling).not.toHaveBeenCalled();
  });

  it('keeps Manage Billing for Pro on the web', () => {
    const { openBilling } = renderSettings({ billing: { plan: 'pro', planLabel: 'Pro Monthly', statusCopy: 'Pro is active.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Manage Billing' }));
    expect(openBilling).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('desktop-plan-link')).not.toBeInTheDocument();
  });
});
