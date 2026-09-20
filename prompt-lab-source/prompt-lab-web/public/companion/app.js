(() => {
  "use strict";

  const STORAGE_KEY = "promptlab-pilot-companion-v1";
  const VIEWS = {
    board: { title: "Launch board", kicker: "Pilot command view" },
    people: { title: "People", kicker: "Cohort operations" },
    outreach: { title: "Outreach", kicker: "Recruitment kit" },
    evidence: { title: "Evidence", kicker: "Learning ledger" },
    decision: { title: "Decision", kicker: "Day-30 readout" },
    billing: { title: "Billing", kicker: "Paid launch readiness" },
    reference: { title: "Pilot reference", kicker: "Original strategy canvas" },
  };

  const DEFAULT_PREFLIGHT = {
    monetization: false,
    privacy: false,
    cohort: false,
    onboarding: false,
    calendar: false,
  };

  const createParticipant = (index) => ({
    id: `participant-${index + 1}`,
    name: "",
    role: "",
    workflow: "",
    source: "",
    status: "Recruiting",
    gates: {
      activated: false,
      retentionW2: false,
      retentionW4: false,
      value: false,
      commercial: false,
      caseStudy: false,
    },
  });

  const defaultState = () => ({
    version: 1,
    theme: "dark",
    startDate: "",
    activeView: "board",
    preflight: { ...DEFAULT_PREFLIGHT },
    participants: Array.from({ length: 5 }, (_, index) => createParticipant(index)),
    evidence: [],
    credibleSponsor: false,
  });

  let state = loadState();
  let saveTimer = null;
  let toastTimer = null;

  const elements = {
    root: document.documentElement,
    tabs: [...document.querySelectorAll("[data-view]")],
    panels: [...document.querySelectorAll("[data-panel]")],
    viewTitle: document.querySelector("#view-title"),
    viewKicker: document.querySelector("#view-kicker"),
    startDate: document.querySelector("#pilot-start-date"),
    themeToggle: document.querySelector("#theme-toggle"),
    exportButton: document.querySelector("#export-data"),
    pilotDayLabel: document.querySelector("#pilot-day-label"),
    runwayProgress: document.querySelector("#runway-progress"),
    runwaySteps: [...document.querySelectorAll(".runway-step")],
    phaseBadge: document.querySelector("#current-phase-badge"),
    preflightInputs: [...document.querySelectorAll("[data-preflight]")],
    preflightCount: document.querySelector("#preflight-count"),
    peopleGrid: document.querySelector("#people-grid"),
    cohortSlots: document.querySelector("#cohort-slots"),
    evidenceForm: document.querySelector("#evidence-form"),
    evidenceParticipant: document.querySelector("#evidence-participant"),
    evidenceType: document.querySelector("#evidence-type"),
    evidenceDate: document.querySelector("#evidence-date"),
    evidenceNote: document.querySelector("#evidence-note"),
    evidenceMetric: document.querySelector("#evidence-metric"),
    evidenceFilter: document.querySelector("#evidence-filter"),
    evidenceList: document.querySelector("#evidence-list"),
    sponsorToggle: document.querySelector("#credible-sponsor"),
    sponsorLabel: document.querySelector("#sponsor-label"),
    resetButton: document.querySelector("#reset-data"),
    resetDialog: document.querySelector("#reset-dialog"),
    toast: document.querySelector("#toast"),
  };

  initialize();

  function initialize() {
    const hashView = window.location.hash.replace("#", "");
    if (VIEWS[hashView]) {
      state.activeView = hashView;
    }

    elements.startDate.value = state.startDate;
    elements.evidenceDate.value = todayISO();
    elements.sponsorToggle.checked = state.credibleSponsor;
    applyTheme(state.theme);
    renderPeople();
    bindEvents();
    renderAll();
    activateView(state.activeView, false);
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      const fallback = defaultState();
      return {
        ...fallback,
        ...parsed,
        preflight: { ...fallback.preflight, ...(parsed.preflight || {}) },
        participants: fallback.participants.map((participant, index) => {
          const saved = Array.isArray(parsed.participants) ? parsed.participants[index] : null;
          return {
            ...participant,
            ...(saved || {}),
            id: participant.id,
            gates: { ...participant.gates, ...(saved?.gates || {}) },
          };
        }),
        evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
      };
    } catch {
      return defaultState();
    }
  }

  function persist(immediate = false) {
    window.clearTimeout(saveTimer);
    const save = () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        showToast("Could not save locally. Export a backup before closing.");
      }
    };
    if (immediate) {
      save();
    } else {
      saveTimer = window.setTimeout(save, 180);
    }
  }

  function bindEvents() {
    elements.tabs.forEach((tab) => {
      tab.addEventListener("click", () => activateView(tab.dataset.view));
      tab.addEventListener("keydown", handleTabKeydown);
    });

    document.querySelectorAll("[data-target-view]").forEach((button) => {
      button.addEventListener("click", () => {
        const target = button.dataset.targetView;
        activateView(target);
        if (button.id === "today-action-button") {
          focusTodayTarget(target);
        }
      });
    });

    elements.startDate.addEventListener("change", () => {
      state.startDate = elements.startDate.value;
      persist(true);
      renderAll();
    });

    elements.themeToggle.addEventListener("click", () => {
      state.theme = state.theme === "dark" ? "light" : "dark";
      applyTheme(state.theme);
      persist(true);
    });

    elements.preflightInputs.forEach((input) => {
      input.addEventListener("change", () => {
        state.preflight[input.dataset.preflight] = input.checked;
        persist(true);
        renderAll();
      });
    });

    elements.peopleGrid.addEventListener("input", handleParticipantInput);
    elements.peopleGrid.addEventListener("change", handleParticipantInput);

    document.querySelectorAll("[data-copy-template]").forEach((button) => {
      button.addEventListener("click", () => copyTemplate(button));
    });

    elements.evidenceForm.addEventListener("submit", addEvidence);
    elements.evidenceFilter.addEventListener("change", renderEvidence);
    elements.evidenceList.addEventListener("click", deleteEvidence);

    elements.sponsorToggle.addEventListener("change", () => {
      state.credibleSponsor = elements.sponsorToggle.checked;
      persist(true);
      renderAll();
    });

    elements.exportButton.addEventListener("click", exportData);
    elements.resetButton.addEventListener("click", () => elements.resetDialog.showModal());
    elements.resetDialog.addEventListener("close", () => {
      if (elements.resetDialog.returnValue === "confirm") {
        resetData();
      }
    });
  }

  function handleTabKeydown(event) {
    const currentIndex = elements.tabs.indexOf(event.currentTarget);
    let nextIndex = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % elements.tabs.length;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + elements.tabs.length) % elements.tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = elements.tabs.length - 1;
    }

    if (nextIndex !== null) {
      event.preventDefault();
      const nextTab = elements.tabs[nextIndex];
      activateView(nextTab.dataset.view);
      nextTab.focus();
    }
  }

  function activateView(view, moveFocus = true) {
    if (!VIEWS[view]) return;
    state.activeView = view;
    elements.tabs.forEach((tab) => {
      const active = tab.dataset.view === view;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    elements.panels.forEach((panel) => {
      const active = panel.dataset.panel === view;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    });
    elements.viewTitle.textContent = VIEWS[view].title;
    elements.viewKicker.textContent = VIEWS[view].kicker;
    window.history.replaceState(null, "", `#${view}`);
    persist();

    if (moveFocus) {
      const panel = document.querySelector(`[data-panel="${view}"]`);
      const heading = panel?.querySelector("h2");
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    }
  }

  function applyTheme(theme) {
    elements.root.dataset.theme = theme;
    const isDark = theme === "dark";
    elements.themeToggle.setAttribute("aria-label", isDark ? "Switch to light theme" : "Switch to dark theme");
  }

  function renderAll() {
    renderPreflight();
    renderRunway();
    renderPeopleValues();
    renderCohortSlots();
    renderMetrics();
    renderEvidenceSelect();
    renderEvidence();
    renderDecision();
    renderTodayAction();
  }

  function renderPreflight() {
    elements.preflightInputs.forEach((input) => {
      input.checked = Boolean(state.preflight[input.dataset.preflight]);
    });
    const complete = Object.values(state.preflight).filter(Boolean).length;
    elements.preflightCount.textContent = `${complete}/5`;
  }

  function renderRunway() {
    const timing = getPilotTiming();
    elements.phaseBadge.textContent = timing.label;
    elements.pilotDayLabel.textContent = timing.status;
    elements.runwayProgress.value = timing.progress;
    elements.runwaySteps.forEach((step, index) => {
      step.classList.toggle("is-complete", index < timing.phaseIndex);
      step.classList.toggle("is-current", index === timing.phaseIndex);
    });
  }

  function getPilotTiming() {
    if (!state.startDate) {
      return {
        day: 0,
        phaseIndex: 0,
        label: "Preflight",
        progress: 0,
        status: "Set a start date to begin the runway.",
      };
    }

    const start = dateAtMidnight(state.startDate);
    const today = dateAtMidnight(todayISO());
    const day = Math.floor((today - start) / 86400000) + 1;
    if (day <= 0) {
      return {
        day,
        phaseIndex: 0,
        label: "Preflight",
        progress: 0,
        status: `Pilot begins in ${Math.abs(day) + 1} day${Math.abs(day) === 0 ? "" : "s"}.`,
      };
    }

    const clampedDay = Math.min(day, 30);
    let phaseIndex = 1;
    let label = "Activate";
    if (day >= 3 && day <= 14) {
      phaseIndex = 2;
      label = "Habit test";
    } else if (day >= 15 && day <= 23) {
      phaseIndex = 3;
      label = "Value test";
    } else if (day >= 24) {
      phaseIndex = 4;
      label = day > 30 ? "Readout due" : "Commercial test";
    }

    return {
      day,
      phaseIndex,
      label,
      progress: Math.round((clampedDay / 30) * 100),
      status: day > 30 ? `Day ${day} · final readout is due.` : `Day ${day} of 30 · ${30 - day} day${30 - day === 1 ? "" : "s"} remaining.`,
    };
  }

  function renderPeople() {
    elements.peopleGrid.replaceChildren();
    state.participants.forEach((participant, index) => {
      const card = document.createElement("article");
      card.className = "person-card";
      card.dataset.participantIndex = String(index);
      card.innerHTML = `
        <div class="person-head">
          <span class="person-number">${String(index + 1).padStart(2, "0")}</span>
          <div class="person-identity">
            <strong data-person-name-label>Open participant slot</strong>
            <small data-person-workflow-label>Define one recurring workflow</small>
          </div>
          <select class="status-select" data-field="status" aria-label="Participant ${index + 1} status">
            <option>Recruiting</option>
            <option>Confirmed</option>
            <option>Active</option>
            <option>Complete</option>
          </select>
        </div>
        <div class="person-fields">
          <label>Name<input type="text" data-field="name" maxlength="60" placeholder="Participant name"></label>
          <label>Role<input type="text" data-field="role" maxlength="80" placeholder="Example: Product designer"></label>
          <label class="field-wide">Recurring workflow<input type="text" data-field="workflow" maxlength="140" placeholder="Example: Turn call transcripts into client summaries"></label>
          <label class="field-wide">Source<input type="text" data-field="source" maxlength="80" placeholder="Example: LinkedIn · outside close network"></label>
        </div>
        <div class="gate-checks" aria-label="Participant ${index + 1} outcome gates">
          <label class="gate-check"><input type="checkbox" data-gate="activated"><span>Activated</span></label>
          <label class="gate-check"><input type="checkbox" data-gate="retentionW2"><span>Week 2</span></label>
          <label class="gate-check"><input type="checkbox" data-gate="retentionW4"><span>Week 4</span></label>
          <label class="gate-check"><input type="checkbox" data-gate="value"><span>Value proof</span></label>
          <label class="gate-check"><input type="checkbox" data-gate="caseStudy"><span>Case approved</span></label>
          <label class="gate-check"><input type="checkbox" data-gate="commercial"><span>Would pay</span></label>
        </div>
      `;
      elements.peopleGrid.append(card);
    });
    renderPeopleValues();
  }

  function renderPeopleValues() {
    [...elements.peopleGrid.querySelectorAll(".person-card")].forEach((card, index) => {
      const participant = state.participants[index];
      card.querySelectorAll("[data-field]").forEach((field) => {
        field.value = participant[field.dataset.field] || "";
      });
      card.querySelectorAll("[data-gate]").forEach((input) => {
        input.checked = Boolean(participant.gates[input.dataset.gate]);
      });
      card.querySelector("[data-person-name-label]").textContent = participant.name || "Open participant slot";
      card.querySelector("[data-person-workflow-label]").textContent = participant.workflow || "Define one recurring workflow";
    });
  }

  function handleParticipantInput(event) {
    const card = event.target.closest("[data-participant-index]");
    if (!card) return;
    const participant = state.participants[Number(card.dataset.participantIndex)];
    if (event.target.matches("[data-field]")) {
      participant[event.target.dataset.field] = event.target.value;
    } else if (event.target.matches("[data-gate]")) {
      participant.gates[event.target.dataset.gate] = event.target.checked;
    } else {
      return;
    }
    persist(event.type === "change");
    card.querySelector("[data-person-name-label]").textContent = participant.name || "Open participant slot";
    card.querySelector("[data-person-workflow-label]").textContent = participant.workflow || "Define one recurring workflow";
    renderCohortSlots();
    renderMetrics();
    renderEvidenceSelect();
    renderDecision();
    renderTodayAction();
  }

  function renderCohortSlots() {
    elements.cohortSlots.replaceChildren();
    state.participants.forEach((participant, index) => {
      const slot = document.createElement("div");
      slot.className = "cohort-slot";
      const statusClass = participant.status.toLowerCase();
      const name = participant.name || "Open slot";
      const workflow = participant.workflow || "Workflow not defined";
      slot.innerHTML = `
        <div class="cohort-slot-top">
          <span class="slot-number">P${String(index + 1).padStart(2, "0")}</span>
          <span class="slot-status status-${statusClass}" aria-label="${participant.status}"></span>
        </div>
      `;
      const identity = document.createElement("div");
      const strong = document.createElement("strong");
      strong.textContent = name;
      const small = document.createElement("small");
      small.textContent = workflow;
      identity.append(strong, small);
      slot.append(identity);
      elements.cohortSlots.append(slot);
    });
  }

  function getCounts() {
    const confirmed = state.participants.filter((person) => person.status !== "Recruiting").length;
    const activated = state.participants.filter((person) => person.gates.activated).length;
    const retained = state.participants.filter((person) => person.gates.retentionW2 && person.gates.retentionW4).length;
    const value = state.participants.filter((person) => person.gates.value).length;
    const caseStudies = state.participants.filter((person) => person.gates.caseStudy).length;
    const commercial = state.participants.filter((person) => person.gates.commercial).length;
    return { confirmed, activated, retained, value, caseStudies, commercial };
  }

  function renderMetrics() {
    const counts = getCounts();
    document.querySelector("#metric-confirmed").textContent = counts.confirmed;
    document.querySelector("#metric-activation").textContent = counts.activated;
    document.querySelector("#metric-retention").textContent = counts.retained;
    document.querySelector("#metric-value").textContent = counts.value;
    document.querySelector("#nav-people-count").textContent = `${counts.confirmed}/5`;
    document.querySelector("#nav-evidence-count").textContent = String(state.evidence.length);

    const preflightComplete = Object.values(state.preflight).filter(Boolean).length;
    const gateChecks = state.participants.reduce((total, person) => {
      return total + Object.values(person.gates).filter(Boolean).length;
    }, 0);
    const readiness = Math.round(((preflightComplete + counts.confirmed + gateChecks) / 40) * 100);
    const bounded = Math.min(100, readiness);
    const ring = document.querySelector("#sidebar-progress");
    ring.querySelector(".mini-ring-value").setAttribute("stroke-dashoffset", String(100 - bounded));
    document.querySelector("#sidebar-progress-value").textContent = `${bounded}%`;
    document.querySelector("#sidebar-progress-copy").textContent =
      bounded === 100 ? "Readout is fully documented." :
      counts.confirmed < 5 ? `${5 - counts.confirmed} cohort slot${5 - counts.confirmed === 1 ? "" : "s"} open.` :
      "Cohort set. Keep logging proof.";
  }

  function renderEvidenceSelect() {
    const previous = elements.evidenceParticipant.value;
    elements.evidenceParticipant.replaceChildren();
    state.participants.forEach((participant, index) => {
      const option = document.createElement("option");
      option.value = participant.id;
      option.textContent = participant.name || `Participant ${index + 1}`;
      elements.evidenceParticipant.append(option);
    });
    if ([...elements.evidenceParticipant.options].some((option) => option.value === previous)) {
      elements.evidenceParticipant.value = previous;
    }
  }

  function addEvidence(event) {
    event.preventDefault();
    const note = elements.evidenceNote.value.trim();
    if (!note) {
      elements.evidenceNote.focus();
      return;
    }
    state.evidence.unshift({
      id: globalThis.crypto?.randomUUID?.() || `evidence-${Date.now()}`,
      participantId: elements.evidenceParticipant.value,
      type: elements.evidenceType.value,
      date: elements.evidenceDate.value,
      note,
      metric: elements.evidenceMetric.value.trim(),
    });
    elements.evidenceNote.value = "";
    elements.evidenceMetric.value = "";
    persist(true);
    renderEvidence();
    renderMetrics();
    showToast("Evidence added to the local pilot record.");
  }

  function renderEvidence() {
    const filter = elements.evidenceFilter.value;
    const filtered = filter === "All" ? state.evidence : state.evidence.filter((entry) => entry.type === filter);
    elements.evidenceList.replaceChildren();

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = `
        <div>
          <svg aria-hidden="true"><use href="#icon-file"></use></svg>
          <strong>No evidence recorded yet</strong>
          <p>Add a behavior, measurable change, friction point, or commercial signal after a real use session.</p>
        </div>
      `;
      elements.evidenceList.append(empty);
      return;
    }

    filtered.forEach((entry) => {
      const participantIndex = state.participants.findIndex((person) => person.id === entry.participantId);
      const participant = state.participants[participantIndex];
      const name = participant?.name || `Participant ${participantIndex + 1}`;
      const item = document.createElement("article");
      item.className = "evidence-item";

      const kind = document.createElement("span");
      kind.className = "evidence-kind";
      kind.textContent = entry.type;

      const body = document.createElement("div");
      body.className = "evidence-body";
      const title = document.createElement("strong");
      title.textContent = `${name} · ${formatDate(entry.date)}`;
      const note = document.createElement("p");
      note.textContent = entry.note;
      body.append(title, note);
      if (entry.metric) {
        const metric = document.createElement("small");
        metric.textContent = entry.metric;
        body.append(metric);
      }

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "delete-evidence";
      deleteButton.dataset.deleteEvidence = entry.id;
      deleteButton.setAttribute("aria-label", `Delete ${entry.type} evidence for ${name}`);
      deleteButton.innerHTML = '<svg aria-hidden="true"><use href="#icon-trash"></use></svg>';
      item.append(kind, body, deleteButton);
      elements.evidenceList.append(item);
    });
  }

  function deleteEvidence(event) {
    const button = event.target.closest("[data-delete-evidence]");
    if (!button) return;
    state.evidence = state.evidence.filter((entry) => entry.id !== button.dataset.deleteEvidence);
    persist(true);
    renderEvidence();
    renderMetrics();
    showToast("Evidence removed.");
  }

  function renderDecision() {
    const counts = getCounts();
    const gates = {
      activation: counts.activated >= 4,
      retention: counts.retained >= 3,
      value: counts.value >= 3 && counts.caseStudies >= 2,
      commercial: counts.commercial >= 2 || state.credibleSponsor,
    };
    const passed = Object.values(gates).filter(Boolean).length;

    document.querySelector("#gate-activation-count").textContent = counts.activated;
    document.querySelector("#gate-retention-count").textContent = counts.retained;
    document.querySelector("#gate-value-count").textContent = counts.value;
    document.querySelector("#gate-case-count").textContent = counts.caseStudies;
    document.querySelector("#gate-commercial-count").textContent = counts.commercial;
    document.querySelector("#decision-score").textContent = passed;

    Object.entries(gates).forEach(([key, isPassed]) => {
      const card = document.querySelector(`[data-gate-card="${key}"]`);
      card.classList.toggle("is-passed", isPassed);
      const stateLabel = document.querySelector(`#gate-${key}-state`);
      stateLabel.textContent = isPassed ? "Passed" : "Open";
    });

    elements.sponsorLabel.textContent = state.credibleSponsor ? "Confirmed" : "Not yet";
    const truthPassed = state.preflight.monetization;
    const truthCard = document.querySelector(".truth-card");
    truthCard.classList.toggle("is-passed", truthPassed);
    document.querySelector("#truth-status-icon").textContent = truthPassed ? "✓" : "!";
    document.querySelector("#truth-title").textContent = truthPassed ? "Offer truth is verified" : "Offer truth is still open";
    document.querySelector("#truth-copy").textContent = truthPassed
      ? "The pilot offer matches the working product. Reverify live checkout before accepting payment."
      : "Do not buy traffic or present paid continuation until the offer matches the working checkout.";

    const timing = getPilotTiming();
    let title = "Keep measuring";
    let copy = "The pilot is in progress. Avoid interpreting early enthusiasm as repeat value.";

    if (counts.confirmed === 0) {
      title = "Prepare the experiment";
      copy = "Confirm the cohort and finish preflight before interpreting the pilot.";
    } else if (passed === 4 && truthPassed) {
      title = "Proceed to paid beta";
      copy = "All four outcome gates pass and the offer is truthful. Verify checkout, then convert the strongest users.";
    } else if (timing.day >= 30 && counts.value === 0) {
      title = "Pause acquisition";
      copy = "The cohort did not demonstrate recurring value. Fix the workflow problem before recruiting or buying traffic.";
    } else if (timing.day >= 24 && (counts.value > 0 || counts.activated >= 2)) {
      title = "Iterate before scaling";
      copy = `${passed} of 4 gates pass. Preserve the value signal, repair the weakest gate, and run one more focused cohort.`;
    }

    document.querySelector("#decision-title").textContent = title;
    document.querySelector("#decision-copy").textContent = copy;
  }

  function renderTodayAction() {
    const preflightComplete = Object.values(state.preflight).filter(Boolean).length;
    const counts = getCounts();
    const timing = getPilotTiming();
    let action = {
      number: "01",
      title: "Prepare the pilot",
      copy: "Finish the truth and privacy checks before inviting participants.",
      label: "Review preflight",
      target: "board",
    };

    if (preflightComplete === 5 && counts.confirmed < 5) {
      action = {
        number: "02",
        title: "Fill the cohort",
        copy: `Recruit ${5 - counts.confirmed} more heavy AI user${5 - counts.confirmed === 1 ? "" : "s"} around a specific recurring workflow.`,
        label: "Open people tracker",
        target: "people",
      };
    } else if (counts.confirmed >= 5 && timing.day <= 2) {
      action = {
        number: "03",
        title: "Create first reuse",
        copy: "Guide each participant through one real prompt, then have them save and reuse it within 48 hours.",
        label: "Track activation",
        target: "people",
      };
    } else if (timing.day >= 3 && timing.day <= 14) {
      action = {
        number: "04",
        title: "Stop active coaching",
        copy: "Let the product earn the next session. Record independent reuse and friction without rescuing the workflow.",
        label: "Log evidence",
        target: "evidence",
      };
    } else if (timing.day >= 15 && timing.day <= 23) {
      action = {
        number: "05",
        title: "Measure the delta",
        copy: "Repeat the original workflow and compare time, rewrites, rework, consistency, or output quality.",
        label: "Log value proof",
        target: "evidence",
      };
    } else if (timing.day >= 24) {
      action = {
        number: "06",
        title: "Force a real choice",
        copy: "Ask for stop, free-only, paid continuation, employer-paid use, or a buyer introduction. Compliments do not count.",
        label: "Open decision readout",
        target: "decision",
      };
    }

    document.querySelector("#today-action-number").textContent = action.number;
    document.querySelector("#today-action-title").textContent = action.title;
    document.querySelector("#today-action-copy").textContent = action.copy;
    document.querySelector("#today-action-button-label").textContent = action.label;
    document.querySelector("#today-action-button").dataset.targetView = action.target;
  }

  function focusTodayTarget(target) {
    window.setTimeout(() => {
      if (target === "board") {
        const firstUnchecked = elements.preflightInputs.find((input) => !input.checked);
        firstUnchecked?.focus();
      } else if (target === "people") {
        elements.peopleGrid.querySelector('input[data-field="name"]')?.focus();
      } else if (target === "evidence") {
        elements.evidenceParticipant.focus();
      } else if (target === "decision") {
        document.querySelector("#decision-title")?.focus();
      }
    }, 0);
  }

  async function copyTemplate(button) {
    const key = button.dataset.copyTemplate;
    const source = document.querySelector(`[data-template="${key}"]`);
    const text = source?.textContent.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast("Post copied to clipboard.");
      const original = button.textContent.trim();
      button.lastChild.textContent = " Copied";
      window.setTimeout(() => {
        button.lastChild.textContent = ` ${original.replace(/^Copy\s*/, "Copy ")}`;
      }, 1400);
    } catch {
      showToast("Clipboard access was unavailable. Select the post text to copy it.");
    }
  }

  function exportData() {
    const exportPayload = {
      exportedAt: new Date().toISOString(),
      product: "PromptLab heavy-user pilot",
      ...state,
    };
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `promptlab-pilot-${todayISO()}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("Pilot data exported.");
  }

  function resetData() {
    state = defaultState();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // The in-memory reset still succeeds.
    }
    elements.startDate.value = "";
    elements.evidenceFilter.value = "All";
    elements.sponsorToggle.checked = false;
    renderPeople();
    renderAll();
    activateView("board", false);
    showToast("Local pilot data reset.");
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => {
      elements.toast.classList.remove("is-visible");
    }, 2600);
  }

  function todayISO() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - offset).toISOString().slice(0, 10);
  }

  function dateAtMidnight(value) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day).getTime();
  }

  function formatDate(value) {
    if (!value) return "Date unknown";
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(year, month - 1, day));
  }
})();
