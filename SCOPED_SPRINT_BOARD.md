# Prompt Lab Scoped Sprint Board

Branch:
`feature/promptlab-ui-notebook-handoff-20260320`

Scope baseline:
- Use the rebased [implementation_plan.txt](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/implementation_plan.txt) as the source of truth.
- Do not include public web PWA work in this sprint.
- Do not merge unrelated research artifacts or throwaway files into the branch.

## Sprint 1
Goal:
Make the current editor flow easier to read, annotate, and use without changing the product model.

Items:
1. Notes affordance from the main editor
   Files:
   - [App.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/App.jsx)
   - [ResultPane.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/ResultPane.jsx)
   - [ModalLayer.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/ModalLayer.jsx)
   - [useEditorState.js](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/hooks/useEditorState.js)
   Tests:
   - [usePersistenceFlow.test.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/tests/usePersistenceFlow.test.jsx)
   - [useExecutionFlow.test.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/tests/useExecutionFlow.test.jsx)

2. Font size / zoom controls
   Files:
   - [useUiState.js](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/hooks/useUiState.js)
   - [index.css](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/index.css)
   - [App.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/App.jsx)
   - [ResultPane.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/ResultPane.jsx)
   Tests:
   - add `useUiState` coverage if missing
   - smoke-test editor/result rendering locally

3. Copy button on code blocks in output
   Files:
   - [ResultPane.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/ResultPane.jsx)
   - [MarkdownPreview.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/MarkdownPreview.jsx)
   Tests:
   - add component test for rendered code block copy behavior
   - re-run [LibraryPanel.test.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/tests/LibraryPanel.test.jsx) if preview rendering changes

4. Runs / Compare labeling polish
   Files:
   - [RunTimelinePanel.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/RunTimelinePanel.jsx)
   - [ABTestTab.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/ABTestTab.jsx)
   - [App.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/App.jsx)
   Tests:
   - [useABTest.test.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/__tests__/useABTest.test.jsx)
   - [useEvalRuns.test.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/__tests__/useEvalRuns.test.jsx)

Definition of done:
- Notes are discoverable from the main editor
- Font controls persist
- Code blocks can be copied directly
- Runs / Compare labels are clearer without changing the underlying model

## Sprint 2
Goal:
Make the core authoring workspace feel like a real desktop tool.

Items:
1. Split editor workspace in the primary compose flow
   Files:
   - [App.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/App.jsx)
   - [useUiState.js](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/hooks/useUiState.js)
   - [index.css](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/index.css)
   - [ResultPane.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/ResultPane.jsx)
   Tests:
   - add or update layout-focused component tests
   - smoke test narrow and wide viewports

2. Language / stack selector with persistence
   Files:
   - [useEditorState.js](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/hooks/useEditorState.js)
   - [promptLint.js](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/promptLint.js)
   - [usePromptLibrary.js](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/hooks/usePromptLibrary.js)
   - [promptSchema.js](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/lib/promptSchema.js)
   - [App.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/App.jsx)
   Tests:
   - [usePersistenceFlow.test.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/tests/usePersistenceFlow.test.jsx)
   - [usePersistenceFlow.share.test.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/tests/usePersistenceFlow.share.test.jsx)
   - [LibraryPanel.test.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/tests/LibraryPanel.test.jsx)
   - [useTestCases.test.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/__tests__/useTestCases.test.jsx)

3. Library sidebar mode
   Files:
   - [LibraryPanel.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/LibraryPanel.jsx)
   - [App.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/App.jsx)
   - [useUiState.js](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/hooks/useUiState.js)
   - [index.css](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/index.css)
   Tests:
   - [LibraryPanel.test.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/tests/LibraryPanel.test.jsx)
   - add viewport behavior coverage if new state is introduced

Definition of done:
- Main compose view supports split workspace
- Language metadata survives saves, loads, and tests
- Library is persistently reachable on desktop widths

## Sprint 3
Goal:
Add product-defining quality improvements after the core workspace is stable.

Items:
1. Focus / Zen Mode
2. Smart folders / semantic auto-tagging
3. Ghosting diff polish
4. Audio feedback for linting

Gate:
- Only start after Sprint 2 lands cleanly
- No packaging or release work folded into this sprint

## Release Sprint
Goal:
Ship safely without dragging unrelated branch debris into `main`.

Items:
1. Desktop binary release validation
2. Main-branch release pass

Release gate:
- branch diff reviewed
- tests/build path documented
- docs contradictions resolved
- unrelated artifacts excluded
