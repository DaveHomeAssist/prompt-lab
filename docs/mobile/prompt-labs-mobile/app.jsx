// app.jsx — main composition: design canvas with paired iOS + Android frames per route, tweaks panel.

const { useState: usePLState } = React;

const PL_ROUTES = [
  { id: 'library',        label: 'Library',         section: 'browse',  desc: 'Saved prompts, tags, search' },
  { id: 'library-detail', label: 'Prompt detail',   section: 'browse',  desc: 'Enhanced + original, history' },
  { id: 'composer',       label: 'Composer',        section: 'compose', desc: 'Write, enhance, run' },
  { id: 'streaming',      label: 'Streaming',       section: 'compose', desc: 'Live response from provider' },
  { id: 'voice',          label: 'Voice capture',   section: 'compose', desc: 'Mic-driven prompt input' },
  { id: 'pad-list',       label: 'Pad list',        section: 'pad',     desc: 'Notebook index' },
  { id: 'pad-detail',     label: 'Pad entry',       section: 'pad',     desc: 'Long-form notes' },
];

const PL_SECTIONS = [
  { id: 'browse',  title: 'Browse · Library',        subtitle: 'How users find and reuse saved prompts.' },
  { id: 'compose', title: 'Compose · Run',           subtitle: 'Author, enhance, and execute prompts.' },
  { id: 'pad',     title: 'Pad · Notebook',          subtitle: 'Long-form thinking that feeds back into prompts.' },
];

// Per-route nav state, so each artboard remembers which sub-screen the user clicked into.
function PLPair({ routeId, theme }) {
  const [route, setRoute] = usePLState(routeId);
  const [param, setParam] = usePLState(null);
  const nav = (r, p = null) => { setRoute(r); setParam(p); };
  return (
    <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase', color: 'oklch(0.55 0.01 280)' }}>iOS</div>
        <IOSDevice width={390} height={780} dark={theme.isDark}>
          <PLScreen route={route} params={param} nav={nav} theme={theme} />
        </IOSDevice>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase', color: 'oklch(0.55 0.01 280)' }}>Android</div>
        <AndroidDevice width={400} height={800} dark={theme.isDark}>
          <PLScreen route={route} params={param} nav={nav} theme={theme} />
        </AndroidDevice>
      </div>
    </div>
  );
}

function PLApp() {
  const [tweaks, setTweak] = useTweaks(window.PL_TWEAK_DEFAULTS);
  const theme = makeTheme(tweaks);

  return (
    <>
      <DesignCanvas>
        {PL_SECTIONS.map(sec => (
          <DCSection key={sec.id} id={sec.id} title={sec.title} subtitle={sec.subtitle}>
            {PL_ROUTES.filter(r => r.section === sec.id).map(r => (
              <DCArtboard key={r.id} id={r.id} label={`${r.label} — ${r.desc}`} width={900} height={830}>
                <div style={{
                  width: 900, height: 830, padding: 0,
                  background: 'oklch(0.97 0.005 280)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <PLPair routeId={r.id} theme={theme} />
                </div>
              </DCArtboard>
            ))}
          </DCSection>
        ))}
      </DesignCanvas>

      <TweaksPanel title="Tweaks">
        <TweakSection label="Theme">
          <TweakToggle label="Dark mode" value={tweaks.dark} onChange={(v) => setTweak('dark', v)} />
        </TweakSection>
        <TweakSection label="Accent">
          <TweakRadio
            label="Color"
            value={tweaks.accent}
            options={[
              { value: 'violet', label: 'Violet' },
              { value: 'teal',   label: 'Teal'   },
              { value: 'amber',  label: 'Amber'  },
              { value: 'mono',   label: 'Mono'   },
            ]}
            onChange={(v) => setTweak('accent', v)}
          />
        </TweakSection>
        <TweakSection label="Type scale">
          <TweakRadio
            label="Size"
            value={tweaks.type}
            options={[
              { value: 'small',  label: 'Compact' },
              { value: 'medium', label: 'Default' },
              { value: 'large',  label: 'Large'   },
            ]}
            onChange={(v) => setTweak('type', v)}
          />
        </TweakSection>
        <TweakSection label="Cards">
          <TweakRadio
            label="Style"
            value={tweaks.cardStyle}
            options={[
              { value: 'flat',     label: 'Flat'     },
              { value: 'outlined', label: 'Outlined' },
              { value: 'elevated', label: 'Elevated' },
            ]}
            onChange={(v) => setTweak('cardStyle', v)}
          />
        </TweakSection>
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<PLApp />);
