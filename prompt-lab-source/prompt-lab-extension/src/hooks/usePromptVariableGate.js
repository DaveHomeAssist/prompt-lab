import { useCallback, useRef, useState } from 'react';
import { fillTemplateVars, isGhostVar, resolveGhostVars } from '../promptUtils.js';
import {
  initialVariableValues,
  parsePromptVariables,
  readRecentVariables,
  rememberVariableValues,
  valuesForFill,
  variablePromptKey,
} from '../lib/promptVariables.js';

/**
 * Opens the fill-in form before a run or copy when the text has {{name}}
 * placeholders. Ghost variables (date, clipboard, …) are filled without a
 * question. Cancel leaves the editor and the clipboard alone.
 */
export default function usePromptVariableGate({ promptId } = {}) {
  const [request, setRequest] = useState(null);
  const requestRef = useRef(null);

  const prepare = useCallback(async (text, promptKeyOverride) => {
    const source = typeof text === 'string' ? text : '';
    const variables = parsePromptVariables(source);
    const manual = variables.filter((variable) => !isGhostVar(variable.name));
    const ghostNames = variables.filter((variable) => isGhostVar(variable.name)).map((variable) => variable.name);
    const ghostValues = ghostNames.length ? await resolveGhostVars(ghostNames) : {};
    if (manual.length === 0) {
      return { cancelled: false, text: fillTemplateVars(source, ghostValues, { applyDefaults: false }) };
    }
    const promptKey = typeof promptKeyOverride === 'string' && promptKeyOverride
      ? promptKeyOverride
      : variablePromptKey(promptId, source);
    const recent = readRecentVariables(promptKey);
    return new Promise((resolve) => {
      const next = {
        text: source,
        manual,
        ghostValues,
        promptKey,
        recent,
        values: initialVariableValues(manual, recent),
        resolve,
      };
      requestRef.current = next;
      setRequest(next);
    });
  }, [promptId]);

  const finish = (result) => {
    const current = requestRef.current;
    requestRef.current = null;
    setRequest(null);
    current?.resolve(result);
  };

  const submit = (entered) => {
    const current = requestRef.current;
    if (!current) return;
    const filled = valuesForFill(current.manual, entered);
    rememberVariableValues(current.promptKey, filled);
    finish({
      cancelled: false,
      text: fillTemplateVars(current.text, { ...current.ghostValues, ...filled }),
    });
  };

  const skip = () => {
    const current = requestRef.current;
    if (!current) return;
    finish({
      cancelled: false,
      text: fillTemplateVars(current.text, current.ghostValues, { applyDefaults: false }),
    });
  };

  const cancel = () => finish({ cancelled: true, text: '' });

  const setValues = (updater) => {
    setRequest((current) => {
      if (!current) return current;
      const values = typeof updater === 'function' ? updater(current.values) : updater;
      const next = { ...current, values };
      requestRef.current = next;
      return next;
    });
  };

  return { request, prepare, submit, skip, cancel, setValues };
}
