import SwiftData
import SwiftUI
import UIKit
import UniformTypeIdentifiers

private enum WorkbenchRoute: Hashable {
    case workspace
    case editor
    case results
    case pad(UUID)
    case runs
    case run(String)
}

@MainActor
struct WorkbenchRootView: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.modelContext) private var modelContext
    @State private var store: WorkbenchStore
    @State private var compactPath: [WorkbenchRoute] = []
    @State private var regularRoute: WorkbenchRoute = .editor
    private let runRecordedDemo: Bool

    @MainActor
    init(
        provider: any ProviderClient = AnthropicProviderClient(),
        runRecordedDemo: Bool = false
    ) {
        _store = State(initialValue: WorkbenchStore(provider: provider))
        self.runRecordedDemo = runRecordedDemo
    }

    var body: some View {
        Group {
            if usesCompactLayout {
                compactWorkbench
            } else {
                regularWorkbench
            }
        }
        .sheet(isPresented: $store.isSettingsPresented) {
            SettingsSheet()
        }
        .task {
            guard runRecordedDemo, store.draft.isEmpty else { return }
            store.draft = "Analyze this product feature idea and recommend the smallest useful version."
            store.startEnhance(modelContext: modelContext)
        }
        .onChange(of: store.state) { _, state in
            guard state == .completed else { return }
            if usesCompactLayout {
                compactPath = [.results]
            } else {
                regularRoute = .results
            }
        }
    }

    private var usesCompactLayout: Bool {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-forceCompactLayout") { return true }
        #endif
        return horizontalSizeClass == .compact
    }

    private var compactWorkbench: some View {
        NavigationStack(path: $compactPath) {
            EditorView(store: store) {
                compactPath = [.workspace]
            }
            .navigationDestination(for: WorkbenchRoute.self) { route in
                compactDestination(route)
            }
        }
    }

    private var regularWorkbench: some View {
        NavigationSplitView(columnVisibility: $store.columnVisibility) {
            SidebarView(store: store, onOpen: open)
                .navigationSplitViewColumnWidth(min: 230, ideal: 280, max: 340)
        } content: {
            regularContent
                .navigationSplitViewColumnWidth(min: 360, ideal: 460, max: 620)
        } detail: {
            regularDetail
        }
        .navigationSplitViewStyle(.balanced)
    }

    @ViewBuilder
    private func compactDestination(_ route: WorkbenchRoute) -> some View {
        switch route {
        case .workspace:
            SidebarView(store: store, onOpen: open)
        case .editor:
            EditorView(store: store) { compactPath = [.workspace] }
        case .results:
            ResultsView(store: store, onUse: useResult)
        case let .pad(id):
            PadEditorView(padID: id, onDelete: { compactPath = [] })
        case .runs:
            RunHistoryView(onOpen: open)
        case let .run(id):
            RunDetailView(runID: id, onReuse: reuseRun, onUseOutput: useResult)
        }
    }

    @ViewBuilder
    private var regularContent: some View {
        switch regularRoute {
        case let .pad(id):
            PadEditorView(padID: id, onDelete: { regularRoute = .editor })
        case .runs, .run:
            RunHistoryView(onOpen: open)
        default:
            EditorView(store: store)
        }
    }

    @ViewBuilder
    private var regularDetail: some View {
        switch regularRoute {
        case let .run(id):
            RunDetailView(runID: id, onReuse: reuseRun, onUseOutput: useResult)
        default:
            ResultsView(store: store, onUse: useResult)
        }
    }

    private func open(_ route: WorkbenchRoute) {
        if usesCompactLayout {
            compactPath = route == .editor ? [] : [route]
        } else {
            regularRoute = route
        }
    }

    private func useResult(_ text: String) {
        store.useResult(text)
        open(.editor)
    }

    private func reuseRun(_ run: RunRecord) {
        store.loadRun(run)
        open(.editor)
    }
}

@MainActor
private struct SidebarView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \PromptEntry.sourceIndex) private var prompts: [PromptEntry]
    @Query(sort: \Pad.updatedAt, order: .reverse) private var pads: [Pad]
    @Query(sort: \RunRecord.createdAt, order: .reverse) private var runs: [RunRecord]
    let store: WorkbenchStore
    let onOpen: (WorkbenchRoute) -> Void

    @State private var isImporting = false
    @State private var isConfirmingImport = false
    @State private var importPreview: LibraryImportPreview?
    @State private var isExporting = false
    @State private var exportDocument: LibraryJSONDocument?
    @State private var notice: LibraryNotice?
    @State private var renamePrompt: PromptEntry?
    @State private var renameText = ""
    @State private var deletePrompt: PromptEntry?
    @State private var deletePad: Pad?

    var body: some View {
        List {
            Section {
                Button {
                    store.startNewPrompt()
                    onOpen(.editor)
                } label: {
                    Label("New Prompt", systemImage: "square.and.pencil")
                        .fontWeight(.semibold)
                        .frame(minHeight: 44, alignment: .leading)
                }
                .accessibilityIdentifier("newPromptButton")
            }

            Section("Library") {
                if prompts.isEmpty {
                    Label("No saved prompts", systemImage: "books.vertical")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(prompts) { prompt in
                        Button {
                            store.loadPrompt(prompt)
                            onOpen(.editor)
                        } label: {
                            Label(prompt.title, systemImage: "text.book.closed")
                                .lineLimit(2)
                                .frame(minHeight: 44, alignment: .leading)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("libraryPrompt_\(prompt.id)")
                        .swipeActions {
                            Button("Delete", role: .destructive) { deletePrompt = prompt }
                            Button("Rename") { beginRename(prompt) }
                                .tint(.blue)
                        }
                        .contextMenu {
                            Button("Rename", systemImage: "pencil") { beginRename(prompt) }
                            Button("Delete", systemImage: "trash", role: .destructive) { deletePrompt = prompt }
                        }
                    }
                }
            }

            Section {
                if pads.isEmpty {
                    Label("No scratchpads", systemImage: "note.text")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(pads) { pad in
                        Button {
                            onOpen(.pad(pad.id))
                        } label: {
                            Label(pad.title, systemImage: "note.text")
                                .lineLimit(2)
                                .frame(minHeight: 44, alignment: .leading)
                        }
                        .buttonStyle(.plain)
                        .swipeActions {
                            Button("Delete", role: .destructive) { deletePad = pad }
                        }
                    }
                }
            } header: {
                HStack {
                    Text("Pads")
                    Spacer()
                    Button {
                        let pad = Pad(title: "New Pad")
                        modelContext.insert(pad)
                        try? modelContext.save()
                        onOpen(.pad(pad.id))
                    } label: {
                        Image(systemName: "plus.circle.fill")
                            .frame(width: 44, height: 44)
                    }
                    .accessibilityLabel("New scratchpad")
                    .accessibilityIdentifier("newPadButton")
                }
            }

            Section("Runs") {
                if runs.isEmpty {
                    Label("No runs yet", systemImage: "clock.arrow.circlepath")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(runs.prefix(8)) { run in
                        RunRow(run: run) { onOpen(.run(run.id)) }
                    }
                    Button("View All Runs") { onOpen(.runs) }
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("viewAllRunsButton")
                }
            }
        }
        .navigationTitle("Workspace")
        .toolbar {
            ToolbarItemGroup(placement: .bottomBar) {
                Button {
                    isImporting = true
                } label: {
                    Label("Import Library", systemImage: "square.and.arrow.down")
                }
                .accessibilityLabel("Import Prompt Lab library JSON")
                .accessibilityIdentifier("importLibraryButton")

                Button {
                    do {
                        exportDocument = LibraryJSONDocument(data: try LibraryInterchange.exportData(from: modelContext))
                        isExporting = true
                    } catch {
                        notice = LibraryNotice(message: error.localizedDescription)
                    }
                } label: {
                    Label("Export Library", systemImage: "square.and.arrow.up")
                }
                .accessibilityLabel("Export Prompt Lab library JSON")
            }
        }
        .fileImporter(isPresented: $isImporting, allowedContentTypes: [.json]) { result in
            do {
                let url = try result.get()
                let accessed = url.startAccessingSecurityScopedResource()
                defer { if accessed { url.stopAccessingSecurityScopedResource() } }
                importPreview = try LibraryInterchange.previewData(Data(contentsOf: url))
                isConfirmingImport = true
            } catch {
                notice = LibraryNotice(message: error.localizedDescription)
            }
        }
        .confirmationDialog(
            "Replace current library?",
            isPresented: $isConfirmingImport,
            titleVisibility: .visible
        ) {
            Button("Replace Library", role: .destructive) { confirmImport() }
            Button("Cancel", role: .cancel) { importPreview = nil }
        } message: {
            if let summary = importPreview?.summary {
                Text("The selected file contains \(summary.promptCount) prompts and \(summary.collectionCount) collections. Importing replaces saved prompts only after you confirm.")
            }
        }
        .fileExporter(
            isPresented: $isExporting,
            document: exportDocument,
            contentType: .json,
            defaultFilename: "prompt-library-ios.json"
        ) { result in
            if case let .failure(error) = result {
                notice = LibraryNotice(message: error.localizedDescription)
            }
        }
        .alert("Rename Prompt", isPresented: Binding(
            get: { renamePrompt != nil },
            set: { if !$0 { renamePrompt = nil } }
        )) {
            TextField("Prompt title", text: $renameText)
            Button("Cancel", role: .cancel) { renamePrompt = nil }
            Button("Rename") { confirmRename() }
                .disabled(renameText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        } message: {
            Text("Use a short title that will be easy to recognize in the library.")
        }
        .confirmationDialog(
            "Delete saved prompt?",
            isPresented: Binding(get: { deletePrompt != nil }, set: { if !$0 { deletePrompt = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) { confirmDeletePrompt() }
            Button("Cancel", role: .cancel) { deletePrompt = nil }
        } message: {
            Text("This removes the prompt from the local library.")
        }
        .confirmationDialog(
            "Delete scratchpad?",
            isPresented: Binding(get: { deletePad != nil }, set: { if !$0 { deletePad = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) { confirmDeletePad() }
            Button("Cancel", role: .cancel) { deletePad = nil }
        }
        .alert(item: $notice) { notice in
            Alert(title: Text("Library"), message: Text(notice.message), dismissButton: .default(Text("OK")))
        }
    }

    private func beginRename(_ prompt: PromptEntry) {
        renameText = prompt.title
        renamePrompt = prompt
    }

    private func confirmRename() {
        guard let prompt = renamePrompt else { return }
        prompt.title = renameText.trimmingCharacters(in: .whitespacesAndNewlines)
        prompt.updatedAt = .now
        prompt.isDirty = true
        try? modelContext.save()
        if store.currentPromptID == prompt.id { store.currentPromptTitle = prompt.title }
        renamePrompt = nil
    }

    private func confirmDeletePrompt() {
        guard let prompt = deletePrompt else { return }
        if store.currentPromptID == prompt.id { store.startNewPrompt() }
        modelContext.delete(prompt)
        try? modelContext.save()
        deletePrompt = nil
    }

    private func confirmDeletePad() {
        guard let pad = deletePad else { return }
        modelContext.delete(pad)
        try? modelContext.save()
        deletePad = nil
    }

    private func confirmImport() {
        guard let importPreview else { return }
        do {
            let summary = try LibraryInterchange.importPreview(importPreview, into: modelContext)
            store.startNewPrompt()
            notice = LibraryNotice(
                message: "Imported \(summary.promptCount) prompt\(summary.promptCount == 1 ? "" : "s") and preserved \(summary.collectionCount) collection\(summary.collectionCount == 1 ? "" : "s")."
            )
        } catch {
            notice = LibraryNotice(message: error.localizedDescription)
        }
        self.importPreview = nil
    }
}

private struct LibraryNotice: Identifiable {
    let id = UUID()
    let message: String
}

@MainActor
private struct EditorView: View {
    @Environment(\.modelContext) private var modelContext
    @Bindable var store: WorkbenchStore
    var showWorkspace: (() -> Void)?
    @State private var saveMessage = ""
    @State private var saveFailed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let showWorkspace {
                Button(action: showWorkspace) {
                    Label("Workspace", systemImage: "sidebar.left")
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(.primary)
                .accessibilityIdentifier("workspaceButton")
            }

            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Editor")
                        .font(.title2.bold())
                    if store.currentPromptID != nil {
                        Text(store.currentPromptTitle)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                Spacer()
                Button {
                    savePrompt()
                } label: {
                    Label("Save", systemImage: "tray.and.arrow.down")
                        .padding(.horizontal, 10)
                        .frame(minWidth: 48, minHeight: 48)
                        .contentShape(Rectangle())
                        .foregroundStyle(.primary)
                }
                .buttonStyle(.plain)
                .contentShape(Rectangle())
                .keyboardShortcut("s", modifiers: .command)
                .accessibilityIdentifier("savePromptButton")

                Button {
                    store.isSettingsPresented = true
                } label: {
                    Image(systemName: "key")
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                        .foregroundStyle(.primary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Anthropic API settings")
                .accessibilityIdentifier("apiSettingsButton")
            }

            Picker("Enhance mode", selection: $store.selectedMode) {
                ForEach(EnhanceMode.allCases) { mode in
                    Text(mode.label).tag(mode)
                }
            }
            .pickerStyle(.menu)
            .tint(.primary)
            .accessibilityIdentifier("enhanceModePicker")

            TextEditor(text: $store.draft)
                .font(.body.monospaced())
                .padding(10)
                .scrollContentBackground(.hidden)
                .background(.background.secondary, in: RoundedRectangle(cornerRadius: 14))
                .overlay {
                    if store.draft.isEmpty {
                        ContentUnavailableView(
                            "Start a prompt",
                            systemImage: "square.and.pencil",
                            description: Text("Write or paste a prompt here.")
                        )
                        .allowsHitTesting(false)
                    }
                }
                .frame(minHeight: 260)
                .accessibilityLabel("Prompt editor")
                .accessibilityIdentifier("promptEditor")

            statusMessage

            ViewThatFits(in: .horizontal) {
                HStack { actionButtons }
                VStack(alignment: .leading) { actionButtons }
            }
        }
        .padding()
        .navigationTitle("Editor")
    }

    @ViewBuilder
    private var statusMessage: some View {
        if !saveMessage.isEmpty {
            Label(saveMessage, systemImage: saveFailed ? "exclamationmark.triangle" : "checkmark.circle")
                .font(.callout)
                .foregroundStyle(saveFailed ? .red : .green)
                .accessibilityIdentifier("saveNotice")
        }
        if case .noAPIKey = store.state {
            Label("Add an Anthropic API key to enhance.", systemImage: "key.slash")
                .font(.callout)
                .foregroundStyle(.orange)
        }
        if case let .failed(message) = store.state {
            Label(message, systemImage: "exclamationmark.triangle")
                .font(.callout)
                .foregroundStyle(.red)
        }
        if case .canceled = store.state {
            Label("Enhance canceled. The partial attempt is available in Runs.", systemImage: "xmark.circle")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        if store.isEnhancing {
            ProgressView("Streaming from Anthropic…")
                .accessibilityIdentifier("enhanceProgress")
        }
    }

    @ViewBuilder
    private var actionButtons: some View {
        if store.isEnhancing {
            Button("Cancel", role: .cancel) {
                store.cancelEnhance()
            }
            .buttonStyle(.bordered)
            .keyboardShortcut(.cancelAction)
            .frame(minHeight: 44)
            .accessibilityIdentifier("cancelEnhanceButton")
        }
        Button {
            saveMessage = ""
            store.startEnhance(modelContext: modelContext)
        } label: {
            Label(enhanceButtonTitle, systemImage: "sparkles")
        }
        .buttonStyle(HighContrastProminentButtonStyle())
        .disabled(!store.canEnhance)
        .keyboardShortcut(.return, modifiers: .command)
        .accessibilityIdentifier("enhanceButton")
    }

    private var enhanceButtonTitle: String {
        if store.isEnhancing { return "Enhancing…" }
        switch store.state {
        case .failed, .canceled:
            return "Retry"
        default:
            return "Enhance"
        }
    }

    private func savePrompt() {
        do {
            let prompt = try store.saveCurrentPrompt(modelContext: modelContext)
            saveFailed = false
            saveMessage = "Saved \(prompt.title)."
        } catch {
            saveFailed = true
            saveMessage = error.localizedDescription
        }
    }
}

private struct HighContrastProminentButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(.white)
            .padding(.horizontal, 18)
            .frame(minHeight: 48)
            .background(
                isEnabled
                    ? Color(red: 0, green: 0.32, blue: 0.64)
                    : Color(red: 0.24, green: 0.24, blue: 0.26),
                in: Capsule()
            )
            .contentShape(Capsule())
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
    }
}

@MainActor
private struct ResultsView: View {
    @Environment(\.modelContext) private var modelContext
    @Bindable var store: WorkbenchStore
    let onUse: (String) -> Void
    @State private var notice = ""
    @AccessibilityFocusState private var firstResultFocused: Bool

    var body: some View {
        Group {
            if let result = store.result {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        Text("Results")
                            .font(.largeTitle.bold())
                            .accessibilityFocused($firstResultFocused)
                        ResultCard(
                            title: "Enhanced",
                            text: result.enhanced,
                            onUse: { onUse(result.enhanced) },
                            onCopy: { copy(result.enhanced) },
                            onSave: { save(result.enhanced) }
                        )
                        ForEach(result.variants, id: \.self) { variant in
                            ResultCard(
                                title: variant.label,
                                text: variant.content,
                                onUse: { onUse(variant.content) },
                                onCopy: { copy(variant.content) },
                                onSave: { save(variant.content) }
                            )
                        }
                        InformationCard(title: "Notes", text: result.notes)
                        if !result.assumptions.isEmpty {
                            InformationCard(
                                title: "Assumptions",
                                text: result.assumptions.map { "• \($0)" }.joined(separator: "\n")
                            )
                        }
                        if !result.tags.isEmpty {
                            FlowLayout(spacing: 8) {
                                ForEach(result.tags, id: \.self) { tag in
                                    Text(tag)
                                        .font(.caption.weight(.semibold))
                                        .padding(.horizontal, 10)
                                        .padding(.vertical, 6)
                                        .background(.tint.opacity(0.12), in: Capsule())
                                }
                            }
                            .accessibilityElement(children: .combine)
                            .accessibilityLabel("Tags: \(result.tags.joined(separator: ", "))")
                        }
                        if !notice.isEmpty {
                            Label(notice, systemImage: "checkmark.circle.fill")
                                .font(.callout)
                                .foregroundStyle(.green)
                                .accessibilityIdentifier("resultNotice")
                        }
                    }
                    .frame(maxWidth: 760, alignment: .leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
                }
                .task { firstResultFocused = true }
            } else if store.isEnhancing {
                VStack(spacing: 16) {
                    ProgressView("Streaming from Anthropic…")
                    if !store.streamedText.isEmpty {
                        ScrollView {
                            Text(store.streamedText)
                                .font(.caption.monospaced())
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
                .padding()
            } else {
                ContentUnavailableView(
                    "No result yet",
                    systemImage: "sparkles",
                    description: Text("Enhanced prompts will appear here.")
                )
            }
        }
        .navigationTitle("Results")
    }

    private func copy(_ text: String) {
        UIPasteboard.general.string = text
        notice = "Copied to the clipboard."
    }

    private func save(_ text: String) {
        do {
            let entry = try store.saveResult(text, modelContext: modelContext)
            notice = "Saved \(entry.title) to Library."
        } catch {
            notice = error.localizedDescription
        }
    }
}

private struct ResultCard: View {
    let title: String
    let text: String
    let onUse: () -> Void
    let onCopy: () -> Void
    let onSave: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(title)
                .font(.title3.bold())
            Text(text)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
            Divider()
            FlowLayout(spacing: 8) {
                Button("Use", systemImage: "arrow.turn.down.left", action: onUse)
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("useResultButton_\(title)")
                Button("Copy", systemImage: "doc.on.doc", action: onCopy)
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("copyResultButton_\(title)")
                Button("Save", systemImage: "bookmark", action: onSave)
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("saveResultButton_\(title)")
                ShareLink(item: text) {
                    Label("Share", systemImage: "square.and.arrow.up")
                }
                .frame(minHeight: 44)
                .accessibilityIdentifier("shareResultButton_\(title)")
            }
            .buttonStyle(.bordered)
        }
        .padding(18)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 16))
        .overlay {
            RoundedRectangle(cornerRadius: 16)
                .stroke(.separator.opacity(0.35), lineWidth: 1)
        }
    }
}

private struct InformationCard: View {
    let title: String
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.headline)
            Text(text)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(16)
        .background(.background.secondary.opacity(0.7), in: RoundedRectangle(cornerRadius: 14))
    }
}

private struct PadEditorView: View {
    @Query private var pads: [Pad]
    let onDelete: () -> Void

    init(padID: UUID, onDelete: @escaping () -> Void) {
        _pads = Query(filter: #Predicate<Pad> { $0.id == padID })
        self.onDelete = onDelete
    }

    var body: some View {
        if let pad = pads.first {
            PadDocumentView(pad: pad, onDelete: onDelete)
        } else {
            ContentUnavailableView("Pad not found", systemImage: "note.text")
                .navigationTitle("Pad")
        }
    }
}

private struct PadDocumentView: View {
    @Environment(\.modelContext) private var modelContext
    @Bindable var pad: Pad
    let onDelete: () -> Void
    @State private var isConfirmingDelete = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            TextField("Pad title", text: $pad.title)
                .font(.title2.bold())
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("padTitleField")
                .onChange(of: pad.title) { _, _ in pad.updatedAt = .now }
            TextEditor(text: $pad.content)
                .font(.body.monospaced())
                .padding(10)
                .scrollContentBackground(.hidden)
                .background(.background.secondary, in: RoundedRectangle(cornerRadius: 14))
                .accessibilityLabel("Scratchpad content")
                .accessibilityIdentifier("padEditor")
                .onChange(of: pad.content) { _, _ in pad.updatedAt = .now }
        }
        .padding()
        .navigationTitle("Pad")
        .toolbar {
            ToolbarItem(placement: .destructiveAction) {
                Button("Delete", systemImage: "trash", role: .destructive) {
                    isConfirmingDelete = true
                }
            }
        }
        .task(id: pad.updatedAt) {
            try? await Task.sleep(for: .milliseconds(350))
            try? modelContext.save()
        }
        .confirmationDialog("Delete this scratchpad?", isPresented: $isConfirmingDelete) {
            Button("Delete", role: .destructive) {
                modelContext.delete(pad)
                try? modelContext.save()
                onDelete()
            }
            Button("Cancel", role: .cancel) {}
        }
    }
}

private struct RunHistoryView: View {
    @Query(sort: \RunRecord.createdAt, order: .reverse) private var runs: [RunRecord]
    let onOpen: (WorkbenchRoute) -> Void

    var body: some View {
        List {
            if runs.isEmpty {
                ContentUnavailableView(
                    "No runs yet",
                    systemImage: "clock.arrow.circlepath",
                    description: Text("Successful, canceled, and failed attempts will appear here.")
                )
            } else {
                ForEach(runs) { run in
                    RunRow(run: run) { onOpen(.run(run.id)) }
                }
            }
        }
        .navigationTitle("Run History")
        .accessibilityIdentifier("runHistoryList")
    }
}

private struct RunRow: View {
    let run: RunRecord
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 5) {
                Text(run.promptTitle)
                    .lineLimit(2)
                    .foregroundStyle(.primary)
                HStack(spacing: 8) {
                    Text(run.enhanceMode.capitalized)
                    Text(run.createdAt, style: .relative)
                    Spacer()
                    Label(run.canonicalStatus.capitalized, systemImage: statusIcon)
                        .foregroundStyle(statusColor)
                }
                .font(.caption)
            }
            .frame(minHeight: 44)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("runRow_\(run.id)")
    }

    private var statusIcon: String {
        switch run.canonicalStatus {
        case "success": "checkmark.circle.fill"
        case "canceled": "xmark.circle"
        default: "exclamationmark.triangle.fill"
        }
    }

    private var statusColor: Color {
        switch run.canonicalStatus {
        case "success": .green
        case "canceled": .secondary
        default: .red
        }
    }
}

private struct RunDetailView: View {
    @Query private var runs: [RunRecord]
    let onReuse: (RunRecord) -> Void
    let onUseOutput: (String) -> Void

    init(
        runID: String,
        onReuse: @escaping (RunRecord) -> Void,
        onUseOutput: @escaping (String) -> Void
    ) {
        _runs = Query(filter: #Predicate<RunRecord> { $0.id == runID })
        self.onReuse = onReuse
        self.onUseOutput = onUseOutput
    }

    var body: some View {
        if let run = runs.first {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(run.promptTitle)
                            .font(.title2.bold())
                        Text("\(run.provider) · \(run.model) · \(run.enhanceMode.capitalized)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(run.createdAt, format: .dateTime.month().day().year().hour().minute())
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    FlowLayout(spacing: 8) {
                        Button("Reuse Input", systemImage: "arrow.uturn.backward") { onReuse(run) }
                            .buttonStyle(.borderedProminent)
                            .frame(minHeight: 44)
                        if !run.output.isEmpty {
                            Button("Use Output", systemImage: "arrow.turn.down.left") {
                                onUseOutput(run.output)
                            }
                            .buttonStyle(.bordered)
                            .frame(minHeight: 44)
                            .accessibilityIdentifier("useRunOutputButton")
                            ShareLink(item: run.output) {
                                Label("Share Output", systemImage: "square.and.arrow.up")
                            }
                            .buttonStyle(.bordered)
                            .frame(minHeight: 44)
                        }
                    }
                    InformationCard(title: "Input", text: run.input)
                    if !run.output.isEmpty {
                        InformationCard(title: run.canonicalStatus == "success" ? "Output" : "Partial Output", text: run.output)
                    }
                    if let response = run.response {
                        ForEach(response.variants, id: \.self) { variant in
                            InformationCard(title: variant.label, text: variant.content)
                        }
                        if !response.assumptions.isEmpty {
                            InformationCard(
                                title: "Assumptions",
                                text: response.assumptions.map { "• \($0)" }.joined(separator: "\n")
                            )
                        }
                        if !response.tags.isEmpty {
                            InformationCard(title: "Tags", text: response.tags.joined(separator: ", "))
                        }
                    }
                    if !run.notes.isEmpty {
                        InformationCard(title: "Notes", text: run.notes)
                    }
                }
                .frame(maxWidth: 760, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
            }
            .navigationTitle("Run Detail")
            .accessibilityIdentifier("runDetail")
        } else {
            ContentUnavailableView("Run not found", systemImage: "clock.badge.questionmark")
        }
    }
}

private struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) -> CGSize {
        layout(proposal: proposal, subviews: subviews).size
    }

    func placeSubviews(
        in bounds: CGRect,
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) {
        let result = layout(proposal: proposal, subviews: subviews)
        for (index, point) in result.points.enumerated() {
            subviews[index].place(
                at: CGPoint(x: bounds.minX + point.x, y: bounds.minY + point.y),
                proposal: .unspecified
            )
        }
    }

    private func layout(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, points: [CGPoint]) {
        let availableWidth = proposal.width ?? .infinity
        var points: [CGPoint] = []
        var cursor = CGPoint.zero
        var lineHeight: CGFloat = 0
        var usedWidth: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if cursor.x > 0, cursor.x + size.width > availableWidth {
                cursor.x = 0
                cursor.y += lineHeight + spacing
                lineHeight = 0
            }
            points.append(cursor)
            cursor.x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
            usedWidth = max(usedWidth, cursor.x - spacing)
        }
        return (CGSize(width: min(usedWidth, availableWidth), height: cursor.y + lineHeight), points)
    }
}

private struct SettingsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var apiKey = ""
    @State private var message = ""
    private let keychain = KeychainStore()

    var body: some View {
        NavigationStack {
            Form {
                Section("Anthropic") {
                    SecureField("sk-ant-…", text: $apiKey)
                        .textContentType(.password)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .accessibilityLabel("Anthropic API key")
                    Text("Stored only in this device's Keychain. It is never written to UserDefaults or logs.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if !message.isEmpty {
                    Text(message)
                        .foregroundStyle(message == "Saved securely." ? .green : .red)
                }
                Button("Delete saved key", role: .destructive) {
                    do {
                        try keychain.delete()
                        apiKey = ""
                        message = "Saved key deleted."
                    } catch {
                        message = error.localizedDescription
                    }
                }
            }
            .navigationTitle("API Settings")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                        .keyboardShortcut(.cancelAction)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        do {
                            try keychain.store(apiKey)
                            message = "Saved securely."
                        } catch {
                            message = error.localizedDescription
                        }
                    }
                    .disabled(apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .task {
            do {
                apiKey = try keychain.retrieve() ?? ""
            } catch {
                message = error.localizedDescription
            }
        }
    }
}
