import useGenerationOptions from './hooks/useGenerationOptions.js';
import { STRATEGIES, TASKS, TARGETS, OUTPUT_BUDGETS, resolveGenerationOptions } from './lib/generationOptions.js';

export default function GenerationControls({ m, mode, onModeChange, onTransform, disabled = false }) {
  const { options, update, error } = useGenerationOptions();
  const effective = resolveGenerationOptions(mode, options);
  const selectClass = `ui-control ${m.input} border rounded-lg px-2 py-1.5 text-xs ${m.text} min-w-0 w-full`;
  return (
    <div className="w-full min-w-0 space-y-2" aria-label="Generation settings">
      <div className="flex flex-wrap items-end gap-2">
        <label className={`min-w-0 flex-1 text-xs ${m.textSub}`}>Task type
          <select aria-label="Task type" className={selectClass} value={effective.task} disabled={disabled} onChange={event => update({ task: event.target.value })}>
            {TASKS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label className={`min-w-0 flex-1 text-xs ${m.textSub}`}>Intended destination
          <select aria-label="Intended destination" className={selectClass} value={effective.target} disabled={disabled} onChange={event => update({ target: event.target.value })}>
            {TARGETS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
      </div>
      <details className={`text-xs ${m.textSub}`}>
        <summary className="cursor-pointer py-1">Generation options · {STRATEGIES.find(item => item.id === effective.strategy)?.label || effective.strategy}</summary>
        <fieldset disabled={disabled} className="mt-2 flex min-w-0 flex-wrap gap-3 rounded-lg border p-2">
          <label className="min-w-0 flex-1">Preferred primary candidate
            <select aria-label="Preferred primary candidate" className={selectClass} value={STRATEGIES.some(item => item.id === effective.strategy) ? effective.strategy : options.strategy}
              onChange={event => { update({ strategy: event.target.value }); onModeChange(event.target.value); }}>
              {STRATEGIES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="min-w-0 flex-1">Requested output budget
            <select aria-label="Generation output budget" className={selectClass} value={options.budget} onChange={event => update({ budget: event.target.value })}>
              <option value="auto">Automatic</option>
              {OUTPUT_BUDGETS.map(limit => <option key={limit} value={limit}>{limit.toLocaleString()} tokens</option>)}
            </select>
          </label>
          <label className="flex w-full items-center gap-2">
            <input type="checkbox" checked={options.alternatives} onChange={event => update({ alternatives: event.target.checked })} />Generate alternatives (three candidates total)
          </label>
          <p className="w-full">The destination does not change your enhancement provider. Budgets cover the whole response; hosted and provider limits may be lower. Answer length stays as requested in your prompt.</p>
          <div className="flex flex-wrap gap-2" aria-label="Optional transformations">
            <button type="button" className={`ui-control rounded-lg px-3 py-1.5 ${m.btn}`} onClick={() => onTransform('shorten')}>Shorten source</button>
            <button type="button" className={`ui-control rounded-lg px-3 py-1.5 ${m.btn}`} onClick={() => onTransform('json')}>Format source as JSON</button>
          </div>
        </fieldset>
      </details>
      {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
