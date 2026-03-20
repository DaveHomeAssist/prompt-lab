# Prompt Lab Commit-Ready Checklist

Branch:
`feature/promptlab-ui-notebook-handoff-20260320`

Use this checklist to turn the rebased plan into commit-sized changesets with exact file scope and verification.

## Commit 1
Name:
`feat(prompt-lab): improve notes access and output code copy`

Scope:
- Make notes reachable from the main editor flow
- Add copy affordance to rendered code blocks
- Keep the change inside the compose/result flow only

Files:
- [App.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/App.jsx)
- [ResultPane.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/ResultPane.jsx)
- [ModalLayer.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/ModalLayer.jsx)
- [MarkdownPreview.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/MarkdownPreview.jsx)
- [useEditorState.js](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/hooks/useEditorState.js)
- add or update tests as needed

Tests:
- [usePersistenceFlow.test.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/tests/usePersistenceFlow.test.jsx)
- [useExecutionFlow.test.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/tests/useExecutionFlow.test.jsx)
- add a new component test for code-block copy behavior if none exists

Manual verification:
- notes entry point is visible from the main editor
- notes content still persists
- rendered code blocks copy cleanly in enhanced/output views

## Commit 2
Name:
`feat(prompt-lab): add editor and result font controls`

Scope:
- Add persisted font-size controls
- Apply to editor and result panes only

Files:
- [useUiState.js](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/hooks/useUiState.js)
- [index.css](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/index.css)
- [App.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/App.jsx)
- [ResultPane.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/ResultPane.jsx)

Tests:
- add state coverage for persisted UI settings if absent
- re-run affected editor/result component tests

Manual verification:
- editor font size changes immediately
- result font size changes immediately
- settings persist after reload
- narrow layout remains usable

## Commit 3
Name:
`refactor(prompt-lab): clarify runs and compare labeling`

Scope:
- Tighten labels, button copy, and empty states in Runs / Compare
- Do not change experiment storage shape in the same commit

Files:
- [RunTimelinePanel.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/RunTimelinePanel.jsx)
- [ABTestTab.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/ABTestTab.jsx)
- [App.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/App.jsx)
- [index.css](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/index.css) if label styling changes

Tests:
- [useABTest.test.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/__tests__/useABTest.test.jsx)
- [useEvalRuns.test.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/__tests__/useEvalRuns.test.jsx)

Manual verification:
- Timeline vs Compare is obvious
- re-run action wording is clear
- empty states describe what to do next

## Commit 4
Name:
`feat(prompt-lab): add split workspace to main compose flow`

Scope:
- Implement split layout in the main editor
- Keep PadTab changes out of this commit unless strictly needed for shared state

Files:
- [App.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/App.jsx)
- [useUiState.js](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/hooks/useUiState.js)
- [index.css](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/index.css)
- [ResultPane.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/ResultPane.jsx)

Tests:
- add layout/state coverage if split mode introduces new persistence
- re-run component tests touching the main compose surface

Manual verification:
- main compose flow supports side-by-side work
- narrow viewports collapse correctly
- result and notes remain reachable

## Commit 5
Name:
`feat(prompt-lab): persist language metadata across editor and library`

Scope:
- Add language/stack metadata
- Persist through save, load, history, and test-case flows
- Keep linting and schema changes in the same commit so the feature is coherent

Files:
- [useEditorState.js](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/hooks/useEditorState.js)
- [promptLint.js](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/promptLint.js)
- [usePromptLibrary.js](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/hooks/usePromptLibrary.js)
- [promptSchema.js](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/lib/promptSchema.js)
- [App.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/App.jsx)
- any save/load flow hooks touched by schema updates

Tests:
- [usePersistenceFlow.test.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/tests/usePersistenceFlow.test.jsx)
- [usePersistenceFlow.share.test.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/tests/usePersistenceFlow.share.test.jsx)
- [LibraryPanel.test.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/tests/LibraryPanel.test.jsx)
- [useTestCases.test.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/__tests__/useTestCases.test.jsx)

Manual verification:
- language selection survives save/load
- language affects lint hints
- saved library entries preserve metadata
- test cases and reloaded prompts keep the chosen language

## Commit 6
Name:
`feat(prompt-lab): add persistent library sidebar`

Scope:
- Make library persistent on desktop widths
- Keep mobile as overlay behavior

Files:
- [LibraryPanel.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/LibraryPanel.jsx)
- [App.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/App.jsx)
- [useUiState.js](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/hooks/useUiState.js)
- [index.css](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/index.css)

Tests:
- [LibraryPanel.test.jsx](/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/prompt-lab-extension/src/tests/LibraryPanel.test.jsx)
- add layout-state test if sidebar persistence is added

Manual verification:
- library remains visible on desktop widths
- mobile collapses to overlay
- loading a prompt from the sidebar still works

## Pre-Merge Checks
- verify branch diff excludes unrelated untracked artifacts in repo root
- run the current extension build/test path and document any known gaps
- verify hosted web and docs text still match current product boundaries
- do not include deferred PWA work in this branch
