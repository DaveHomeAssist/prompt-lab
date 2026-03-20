<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# output clean html doc

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="Compare API costs for Gemini, GPT-4, Claude, Llama, Mistral, DeepSeek, and Qwen models. Real-time calculator with batch & caching optimizations.">
    <title>Gemini API Cost Calculator</title>
    <style>
        :root {
            --color-bg-base: #0f172a;
            --color-bg-elevated: #1e293b;
            --color-bg-surface: #334155;
            --color-text-primary: #f1f5f9;
            --color-text-secondary: #cbd5e1;
            --color-text-muted: #94a3b8;
            --color-accent-teal: #38bdf8;
            --color-accent-purple: #a78bfa;
            --color-accent-orange: #fb923c;
            --color-border: #475569;
            --font-family-base: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: var(--font-family-base);
            background: var(--color-bg-base);
            color: var(--color-text-primary);
            padding: 2rem;
            line-height: 1.6;
        }

        .container {
            max-width: 1400px;
            margin: 0 auto;
        }

        header {
            text-align: center;
            margin-bottom: 3rem;
            padding-bottom: 2rem;
            border-bottom: 2px solid var(--color-border);
        }

        h1 {
            font-size: 2.5rem;
            margin-bottom: 0.5rem;
            background: linear-gradient(135deg, var(--color-accent-teal), var(--color-accent-purple));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .subtitle {
            color: var(--color-text-muted);
            font-size: 1.1rem;
        }

        .dashboard-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 2rem;
            margin-bottom: 2rem;
        }

        .card, section.card {
            background: var(--color-bg-elevated);
            border-radius: 12px;
            padding: 1.5rem;
            border: 1px solid var(--color-border);
            transition: transform 0.2s, box-shadow 0.2s;
        }

        .card:hover, section.card:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        }

        .card h3, section.card h3 {
            color: var(--color-accent-teal);
            margin-bottom: 1rem;
            font-size: 1.3rem;
        }

        .input-group {
            margin-bottom: 1.5rem;
        }

        label {
            display: block;
            color: var(--color-text-secondary);
            margin-bottom: 0.5rem;
            font-weight: 500;
        }

        input[type="number"],
        select {
            width: 100%;
            padding: 0.75rem;
            background: var(--color-bg-surface);
            border: 1px solid var(--color-border);
            border-radius: 8px;
            color: var(--color-text-primary);
            font-size: 1rem;
            transition: border-color 0.2s;
        }

        input[type="number"]:focus,
        select:focus {
            outline: none;
            border-color: var(--color-accent-teal);
        }

        .slider-container {
            margin-bottom: 1rem;
        }

        input[type="range"] {
            width: 100%;
            height: 6px;
            background: var(--color-bg-surface);
            border-radius: 3px;
            outline: none;
        }

        input[type="range"]::-webkit-slider-thumb {
            appearance: none;
            width: 24px;
            height: 24px;
            background: var(--color-accent-teal);
            border-radius: 50%;
            cursor: pointer;
            transition: transform 0.1s;
        }

        input[type="range"]::-webkit-slider-thumb:hover {
            transform: scale(1.1);
        }

        input[type="range"]::-moz-range-thumb {
            width: 24px;
            height: 24px;
            background: var(--color-accent-teal);
            border-radius: 50%;
            cursor: pointer;
            border: none;
        }

        .value-display {
            text-align: right;
            color: var(--color-accent-teal);
            font-weight: 600;
            font-size: 1.1rem;
        }

        .results-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 1.5rem;
            margin-top: 2rem;
        }

        .result-card {
            background: var(--color-bg-elevated);
            padding: 1.5rem;
            border-radius: 12px;
            border: 2px solid var(--color-border);
            position: relative;
            overflow: hidden;
        }

        .result-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
        }

        .result-card.teal::before { background: #14b8a6; }
        .result-card.cyan::before { background: #06b6d4; }
        .result-card.blue::before { background: #3b82f6; }
        .result-card.indigo::before { background: #6366f1; }
        .result-card.purple::before { background: #a78bfa; }
        .result-card.pink::before { background: #ec4899; }
        .result-card.orange::before { background: #fb923c; }
        .result-card.amber::before { background: #fbbf24; }
        .result-card.yellow::before { background: #facc15; }
        .result-card.lime::before { background: #84cc16; }
        .result-card.green::before { background: #22c55e; }

        .model-name {
            font-size: 1.2rem;
            font-weight: 600;
            margin-bottom: 1rem;
        }

        .cost-display {
            font-size: 2.5rem;
            font-weight: 700;
            margin: 1rem 0;
        }

        .teal .cost-display { color: #14b8a6; }
        .cyan .cost-display { color: #06b6d4; }
        .blue .cost-display { color: #3b82f6; }
        .indigo .cost-display { color: #6366f1; }
        .purple .cost-display { color: #a78bfa; }
        .pink .cost-display { color: #ec4899; }
        .orange .cost-display { color: #fb923c; }
        .amber .cost-display { color: #fbbf24; }
        .yellow .cost-display { color: #facc15; }
        .lime .cost-display { color: #84cc16; }
        .green .cost-display { color: #22c55e; }

        .cost-breakdown {
            background: var(--color-bg-surface);
            padding: 1rem;
            border-radius: 8px;
            margin-top: 1rem;
        }

        .cost-row {
            display: flex;
            justify-content: space-between;
            padding: 0.5rem 0;
            border-bottom: 1px solid var(--color-border);
        }

        .cost-row:last-child {
            border-bottom: none;
            font-weight: 600;
            padding-top: 0.75rem;
        }

        .comparison-section {
            margin-top: 3rem;
            background: var(--color-bg-elevated);
            padding: 2rem;
            border-radius: 12px;
            border: 1px solid var(--color-border);
        }

        .comparison-section h2 {
            color: var(--color-accent-teal);
            margin-bottom: 1.5rem;
        }

        .comparison-bars {
            margin-top: 2rem;
        }

        .bar-item {
            margin-bottom: 1.5rem;
        }

        .bar-label {
            display: flex;
            justify-content: space-between;
            margin-bottom: 0.5rem;
            color: var(--color-text-secondary);
        }

        .bar-container {
            height: 40px;
            background: var(--color-bg-surface);
            border-radius: 8px;
            overflow: hidden;
            position: relative;
        }

        .bar-fill {
            height: 100%;
            display: flex;
            align-items: center;
            padding: 0 1rem;
            font-weight: 600;
            transition: width 0.5s ease;
        }

        .bar-fill.teal { background: #14b8a6; }
        .bar-fill.cyan { background: #06b6d4; }
        .bar-fill.blue { background: #3b82f6; }
        .bar-fill.indigo { background: #6366f1; }
        .bar-fill.purple { background: #a78bfa; }
        .bar-fill.pink { background: #ec4899; }
        .bar-fill.orange { background: #fb923c; }
        .bar-fill.amber { background: #fbbf24; }
        .bar-fill.yellow { background: #facc15; }
        .bar-fill.lime { background: #84cc16; }
        .bar-fill.green { background: #22c55e; }

        .optimization-tips {
            background: var(--color-bg-elevated);
            padding: 2rem;
            border-radius: 12px;
            border: 1px solid var(--color-border);
            margin-top: 2rem;
        }

        .optimization-tips h3 {
            color: var(--color-accent-purple);
            margin-bottom: 1rem;
        }

        .tip-item {
            background: var(--color-bg-surface);
            padding: 1rem;
            border-radius: 8px;
            margin-bottom: 1rem;
            border-left: 4px solid var(--color-accent-teal);
        }

        .tip-title {
            font-weight: 600;
            color: var(--color-accent-teal);
            margin-bottom: 0.5rem;
        }

        .savings-badge {
            display: inline-block;
            background: var(--color-accent-teal);
            color: var(--color-bg-base);
            padding: 0.25rem 0.75rem;
            border-radius: 12px;
            font-size: 0.85rem;
            font-weight: 600;
            margin-left: 0.5rem;
        }

        /* Accessibility enhancements */
        :focus-visible {
            outline: 2px solid var(--color-accent-teal);
            outline-offset: 2px;
        }

        @media (max-width: 768px) {
            body {
                padding: 1rem;
            }

            h1 {
                font-size: 2rem;
            }

            .dashboard-grid,
            .results-grid {
                grid-template-columns: 1fr;
            }

            .cost-display {
                font-size: 2rem;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>⚡ Gemini API Cost Calculator</h1>
            ```
            <p class="subtitle">Real-time cost modeling for March 2026 pricing -  Compare models instantly</p>
            ```
        </header>
        
        <main>
            <h2>API Cost Comparison Calculator</h2>
            <div class="dashboard-grid">
                <section class="card">
                    <h3>📊 Usage Parameters</h3>
                    <div class="input-group">
                        <label for="inputTokens">Input Tokens per Request</label>
                        <input type="number" id="inputTokens" value="100" min="1" max="1000000">
                    </div>
                    <div class="input-group">
                        <label for="outputTokens">Output Tokens per Request</label>
                        <input type="number" id="outputTokens" value="800" min="1" max="1000000">
                    </div>
                    <div class="input-group">
                        <label for="requestsPerDay">Requests per Day</label>
                        <div class="slider-container">
                            <input type="range" id="requestsPerDay" min="1" max="1000" value="20"
                                   aria-label="Requests per day"
                                   aria-valuemin="1"
                                   aria-valuemax="1000"
                                   aria-valuenow="20">
                            ```
                            <div class="value-display" id="requestsDisplay">20 requests/day</div>
                            ```
                        </div>
                    </div>
                    <div class="input-group">
                        <label for="days">Number of Days</label>
                        <div class="slider-container">
                            <input type="range" id="days" min="1" max="365" value="30"
                                   aria-label="Number of days"
                                   aria-valuemin="1"
                                   aria-valuemax="365"
                                   aria-valuenow="30">
                            ```
                            <div class="value-display" id="daysDisplay">30 days</div>
                            ```
                        </div>
                    </div>
                </section>

                <section class="card">
                    <h3>🤖 Model Selection</h3>
                    <div style="max-height: 400px; overflow-y: auto; padding-right: 0.5rem;">
                        <fieldset>
                            <legend>Gemini 3.x (Latest)</legend>
                            <label style="display: flex; align-items: center; margin-bottom: 0.5rem; cursor: pointer;">
                                <input type="checkbox" name="model" value="gemini31Pro" style="margin-right: 0.5rem;">
                                <span>Gemini 3.1 Pro Preview ($2/$12)</span>
                            </label>
                            <label style="display: flex; align-items: center; margin-bottom: 0.5rem; cursor: pointer;">
                                <input type="checkbox" name="model" value="gemini3Flash" style="margin-right: 0.5rem;">
                                <span>Gemini 3 Flash Preview ($0.50/$3)</span>
                            </label>
                            <label style="display: flex; align-items: center; margin-bottom: 0.5rem; cursor: pointer;">
                                <input type="checkbox" name="model" value="gemini31FlashLite" checked style="margin-right: 0.5rem;">
                                ```
                                <span>Gemini 3.1 Flash-Lite Preview ($0.25/$1.50)</span>
                                ```
                            </label>
                        </fieldset>
                        
                        <fieldset>
                            <legend>Gemini 2.5 (Production)</legend>
                            <label style="display: flex; align-items: center; margin-bottom: 0.5rem; cursor: pointer;">
                                <input type="checkbox" name="model" value="gemini25Pro" style="margin-right: 0.5rem;">
                                <span>Gemini 2.5 Pro ($1.25/$10)</span>
                            </label>
                            <label style="display: flex; align-items: center; margin-bottom: 0.5rem; cursor: pointer;">
                                <input type="checkbox" name="model" value="gemini25Flash" checked style="margin-right: 0.5rem;">
                                <span>Gemini 2.5 Flash ($0.30/$2.50)</span>
                            </label>
                            <label style="display: flex; align-items: center; margin-bottom: 0.5rem; cursor: pointer;">
                                <input type="checkbox" name="model" value="gemini25FlashLite" checked style="margin-right: 0.5rem;">
                                ```
                                <span>Gemini 2.5 Flash-Lite ($0.10/$0.40)</span>
                                ```
                            </label>
                        </fieldset>
                        
                        <fieldset>
                            <legend>Gemini 2.0 (Legacy)</legend>
                            <label style="display: flex; align-items: center; margin-bottom: 0.5rem; cursor: pointer;">
                                <input type="checkbox" name="model" value="gemini20Flash" style="margin-right: 0.5rem;">
                                <span>Gemini 2.0 Flash ($0.10/$0.40)</span>
                            </label>
                            <label style="display: flex; align-items: center; margin-bottom: 0.5rem; cursor: pointer;">
                                <input type="checkbox" name="model" value="gemini20FlashLite" style="margin-right: 0.5rem;">
                                ```
                                <span>Gemini 2.0 Flash-Lite ($0.075/$0.30)</span>
                                ```
                            </label>
                        </fieldset>
                        
                        <fieldset>
                            <legend>Gemini 1.5 (Legacy)</legend>
                            <label style="display: flex; align-items: center; margin-bottom: 0.5rem; cursor: pointer;">
                                <input type="checkbox" name="model" value="gemini15Pro" style="margin-right: 0.5rem;">
                                <span>Gemini 1.5 Pro ($3.50/$10.50)</span>
                            </label>
                            <label style="display: flex; align-items: center; margin-bottom: 0.5rem; cursor: pointer;">
                                <input type="checkbox" name="model" value="gemini15Flash" style="margin-right: 0.5rem;">
                                <span>Gemini 1.5 Flash ($0.075/$0.30)</span>
                            </label>
                        </fieldset>
                        
                        <fieldset>
                            <legend>Competitors</legend>
                            <label style="display: flex; align-items: center; margin-bottom: 0.5rem; cursor: pointer;">
                                <input type="checkbox" name="model" value="claudeSonnet" checked style="margin-right: 0.5rem;">
                                <span>Claude Sonnet 4.6 ($3/$15)</span>
                            </label>
                        </fieldset>
                    </div>
                </section>
                
                <section class="card">
                    <h3>⚙️ Optimization Settings</h3>
                    <div class="input-group">
                        <label for="batchMode">Batch API Mode</label>
                        <select id="batchMode">
                            ```
                            <option value="false">Standard (real-time)</option>
                            ```
                            <option value="true">Batch (50% discount)</option>
                        </select>
                    </div>
                    <div class="input-group">
                        <label for="caching">Context Caching</label>
                        <select id="caching">
                            <option value="false">Disabled</option>
                            <option value="true">Enabled (90% input discount)</option>
                        </select>
                    </div>
                    <div class="input-group">
                        <label for="cacheDuration">Cache Duration (hours)</label>
                        <input type="number" id="cacheDuration" value="1" min="0" max="24" disabled>
                    </div>
                </section>
            </div>

            ```
            <div class="results-grid" id="resultsGrid"></div>
            ```

            <div class="comparison-section">
                <h2>📈 Cost Comparison Visualization</h2>
                ```
                <p style="color: var(--color-text-secondary); margin-bottom: 1rem;">Relative cost per request compared to baseline</p>
                ```
                ```
                <div class="comparison-bars" id="comparisonBars"></div>
                ```
            </div>

            <div class="optimization-tips">
                <h3>💡 Cost Optimization Strategies</h3>
                <div class="tip-item">
                    ```
                    <div class="tip-title">🚀 Batch API <span class="savings-badge">50% OFF</span></div>
                    ```
                    ```
                    <p>Submit non-urgent requests via Batch API for automatic 50% discount. Perfect for overnight processing, bulk content generation, and scheduled tasks with 24-hour SLA.</p>
                    ```
                </div>
                <div class="tip-item">
                    ```
                    <div class="tip-title">💾 Context Caching <span class="savings-badge">90% OFF</span></div>
                    ```
                    ```
                    <p>Cache repeated system prompts, examples, or documents. Break-even at just 4 reuses per hour. Ideal for chatbots with fixed instructions or document Q&amp;A systems.</p>
                    ```
                </div>
                <div class="tip-item">
                    ```
                    <div class="tip-title">⚡ Model Selection <span class="savings-badge">UP TO 97% OFF</span></div>
                    ```
                    ```
                    <p>Flash-Lite costs $0.10/$0.40 per 1M tokens vs Claude Sonnet's $3/$15. For repetitive enhancement tasks, Flash-Lite delivers 30-40× savings with minimal quality trade-off.</p>
                    ```
                </div>
                <div class="tip-item">
                    ```
                    <div class="tip-title">🎯 Free Tier Strategy</div>
                    ```
                    ```
                    <p>Gemini free tier: 5-15 RPM, 100-1,500 RPD depending on model. Personal projects under 20 requests/day stay completely free. Upgrade to Tier 1 ($0 setup) for 150-2,000 RPM.</p>
                    ```
                </div>
            </div>
        </main>
    </div>

    <script>
        // Pricing data (per 1M tokens, USD) - March 2026
        const pricing = {
            // Gemini 3.x Series (Latest - Preview)
            gemini31Pro: {
                name: 'Gemini 3.1 Pro Preview',
                input: 2.00,
                output: 12.00,
                cacheRead: 0.20,
                cacheStore: 4.50,
                family: 'Gemini 3.x',
                context: '1M tokens'
            },
            gemini3Flash: {
                name: 'Gemini 3 Flash Preview',
                input: 0.50,
                output: 3.00,
                cacheRead: 0.05,
                cacheStore: 1.00,
                family: 'Gemini 3.x',
                context: '1M tokens'
            },
            gemini31FlashLite: {
                name: 'Gemini 3.1 Flash-Lite Preview',
                input: 0.25,
                output: 1.50,
                cacheRead: 0.025,
                cacheStore: 1.00,
                family: 'Gemini 3.x',
                context: '1M tokens'
            },
            
            // Gemini 2.5 Series (Current Production)
            gemini25Pro: {
                name: 'Gemini 2.5 Pro',
                input: 1.25,
                output: 10.00,
                cacheRead: 0.125,
                cacheStore: 4.50,
                family: 'Gemini 2.5',
                context: '1M tokens'
            },
            gemini25Flash: {
                name: 'Gemini 2.5 Flash',
                input: 0.30,
                output: 2.50,
                cacheRead: 0.03,
                cacheStore: 1.00,
                family: 'Gemini 2.5',
                context: '1M tokens'
            },
            gemini25FlashLite: {
                name: 'Gemini 2.5 Flash-Lite',
                input: 0.10,
                output: 0.40,
                cacheRead: 0.01,
                cacheStore: 1.00,
                family: 'Gemini 2.5',
                context: '1M tokens'
            },
            
            // Gemini 2.0 Series (Legacy - Lower Cost)
            gemini20Flash: {
                name: 'Gemini 2.0 Flash',
                input: 0.10,
                output: 0.40,
                cacheRead: 0.025,
                cacheStore: 1.00,
                family: 'Gemini 2.0',
                context: '1M tokens'
            },
            gemini20FlashLite: {
                name: 'Gemini 2.0 Flash-Lite',
                input: 0.075,
                output: 0.30,
                cacheRead: 0.019,
                cacheStore: null,
                family: 'Gemini 2.0',
                context: '1M tokens'
            },
            
            // Gemini 1.5 Series (Legacy)
            gemini15Pro: {
                name: 'Gemini 1.5 Pro',
                input: 3.50,
                output: 10.50,
                cacheRead: 0.35,
                cacheStore: null,
                family: 'Gemini 1.5',
                context: '2M tokens'
            },
            gemini15Flash: {
                name: 'Gemini 1.5 Flash',
                input: 0.075,
                output: 0.30,
                cacheRead: 0.0075,
                cacheStore: null,
                family: 'Gemini 1.5',
                context: '1M tokens'
            },
            
            // Competitor: Claude
            claudeSonnet: {
                name: 'Claude Sonnet 4.6',
                input: 3.00,
                output: 15.00,
                cacheRead: 0.30,
                cacheStore: null,
                family: 'Anthropic',
                context: '1M tokens'
            }
        };

        // DOM elements
        const inputTokensEl = document.getElementById('inputTokens');
        const outputTokensEl = document.getElementById('outputTokens');
        const requestsPerDayEl = document.getElementById('requestsPerDay');
        const daysEl = document.getElementById('days');
        const batchModeEl = document.getElementById('batchMode');
        const cachingEl = document.getElementById('caching');
        const cacheDurationEl = document.getElementById('cacheDuration');
        const requestsDisplayEl = document.getElementById('requestsDisplay');
        const daysDisplayEl = document.getElementById('daysDisplay');

        // Enable/disable cache duration based on caching toggle
        cachingEl.addEventListener('change', () => {
            cacheDurationEl.disabled = cachingEl.value === 'false';
        });

        // Update slider displays and ARIA values
        requestsPerDayEl.addEventListener('input', () => {
            requestsDisplayEl.textContent = `${requestsPerDayEl.value} requests/day`;
            requestsPerDayEl.setAttribute('aria-valuenow', requestsPerDayEl.value);
            calculate();
        });

        daysEl.addEventListener('input', () => {
            daysDisplayEl.textContent = `${daysEl.value} days`;
            daysEl.setAttribute('aria-valuenow', daysEl.value);
            calculate();
        });

        // Recalculate on any input change
        [inputTokensEl, outputTokensEl, batchModeEl, cachingEl, cacheDurationEl].forEach(el => {
            el.addEventListener('input', calculate);
        });
        
        // Color mapping for models
        function getColorClass(modelKey) {
            const colorMap = {
                gemini31Pro: 'purple',
                gemini3Flash: 'teal',
                gemini31FlashLite: 'cyan',
                gemini25Pro: 'indigo',
                gemini25Flash: 'blue',
                gemini25FlashLite: 'teal',
                gemini20Flash: 'green',
                gemini20FlashLite: 'lime',
                gemini15Pro: 'amber',
                gemini15Flash: 'yellow',
                claudeSonnet: 'orange'
            };
            return colorMap[modelKey] || 'teal';
        }

        function calculateCost(model, params) {
            const { inputTokens, outputTokens, totalRequests, batchMode, caching, cacheDuration } = params;
            
            let inputCost = (inputTokens / 1000000) * model.input;
            let outputCost = (outputTokens / 1000000) * model.output;
            
            // Apply caching discount to input
            if (caching) {
                inputCost = (inputTokens / 1000000) * model.cacheRead;
            }
            
            let perRequestCost = inputCost + outputCost;
            
            // Apply batch discount
            if (batchMode) {
                perRequestCost *= 0.5;
            }
            
            let totalCost = perRequestCost * totalRequests;
            
            // Add cache storage cost if caching enabled
            let storageCost = 0;
            if (caching && model.cacheStore) {
                storageCost = (inputTokens / 1000000) * model.cacheStore * cacheDuration;
            }
            
            return {
                perRequestCost,
                totalCost: totalCost + storageCost,
                storageCost,
                inputCost,
                outputCost
            };
        }

        function formatCost(cost) {
            if (cost < 0.01) {
                return `$${cost.toFixed(6)}`;
            } else if (cost < 1) {
                return `$${cost.toFixed(4)}`;
            } else {
                return `$${cost.toFixed(2)}`;
            }
        }

        function calculate() {
            const inputTokens = parseInt(inputTokensEl.value) || 100;
            const outputTokens = parseInt(outputTokensEl.value) || 800;
            const requestsPerDay = parseInt(requestsPerDayEl.value) || 20;
            const days = parseInt(daysEl.value) || 30;
            const batchMode = batchModeEl.value === 'true';
            const caching = cachingEl.value === 'true';
            const cacheDuration = parseInt(cacheDurationEl.value) || 1;
            
            const totalRequests = requestsPerDay * days;
            
            const params = {
                inputTokens,
                outputTokens,
                totalRequests,
                batchMode,
                caching,
                cacheDuration
            };
            
            // Calculate costs for selected models only
            const selectedModels = document.querySelectorAll('input[name="model"]:checked');
            const costs = {};
            
            selectedModels.forEach(checkbox => {
                const modelKey = checkbox.value;
                costs[modelKey] = calculateCost(pricing[modelKey], params);
            });
            
            // Update results cards
            let resultsHTML = '';
            
            Object.keys(costs).forEach(modelKey => {
                const model = pricing[modelKey];
                const cost = costs[modelKey];
                const colorClass = getColorClass(modelKey);
                
                resultsHTML += `
                <div class="result-card ${colorClass}">
                    <div class="model-name">
                        ${model.name}
                        ```
                        <span style="font-size: 0.8rem; opacity: 0.7; font-weight: 400;"> · ${model.family}</span>
                        ```
                    </div>
                    ```
                    <div class="cost-display">${formatCost(cost.totalCost)}</div>
                    ```
                    <div style="color: var(--color-text-muted); margin-bottom: 1rem;">
                        ${formatCost(cost.perRequestCost)} per request · ${model.context}
                    </div>
                    <div class="cost-breakdown">
                        <div class="cost-row">
                            <span>Input tokens</span>
                            <span>${formatCost(cost.inputCost * totalRequests)}</span>
                        </div>
                        <div class="cost-row">
                            <span>Output tokens</span>
                            <span>${formatCost(cost.outputCost * totalRequests)}</span>
                        </div>
                        ${cost.storageCost > 0 ? `
                        <div class="cost-row">
                            <span>Cache storage</span>
                            <span>${formatCost(cost.storageCost)}</span>
                        </div>
                        ` : ''}
                        <div class="cost-row">
                            <span>Total Cost</span>
                            <span>${formatCost(cost.totalCost)}</span>
                        </div>
                    </div>
                </div>
                `;
            });
            
            document.getElementById('resultsGrid').innerHTML = resultsHTML || '<p style="color: var(--color-text-muted); text-align: center; padding: 2rem;">Select at least one model to compare costs.</p>';
            
            // Update comparison bars
            if (Object.keys(costs).length === 0) {
                ```
                document.getElementById('comparisonBars').innerHTML = '<p style="color: var(--color-text-muted); text-align: center;">Select models to see comparison.</p>';
                ```
                return;
            }
            
            const costArray = Object.keys(costs).map(key => ({
                key,
                name: pricing[key].name,
                cost: costs[key].perRequestCost,
                colorClass: getColorClass(key)
            }));
            
            costArray.sort((a, b) => a.cost - b.cost);
            const minCost = costArray.cost;
            const maxCost = costArray[costArray.length - 1].cost;
            
            let comparisonHTML = '';
            
            costArray.forEach(item => {
                const widthPercent = (item.cost / maxCost) * 100;
                const multiplier = (item.cost / minCost).toFixed(1);
                
                comparisonHTML += `
                <div class="bar-item">
                    <div class="bar-label">
                        <span>${item.name}</span>
                        <span>${formatCost(item.cost)} (${multiplier}×)</span>
                    </div>
                    <div class="bar-container">
                        <div class="bar-fill ${item.colorClass}" style="width: ${widthPercent}%">
                            ${formatCost(item.cost)}
                        </div>
                    </div>
                </div>
                `;
            });
            
            document.getElementById('comparisonBars').innerHTML = comparisonHTML;
        }

        // Add event listeners for model checkboxes
        document.querySelectorAll('input[name="model"]').forEach(checkbox => {
            checkbox.addEventListener('change', calculate);
        });
        
        // Initial calculation
        calculate();
    </script>
</body>
</html>
