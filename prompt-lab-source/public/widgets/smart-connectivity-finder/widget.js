const WIDGET_NAME = "smart_connectivity_finder";
const STEPS = [
  {
    number: 1,
    key: "industry",
    title: "Select Your Operational Sector",
    subtitle:
      "This filters our component catalog to isolate certifications and design footprints specific to your regulatory environment.",
    options: [
      {
        id: "automation",
        title: "⚡ Factory Automation & Robotics",
        description:
          "Heavy manufacturing, CNC machines, multi-axis robotic arms, and assembly line controllers requiring toolless modular swap speeds."
      },
      {
        id: "datacenters",
        title: "📊 Data Centers & Infrastructure",
        description:
          "High-density server environments, network switches, and critical cloud routing frames requiring maximum throughput with minimal PCB footprint."
      },
      {
        id: "transportation",
        title: "🚊 Transportation, Rail & Mobility",
        description:
          "High-vibration rolling stock, electric vehicle drivetrains, and outdoor infrastructure built to withstand severe weather and strict flame retrofits."
      }
    ]
  },
  {
    number: 2,
    key: "bottleneck",
    title: "Isolate Your Critical Performance Objective",
    subtitle:
      "Tell us where your current connection systems or legacy components fail during real-world stress tests.",
    options: [
      {
        id: "downtime",
        title: "Unscheduled Downtime & Complicated Maintenance",
        description:
          "Machinery troubleshooting takes too long because technicians must manually rewire hardwired junctions during unexpected line stops."
      },
      {
        id: "spatial",
        title: "Spatial Constraints & High-Density Demands",
        description:
          "Traditional rectangular housings take up too much premium interior real estate on the machine chassis or printed circuit board."
      },
      {
        id: "contamination",
        title: "Harsh Ambient Elements & Contamination Risk",
        description:
          "Dust, water spray, extreme temperatures, or intensive washdown chemicals damage signal integrity and corrode exposed metal pins."
      }
    ]
  },
  {
    number: 3,
    key: "environment",
    title: "Assess the Physical Working Environment",
    subtitle:
      "This sets the required structural protection standards, raw materials, and locking latch specifications.",
    options: [
      {
        id: "vibration_harsh",
        title: "Severe Mechanical Shock & Vibration",
        description:
          "Components are mounted to moving gantries, rail carriages, or vibrating motors that slowly back out traditional push-on connections."
      },
      {
        id: "outdoor_liquids",
        title: "Direct Outdoor Exposure / Washdown Zones",
        description:
          "Junction points require absolute fluid and dust barriers matching IP65, IP67, or NEMA 4X ingress classifications."
      },
      {
        id: "controlled",
        title: "Controlled Climate / Internal Control Cabinet",
        description:
          "Standard indoor layout where space optimization and organized wire management are the primary design priorities."
      }
    ]
  },
  {
    number: 4,
    key: "media",
    title: "Map Your Required Interface Media",
    subtitle:
      "Select the inputs and lines that need to pass securely through a single consolidated connection junction.",
    options: [
      {
        id: "power",
        title: "High-Amp Power Delivery Only",
        description:
          "Safe, high-voltage bulk electricity termination to drive heavy motors, heaters, or primary main distribution panels."
      },
      {
        id: "data_signal",
        title: "Shielded Data & High-Speed Signals",
        description:
          "Industrial Ethernet, Cat6A, fiber optics, or low-voltage sensor commands requiring immunity from surrounding electromagnetic interference (EMI)."
      },
      {
        id: "hybrid",
        title: "Hybrid Configuration (Power, Signal, & Data Combined)",
        description:
          "A custom mix combining power lines, signal cables, and pneumatic fluid lines inside a single integrated modular housing block."
      }
    ]
  }
];

const MEDIA_NOTES = {
  power: "Power only routing selected. Confirm ampacity, conductor gauge, and thermal rise before release.",
  data_signal: "Shielded data selected. Confirm pin density, impedance, bend radius, and EMI exposure.",
  hybrid: "Hybrid media selected. Validate segregation, insert modules, and service clearance with engineering."
};

export const initialWidgetState = {
  currentStep: 1,
  selections: {
    industry: null,
    bottleneck: null,
    environment: null,
    media: null
  },
  resolvedRecommendation: null
};

export function resolveRecommendation(selections, matrix) {
  const engine = matrix?.routingEngine;
  if (!engine) {
    throw new Error("Missing routing engine configuration.");
  }

  const matchedRule = engine.rules.find((rule) =>
    Object.entries(rule.conditions).every(([key, expectedValue]) => selections[key] === expectedValue)
  );

  if (matchedRule) {
    return {
      id: matchedRule.recommendationId,
      isFallback: false,
      output: matchedRule.output
    };
  }

  return {
    id: engine.fallbackDestination,
    isFallback: true,
    output: engine.fallbackOutput
  };
}

export function buildLeadPayload(state) {
  const recommendation = state.resolvedRecommendation;
  const output = recommendation?.output || {};

  return {
    ...state.selections,
    recommendation_id: recommendation?.id || "",
    recommendation_type: recommendation?.isFallback ? "engineering_review" : "matched_bundle",
    recommendation_headline: output.headline || "",
    sku_bundle: Array.isArray(output.sku_bundle) ? output.sku_bundle.join(",") : ""
  };
}

function emitAnalytics(eventName, payload) {
  if (typeof window === "undefined") return;
  if (typeof window.gtag === "function") {
    window.gtag("event", eventName, payload);
  }
  window.dispatchEvent(new CustomEvent(`smart-connectivity:${eventName}`, { detail: payload }));
}

function optionLabel(step, optionId) {
  return step.options.find((option) => option.id === optionId)?.title || optionId || "Not selected";
}

function createOptionButton({ step, option, selectedId, onSelect }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "scf-option";
  button.dataset.optionId = option.id;
  button.setAttribute("aria-pressed", String(selectedId === option.id));
  button.innerHTML = `
    <span class="scf-option-title">${option.title}</span>
    <span class="scf-option-copy">${option.description}</span>
  `;
  button.addEventListener("click", () => onSelect(step.key, option.id));
  return button;
}

function createStepPane({ step, state, onSelect }) {
  const pane = document.createElement("section");
  pane.className = "scf-pane";
  pane.setAttribute("aria-labelledby", `scf-step-${step.number}-title`);
  pane.innerHTML = `
    <div class="scf-step-copy">
      <p class="scf-kicker">Assessment input ${step.number}</p>
      <h2 id="scf-step-${step.number}-title">${step.title}</h2>
      <p>${step.subtitle}</p>
    </div>
    <div class="scf-options" role="group" aria-label="${step.title}"></div>
  `;
  const options = pane.querySelector(".scf-options");
  step.options.forEach((option) => {
    options.appendChild(
      createOptionButton({
        step,
        option,
        selectedId: state.selections[step.key],
        onSelect
      })
    );
  });
  return pane;
}

function createResultPane({ state, onSubmit, onDownload }) {
  const recommendation = state.resolvedRecommendation;
  const output = recommendation?.output || {};
  const leadPayload = buildLeadPayload(state);
  const pane = document.createElement("section");
  pane.className = "scf-pane scf-result";
  pane.setAttribute("aria-labelledby", "scf-result-title");
  pane.innerHTML = `
    <div class="scf-result-header">
      <p class="scf-kicker">${recommendation?.isFallback ? "Engineering review" : "Matched BOM"}</p>
      <h2 id="scf-result-title">${output.headline || "Recommendation unavailable"}</h2>
      <p>${output.description || "No recommendation text is available."}</p>
    </div>
    <div class="scf-result-grid">
      <section class="scf-bom-panel" aria-labelledby="scf-bom-title">
        <h3 id="scf-bom-title">Bill of Materials</h3>
        <ul class="scf-sku-list"></ul>
        <p class="scf-media-note">${MEDIA_NOTES[state.selections.media] || "Media selection captured for engineering review."}</p>
      </section>
      <form class="scf-lead-form" action="/api/smart-connectivity-leads" method="post" aria-labelledby="scf-lead-title">
        <h3 id="scf-lead-title">Procurement Handoff</h3>
        <label>
          <span>Work email</span>
          <input type="email" name="email" autocomplete="email" required>
        </label>
        <label>
          <span>Company</span>
          <input type="text" name="company" autocomplete="organization" required>
        </label>
        <div class="scf-form-row">
          <label>
            <span>Quantity</span>
            <input type="number" name="quantity" min="1" step="1" inputmode="numeric">
          </label>
          <label>
            <span>Timeline</span>
            <select name="timeline">
              <option value="prototype">Prototype</option>
              <option value="30_days">30 days</option>
              <option value="90_days">90 days</option>
              <option value="planning">Planning</option>
            </select>
          </label>
        </div>
        <input type="hidden" name="industry" value="${leadPayload.industry || ""}">
        <input type="hidden" name="bottleneck" value="${leadPayload.bottleneck || ""}">
        <input type="hidden" name="environment" value="${leadPayload.environment || ""}">
        <input type="hidden" name="media" value="${leadPayload.media || ""}">
        <input type="hidden" name="recommendation_id" value="${leadPayload.recommendation_id}">
        <input type="hidden" name="recommendation_type" value="${leadPayload.recommendation_type}">
        <input type="hidden" name="sku_bundle" value="${leadPayload.sku_bundle}">
        <button class="scf-primary" type="submit">${output.primary_cta_text || "Request BOM"}</button>
        <button class="scf-secondary" type="button" data-download-summary>${output.secondary_cta_text || "Download Summary"}</button>
        <p class="scf-form-status" role="status" aria-live="polite"></p>
      </form>
    </div>
    <dl class="scf-selection-summary"></dl>
  `;

  const skuList = pane.querySelector(".scf-sku-list");
  (output.sku_bundle || []).forEach((sku) => {
    const item = document.createElement("li");
    item.textContent = sku;
    skuList.appendChild(item);
  });

  const summary = pane.querySelector(".scf-selection-summary");
  STEPS.forEach((step) => {
    const term = document.createElement("dt");
    term.textContent = step.title;
    const detail = document.createElement("dd");
    detail.textContent = optionLabel(step, state.selections[step.key]);
    summary.append(term, detail);
  });

  pane.querySelector(".scf-lead-form").addEventListener("submit", onSubmit);
  pane.querySelector("[data-download-summary]").addEventListener("click", onDownload);
  return pane;
}

function downloadSummary(state) {
  const payload = buildLeadPayload(state);
  const summary = JSON.stringify(
    {
      widget: WIDGET_NAME,
      generatedAt: new Date().toISOString(),
      selections: state.selections,
      recommendation: payload
    },
    null,
    2
  );
  const blob = new Blob([summary], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `smart-connectivity-bom-${payload.recommendation_id || "review"}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function submitLead(event, state) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = form.querySelector(".scf-form-status");
  const formData = new FormData(form);
  const payload = {
    widget_name: WIDGET_NAME,
    ...Object.fromEntries(formData.entries())
  };

  status.textContent = "Preparing CRM handoff...";
  emitAnalytics("widget_lead_submit", {
    widget_name: WIDGET_NAME,
    resolved_id: state.resolvedRecommendation?.id || "",
    recommendation_type: payload.recommendation_type
  });

  window.dispatchEvent(new CustomEvent("smart-connectivity:lead-payload", { detail: payload }));

  const endpoint = window.smartConnectivityLeadEndpoint || form.getAttribute("action");
  if (!endpoint) {
    status.textContent = "CRM endpoint is not configured. Payload is ready in the browser event.";
    return;
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Lead endpoint returned ${response.status}`);
    }
    form.reset();
    status.textContent = "BOM request sent. Engineering will validate fit before quoting.";
  } catch (error) {
    status.textContent =
      "CRM endpoint did not accept the request. Hidden fields are populated and the payload event was emitted for handoff.";
  } finally {
    window.clearTimeout(timeout);
  }
}

export function initSmartConnectivityFinder({ root, matrix }) {
  if (!root) {
    throw new Error("Smart Connectivity Finder root element not found.");
  }

  let state = structuredClone(initialWidgetState);

  root.innerHTML = `
    <article class="scf-widget" aria-labelledby="scf-title">
      <header class="scf-shell-header">
        <div>
          <p class="scf-eyebrow">Smart Connectivity Finder</p>
          <h1 id="scf-title">Engineer a compatible connector BOM</h1>
        </div>
        <span class="scf-version">Matrix ${matrix.routingEngine.version}</span>
      </header>
      <div class="scf-progress" aria-label="Assessment progress">
        <span class="scf-step-count">Step 1 of 4</span>
        <div class="scf-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="25" aria-label="Assessment completion">
          <span class="scf-progress-fill"></span>
        </div>
      </div>
      <div class="scf-viewport">
        <div class="scf-track"></div>
      </div>
      <footer class="scf-footer">
        <button class="scf-back" type="button" hidden>Back</button>
        <button class="scf-continue" type="button" disabled>Continue</button>
      </footer>
      <p class="scf-live" role="status" aria-live="polite"></p>
    </article>
  `;

  const track = root.querySelector(".scf-track");
  const stepCount = root.querySelector(".scf-step-count");
  const progressBar = root.querySelector(".scf-progress-track");
  const progressFill = root.querySelector(".scf-progress-fill");
  const backButton = root.querySelector(".scf-back");
  const continueButton = root.querySelector(".scf-continue");
  const liveRegion = root.querySelector(".scf-live");

  function render() {
    track.replaceChildren(
      ...STEPS.map((step) =>
        createStepPane({
          step,
          state,
          onSelect: (key, value) => {
            state = {
              ...state,
              selections: { ...state.selections, [key]: value }
            };
            liveRegion.textContent = `${optionLabel(step, value)} selected.`;
            render();
          }
        })
      ),
      state.resolvedRecommendation
        ? createResultPane({
            state,
            onSubmit: (event) => submitLead(event, state),
            onDownload: () => downloadSummary(state)
          })
        : document.createElement("section")
    );

    const currentStep = STEPS[state.currentStep - 1];
    const selected = state.selections[currentStep.key];
    const isResult = Boolean(state.resolvedRecommendation);
    const viewIndex = isResult ? STEPS.length : state.currentStep - 1;
    const progress = isResult ? 100 : Math.round((state.currentStep / STEPS.length) * 100);

    track.style.transform = `translateX(-${viewIndex * 100}%)`;
    stepCount.textContent = isResult ? "Recommendation ready" : `Step ${state.currentStep} of ${STEPS.length}`;
    progressBar.setAttribute("aria-valuenow", String(progress));
    progressFill.style.width = `${progress}%`;
    backButton.hidden = state.currentStep === 1 && !isResult;
    continueButton.hidden = isResult;
    continueButton.disabled = !selected;
    continueButton.textContent = state.currentStep === STEPS.length ? "Generate BOM" : "Continue";
  }

  backButton.addEventListener("click", () => {
    if (state.resolvedRecommendation) {
      state = { ...state, resolvedRecommendation: null, currentStep: STEPS.length };
    } else {
      state = { ...state, currentStep: Math.max(1, state.currentStep - 1) };
    }
    liveRegion.textContent = `Returned to step ${state.currentStep}.`;
    render();
  });

  continueButton.addEventListener("click", () => {
    const currentStep = STEPS[state.currentStep - 1];
    const currentSelection = state.selections[currentStep.key];
    if (!currentSelection) return;

    emitAnalytics("widget_step_complete", {
      widget_name: WIDGET_NAME,
      step_completed: state.currentStep,
      selection_value: currentSelection
    });

    if (state.currentStep === STEPS.length) {
      const resolvedRecommendation = resolveRecommendation(state.selections, matrix);
      state = { ...state, resolvedRecommendation };
      emitAnalytics("widget_recommendation_generated", {
        widget_name: WIDGET_NAME,
        resolved_id: resolvedRecommendation.id
      });
      liveRegion.textContent = `${resolvedRecommendation.output.headline} recommendation generated.`;
    } else {
      state = { ...state, currentStep: state.currentStep + 1 };
      liveRegion.textContent = `Step ${state.currentStep} complete.`;
    }
    render();
  });

  render();
}

async function boot() {
  const root = document.querySelector("[data-smart-connectivity-finder]");
  if (!root) return;

  try {
    const response = await fetch(new URL("./logicMatrix.json", import.meta.url), { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Matrix request failed with ${response.status}`);
    }
    const matrix = await response.json();
    initSmartConnectivityFinder({ root, matrix });
  } catch (error) {
    root.innerHTML = `
      <div class="scf-widget scf-error" role="alert">
        <p class="scf-eyebrow">Smart Connectivity Finder</p>
        <h1>Routing matrix unavailable</h1>
        <p>The widget could not load its technical routing data. Check the matrix path and try again.</p>
      </div>
    `;
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
}
