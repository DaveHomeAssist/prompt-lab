import useABTest from './useABTest.js';

/**
 * Experiments controller.
 * Today this wraps the A/B + experiment-history surface without changing behavior.
 * It exists so App.jsx no longer needs to know the concrete hook name.
 */
export default function useExperiments({ notify }) {
  return useABTest({ notify });
}
