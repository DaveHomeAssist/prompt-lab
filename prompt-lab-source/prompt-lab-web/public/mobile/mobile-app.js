(function () {
  const STORAGE_KEY = "pl_mobile_app_state_v1";
  const STREAM_DELAY = 38;

  const tabMeta = {
    library: { label: "Library", icon: "L", title: "Library", subtitle: "Find and reuse saved prompts" },
    compose: { label: "Compose", icon: "+", title: "Compose", subtitle: "Refine, run, and save" },
    pad: { label: "Pad", icon: "P", title: "Pad", subtitle: "Notes that become prompts" },
  };

  const seedPrompts = [
    {
      id: "p1",
      title: "Code review - senior reviewer",
      collection: "Engineering",
      tags: ["review", "code"],
      uses: 47,
      body: "Act as a senior engineer. Review the following code for correctness, clarity, maintainability, and hidden edge cases. Return findings by severity, then include a short patch strategy.",
      enhanced: "Act as a senior engineer conducting a production-readiness review. Identify correctness bugs, security risks, maintainability issues, missing tests, and edge cases. Prioritize findings by severity and include concrete file-level fixes.",
    },
    {
      id: "p2",
      title: "Weekly digest summarizer",
      collection: "Writing",
      tags: ["summary", "weekly"],
      uses: 23,
      body: "Summarize the following content into a punchy weekly digest with wins, risks, and next actions.",
      enhanced: "Transform the following source material into a crisp weekly digest. Use sections for wins, risks, decisions, next actions, and open questions. Keep the tone direct and executive-readable.",
    },
    {
      id: "p3",
      title: "Bug repro extractor",
      collection: "Engineering",
      tags: ["bug", "qa"],
      uses: 12,
      body: "Given a bug report, extract minimal reproduction steps, expected behavior, actual behavior, environment, and likely owner.",
      enhanced: "Analyze this bug report and produce a minimal reproduction package: steps, preconditions, expected result, actual result, environment, suspected component, severity, and missing diagnostic data.",
    },
    {
      id: "p4",
      title: "Cold-email opener",
      collection: "Sales",
      tags: ["email", "b2b"],
      uses: 8,
      body: "Write a warm opening line for a B2B outreach email based on this company context.",
      enhanced: "Write three concise B2B outreach openers using the provided company context. Avoid hype, reference a concrete signal, and keep each opener under 28 words.",
    },
  ];

  const seedPads = [
    {
      id: "n1",
      title: "Q2 planning scratchpad",
      updated: "Today",
      body: "Mobile should feel capture-first. The quickest path is: capture idea -> refine prompt -> save result. Reorderable tabs should let power users put Pad first if that is their workflow.",
    },
    {
      id: "n2",
      title: "Research synthesis notes",
      updated: "Yesterday",
      body: "Try a Pad-to-Composer bridge. Long notes can become structured prompts without asking users to copy and paste between surfaces.",
    },
  ];

  const state = loadState();
  let streamTimer = null;
  let voiceTimer = null;
  const sampleVoiceCapture = "Turn this quick product idea into a reusable launch checklist prompt with risks and owners.";

  function defaultState() {
    return {
      activeTab: "library",
      tabOrder: ["library", "compose", "pad"],
      search: "",
      collection: "All",
      detailPromptId: null,
      detailPadId: null,
      composerText: "Turn these meeting notes into a decision log with owners, dates, and risks.",
      output: "",
      streaming: false,
      sheet: null,
      voiceStatus: "idle",
      voiceTranscript: "",
      toast: "",
      prompts: seedPrompts,
      pads: seedPads,
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return {
        ...defaultState(),
        ...parsed,
        prompts: Array.isArray(parsed.prompts) && parsed.prompts.length ? parsed.prompts : seedPrompts,
        pads: Array.isArray(parsed.pads) && parsed.pads.length ? parsed.pads : seedPads,
        tabOrder: sanitizeTabOrder(parsed.tabOrder),
        streaming: false,
        sheet: null,
        voiceStatus: "idle",
      };
    } catch (_error) {
      return defaultState();
    }
  }

  function sanitizeTabOrder(order) {
    const valid = ["library", "compose", "pad"];
    const next = Array.isArray(order) ? order.filter((id) => valid.includes(id)) : [];
    valid.forEach((id) => {
      if (!next.includes(id)) next.push(id);
    });
    return next;
  }

  function persist() {
    const snapshot = { ...state, streaming: false, sheet: null, toast: "", voiceStatus: "idle" };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  }

  function setState(patch) {
    Object.assign(state, patch);
    persist();
    render();
  }

  function showToast(message) {
    state.toast = message;
    render();
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
      state.toast = "";
      render();
    }, 1800);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function short(value, length) {
    const text = String(value || "").trim();
    return text.length > length ? `${text.slice(0, length - 1)}...` : text;
  }

  function uid(prefix) {
    return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  }

  function activeTitle() {
    if (state.detailPromptId) return "Prompt";
    if (state.detailPadId) return "Pad entry";
    return tabMeta[state.activeTab].title;
  }

  function activeSubtitle() {
    if (state.detailPromptId) return "Enhanced, original, and reuse";
    if (state.detailPadId) return "Edit notes and send to Composer";
    return tabMeta[state.activeTab].subtitle;
  }

  function render() {
    const root = document.getElementById("app");
    root.innerHTML = `
      <main class="phone">
        ${renderTopbar()}
        <section class="content">
          ${renderActiveView()}
        </section>
        ${renderTabbar()}
        ${state.sheet === "settings" ? renderSettingsSheet() : ""}
        ${state.sheet === "voice" ? renderVoiceSheet() : ""}
        ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
      </main>
    `;
  }

  function renderTopbar() {
    const back = state.detailPromptId || state.detailPadId;
    return `
      <header class="topbar">
        ${back ? `<button class="icon-btn" data-action="back" aria-label="Back">&lt;</button>` : `<div class="brand-mark">PL</div>`}
        <div class="topbar-title">
          <h1>${escapeHtml(activeTitle())}</h1>
          <p>${escapeHtml(activeSubtitle())}</p>
        </div>
        <button class="icon-btn" data-action="open-settings" aria-label="Customize tabs">=</button>
      </header>
    `;
  }

  function renderActiveView() {
    if (state.detailPromptId) return renderPromptDetail();
    if (state.detailPadId) return renderPadDetail();
    if (state.activeTab === "library") return renderLibrary();
    if (state.activeTab === "compose") return renderComposer();
    return renderPadList();
  }

  function renderTabbar() {
    return `
      <nav class="tabbar" style="--tab-count:${state.tabOrder.length}" aria-label="Mobile tabs">
        ${state.tabOrder.map((id) => {
          const meta = tabMeta[id];
          return `
            <button class="tab-btn ${state.activeTab === id ? "active" : ""}" data-action="tab" data-tab="${id}">
              <span>${escapeHtml(meta.icon)}</span>
              <span>${escapeHtml(meta.label)}</span>
            </button>
          `;
        }).join("")}
      </nav>
    `;
  }

  function renderLibrary() {
    const collections = ["All", ...Array.from(new Set(state.prompts.map((p) => p.collection)))];
    const query = state.search.trim().toLowerCase();
    const prompts = state.prompts.filter((prompt) => {
      const haystack = `${prompt.title} ${prompt.collection} ${prompt.tags.join(" ")} ${prompt.body}`.toLowerCase();
      return (state.collection === "All" || prompt.collection === state.collection) && (!query || haystack.includes(query));
    });

    return `
      <div class="section-head">
        <div>
          <h2>Saved prompts</h2>
          <p>${state.prompts.length} prompts across ${collections.length - 1} collections</p>
        </div>
        <a class="canvas-link" href="./canvas.html">Canvas</a>
      </div>
      <div class="stack">
        <input class="search" data-action="search" value="${escapeHtml(state.search)}" placeholder="Search prompts, tags, text">
        <div class="chip-row">
          ${collections.map((collection) => `
            <button class="pill-btn ${state.collection === collection ? "active" : ""}" data-action="collection" data-collection="${escapeHtml(collection)}">${escapeHtml(collection)}</button>
          `).join("")}
        </div>
        ${prompts.length ? prompts.map(renderPromptCard).join("") : `<div class="empty">No prompts match this search.</div>`}
      </div>
    `;
  }

  function renderPromptCard(prompt) {
    return `
      <button class="card" data-action="open-prompt" data-id="${prompt.id}">
        <h3>${escapeHtml(prompt.title)}</h3>
        <p>${escapeHtml(short(prompt.enhanced || prompt.body, 122))}</p>
        <div class="meta">
          <span class="badge">${escapeHtml(prompt.collection)}</span>
          <span>${prompt.uses || 0} uses</span>
          <span>${prompt.tags.map((tag) => `#${escapeHtml(tag)}`).join(" ")}</span>
        </div>
      </button>
    `;
  }

  function renderPromptDetail() {
    const prompt = state.prompts.find((item) => item.id === state.detailPromptId);
    if (!prompt) return `<div class="empty">Prompt not found.</div>`;
    return `
      <div class="stack">
        <div class="section-head">
          <div>
            <h2>${escapeHtml(prompt.title)}</h2>
            <p>${escapeHtml(prompt.collection)} - ${prompt.uses || 0} uses</p>
          </div>
        </div>
        <div class="output">
          <h3>Enhanced</h3>
          <p>${escapeHtml(prompt.enhanced || prompt.body)}</p>
        </div>
        <article class="card">
          <h3>Original</h3>
          <p>${escapeHtml(prompt.body)}</p>
          <div class="meta">${prompt.tags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join("")}</div>
        </article>
        <div class="split">
          <button class="primary-btn" data-action="use-prompt" data-id="${prompt.id}">Use prompt</button>
          <button class="quiet-btn" data-action="copy-prompt" data-id="${prompt.id}">Copy</button>
        </div>
      </div>
    `;
  }

  function renderComposer() {
    return `
      <div class="section-head">
        <div>
          <h2>Compose</h2>
          <p>Write, improve, run, then save what works.</p>
        </div>
        <button class="pill-btn" data-action="open-voice">Voice</button>
      </div>
      <div class="stack">
        <textarea class="field" data-action="composer-input" placeholder="Write or paste a rough prompt">${escapeHtml(state.composerText)}</textarea>
        <div class="action-row">
          <button class="primary-btn" data-action="enhance">Refine prompt</button>
          <button class="pill-btn" data-action="run">Run</button>
          <button class="quiet-btn" data-action="clear-composer">Clear</button>
        </div>
        ${state.output || state.streaming ? `
          <div class="output">
            <h3>${state.streaming ? "Streaming" : "Response"}</h3>
            <p>${escapeHtml(state.output)}${state.streaming ? `<span class="cursor"></span>` : ""}</p>
          </div>
          <div class="split">
            <button class="primary-btn" data-action="save-output-library">Save prompt</button>
            <button class="quiet-btn" data-action="save-output-pad">Save to Pad</button>
          </div>
        ` : `
          <div class="empty">Run a prompt to see a simulated mobile response here.</div>
        `}
      </div>
    `;
  }

  function renderPadList() {
    return `
      <div class="section-head">
        <div>
          <h2>Pad</h2>
          <p>Capture loose notes and turn them into prompts.</p>
        </div>
        <button class="primary-btn" data-action="new-pad">New</button>
      </div>
      <div class="stack">
        ${state.pads.map((pad) => `
          <button class="card" data-action="open-pad" data-id="${pad.id}">
            <h3>${escapeHtml(pad.title)}</h3>
            <p>${escapeHtml(short(pad.body, 138))}</p>
            <div class="meta"><span>${escapeHtml(pad.updated)}</span><span>${pad.body.split(/\s+/).filter(Boolean).length} words</span></div>
          </button>
        `).join("")}
      </div>
    `;
  }

  function renderPadDetail() {
    const pad = state.pads.find((item) => item.id === state.detailPadId);
    if (!pad) return `<div class="empty">Pad note not found.</div>`;
    return `
      <div class="stack">
        <input class="search" data-action="pad-title" value="${escapeHtml(pad.title)}" aria-label="Pad title">
        <textarea class="note-field" data-action="pad-body" aria-label="Pad body">${escapeHtml(pad.body)}</textarea>
        <div class="split">
          <button class="primary-btn" data-action="pad-to-composer">To Composer</button>
          <button class="quiet-btn" data-action="copy-pad">Copy</button>
        </div>
        <button class="danger-btn" data-action="delete-pad">Delete note</button>
      </div>
    `;
  }

  function renderSettingsSheet() {
    return `
      <div class="sheet-backdrop" data-action="close-sheet">
        <section class="sheet" role="dialog" aria-modal="true" aria-label="Customize mobile tabs" data-sheet>
          <div class="section-head">
            <div>
              <h2>Customize tabs</h2>
              <p>Choose the order that fits your thumb path. The first tab becomes your startup tab.</p>
            </div>
            <button class="icon-btn" data-action="close-sheet" aria-label="Close">x</button>
          </div>
          <div class="stack">
            ${state.tabOrder.map((id, index) => `
              <div class="row">
                <div class="row-title">
                  <span class="brand-mark" style="width:34px;height:34px;border-radius:11px">${escapeHtml(tabMeta[id].icon)}</span>
                  <span>
                    <strong>${escapeHtml(tabMeta[id].label)}</strong>
                    <small>${index === 0 ? "Startup tab" : tabMeta[id].subtitle}</small>
                  </span>
                </div>
                <div class="move-controls">
                  <button data-action="move-tab" data-tab="${id}" data-dir="-1" ${index === 0 ? "disabled" : ""}>Up</button>
                  <button data-action="move-tab" data-tab="${id}" data-dir="1" ${index === state.tabOrder.length - 1 ? "disabled" : ""}>Down</button>
                </div>
              </div>
            `).join("")}
            <button class="quiet-btn" data-action="reset-tabs">Reset tab order</button>
            <a class="canvas-link" href="./canvas.html">Open original design canvas</a>
          </div>
        </section>
      </div>
    `;
  }

  function renderVoiceSheet() {
    return `
      <div class="sheet-backdrop" data-action="close-sheet">
        <section class="sheet" role="dialog" aria-modal="true" aria-label="Voice capture" data-sheet>
          <div class="section-head">
            <div>
              <h2>Voice capture</h2>
              <p>Capture a rough idea, then send it into Composer.</p>
            </div>
            <button class="icon-btn" data-action="close-sheet" aria-label="Close">x</button>
          </div>
          <div class="voice-orb ${state.voiceStatus === "listening" ? "listening" : ""}">
            <strong>${state.voiceStatus === "listening" ? "Listening" : "Mic"}</strong>
          </div>
          <div class="stack">
            <textarea class="field" data-action="voice-input" placeholder="Transcript appears here">${escapeHtml(state.voiceTranscript)}</textarea>
            <div class="split">
              <button class="primary-btn" data-action="start-voice">${state.voiceStatus === "listening" ? "Listening..." : "Start"}</button>
              <button class="quiet-btn" data-action="voice-to-composer">Use text</button>
            </div>
            <p class="small">Uses Web Speech when the browser supports it; otherwise the prototype fills a sample capture.</p>
          </div>
        </section>
      </div>
    `;
  }

  function enhancePrompt() {
    const text = state.composerText.trim();
    if (!text) {
      showToast("Write a prompt first");
      return;
    }
    setState({
      composerText: `You are helping produce a high-quality result.\n\nTask:\n${text}\n\nRequirements:\n- Ask only for missing context that blocks the work.\n- Return a structured answer with concise headings.\n- Include assumptions, risks, and a concrete next action.\n- Keep the tone direct and practical.`,
    });
    showToast("Prompt refined");
  }

  function runPrompt() {
    const text = state.composerText.trim();
    if (!text) {
      showToast("Write a prompt first");
      return;
    }
    window.clearInterval(streamTimer);
    const response = buildResponse(text);
    const words = response.split(" ");
    let index = 0;
    state.output = "";
    state.streaming = true;
    render();
    streamTimer = window.setInterval(() => {
      index += 1;
      state.output = words.slice(0, index).join(" ");
      if (index >= words.length) {
        window.clearInterval(streamTimer);
        state.streaming = false;
      }
      render();
    }, STREAM_DELAY);
  }

  function buildResponse(text) {
    return `Here is a mobile-ready version: ${short(text.replace(/\s+/g, " "), 130)}. Suggested structure: goal, context, constraints, output format, and acceptance criteria. Next, save this to the Library if it is reusable, or to Pad if it still needs thinking.`;
  }

  function saveOutputToLibrary() {
    const source = state.composerText.trim();
    if (!source) {
      showToast("Nothing to save");
      return;
    }
    const prompt = {
      id: uid("p"),
      title: short(source.split("\n")[0], 46) || "Untitled prompt",
      collection: "Mobile",
      tags: ["mobile"],
      uses: 0,
      body: source,
      enhanced: state.output || source,
    };
    state.prompts = [prompt, ...state.prompts];
    state.activeTab = "library";
    state.detailPromptId = prompt.id;
    persist();
    render();
    showToast("Saved to Library");
  }

  function saveOutputToPad() {
    const body = state.output || state.composerText;
    if (!body.trim()) {
      showToast("Nothing to save");
      return;
    }
    const pad = {
      id: uid("n"),
      title: short(state.composerText.split("\n")[0], 42) || "Composer note",
      updated: "Just now",
      body,
    };
    state.pads = [pad, ...state.pads];
    state.activeTab = "pad";
    state.detailPadId = pad.id;
    persist();
    render();
    showToast("Saved to Pad");
  }

  function moveTab(id, dir) {
    const index = state.tabOrder.indexOf(id);
    const nextIndex = index + Number(dir);
    if (index < 0 || nextIndex < 0 || nextIndex >= state.tabOrder.length) return;
    const next = [...state.tabOrder];
    const [item] = next.splice(index, 1);
    next.splice(nextIndex, 0, item);
    setState({ tabOrder: next, activeTab: next[0] });
    showToast("Tab order saved");
  }

  function startVoice() {
    window.clearTimeout(voiceTimer);
    state.voiceStatus = "listening";
    render();
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition();
        recognition.lang = "en-US";
        recognition.interimResults = false;
        recognition.onresult = (event) => {
          window.clearTimeout(voiceTimer);
          state.voiceTranscript = event.results[0][0].transcript;
          state.voiceStatus = "idle";
          persist();
          render();
        };
        recognition.onerror = () => {
          mockVoiceCapture();
        };
        recognition.onend = () => {
          if (state.voiceStatus === "listening" && !state.voiceTranscript.trim()) mockVoiceCapture();
        };
        recognition.start();
        voiceTimer = window.setTimeout(() => {
          try {
            recognition.stop();
          } catch (_error) {
            // The fallback below handles unsupported stop states.
          }
          if (state.voiceStatus === "listening" && !state.voiceTranscript.trim()) {
            state.voiceTranscript = sampleVoiceCapture;
            state.voiceStatus = "idle";
            persist();
            render();
          }
        }, 1800);
        return;
      } catch (_error) {
        mockVoiceCapture();
        return;
      }
    }
    mockVoiceCapture();
  }

  function mockVoiceCapture() {
    state.voiceStatus = "listening";
    render();
    voiceTimer = window.setTimeout(() => {
      state.voiceTranscript = sampleVoiceCapture;
      state.voiceStatus = "idle";
      persist();
      render();
    }, 900);
  }

  function updatePad(id, patch) {
    state.pads = state.pads.map((pad) => pad.id === id ? { ...pad, ...patch, updated: "Just now" } : pad);
    persist();
  }

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;

    if (action === "close-sheet" && (target === event.target || target.closest("[data-action]").dataset.action === "close-sheet")) {
      if (event.target.closest("[data-sheet]") && target.classList.contains("sheet-backdrop")) return;
      setState({ sheet: null });
      return;
    }
    if (target.closest("[data-sheet]") && target.classList.contains("sheet-backdrop")) return;

    if (action === "tab") setState({ activeTab: target.dataset.tab, detailPromptId: null, detailPadId: null });
    if (action === "back") setState({ detailPromptId: null, detailPadId: null });
    if (action === "open-settings") setState({ sheet: "settings" });
    if (action === "open-voice") setState({ sheet: "voice" });
    if (action === "collection") setState({ collection: target.dataset.collection });
    if (action === "open-prompt") setState({ detailPromptId: target.dataset.id });
    if (action === "use-prompt") {
      const prompt = state.prompts.find((item) => item.id === target.dataset.id);
      if (prompt) setState({ composerText: prompt.enhanced || prompt.body, activeTab: "compose", detailPromptId: null });
    }
    if (action === "copy-prompt") {
      const prompt = state.prompts.find((item) => item.id === target.dataset.id);
      if (prompt) navigator.clipboard?.writeText(prompt.enhanced || prompt.body);
      showToast("Prompt copied");
    }
    if (action === "enhance") enhancePrompt();
    if (action === "run") runPrompt();
    if (action === "clear-composer") setState({ composerText: "", output: "", streaming: false });
    if (action === "save-output-library") saveOutputToLibrary();
    if (action === "save-output-pad") saveOutputToPad();
    if (action === "new-pad") {
      const pad = { id: uid("n"), title: "Untitled note", updated: "Just now", body: "" };
      state.pads = [pad, ...state.pads];
      setState({ activeTab: "pad", detailPadId: pad.id });
    }
    if (action === "open-pad") setState({ detailPadId: target.dataset.id });
    if (action === "pad-to-composer") {
      const pad = state.pads.find((item) => item.id === state.detailPadId);
      if (pad) setState({ composerText: `Turn these notes into a reusable prompt:\n\n${pad.body}`, activeTab: "compose", detailPadId: null });
    }
    if (action === "copy-pad") {
      const pad = state.pads.find((item) => item.id === state.detailPadId);
      if (pad) navigator.clipboard?.writeText(pad.body);
      showToast("Pad copied");
    }
    if (action === "delete-pad") {
      state.pads = state.pads.filter((pad) => pad.id !== state.detailPadId);
      setState({ detailPadId: null, activeTab: "pad" });
      showToast("Pad deleted");
    }
    if (action === "move-tab") moveTab(target.dataset.tab, target.dataset.dir);
    if (action === "reset-tabs") setState({ tabOrder: ["library", "compose", "pad"], activeTab: "library" });
    if (action === "start-voice") startVoice();
    if (action === "voice-to-composer") {
      if (!state.voiceTranscript.trim()) {
        showToast("Capture or type transcript first");
        return;
      }
      setState({ composerText: state.voiceTranscript, activeTab: "compose", sheet: null });
    }
  });

  document.addEventListener("input", (event) => {
    const target = event.target;
    const action = target.dataset.action;
    if (action === "search") setState({ search: target.value });
    if (action === "composer-input") {
      state.composerText = target.value;
      persist();
    }
    if (action === "voice-input") {
      state.voiceTranscript = target.value;
      persist();
    }
    if (action === "pad-title" && state.detailPadId) updatePad(state.detailPadId, { title: target.value });
    if (action === "pad-body" && state.detailPadId) updatePad(state.detailPadId, { body: target.value });
  });

  render();
})();
