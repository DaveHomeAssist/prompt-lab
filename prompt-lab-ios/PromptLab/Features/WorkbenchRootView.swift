import SwiftData
import SwiftUI
import UniformTypeIdentifiers

struct WorkbenchRootView: View {
    @Environment(\.modelContext) private var modelContext
    @State private var store: WorkbenchStore
    private let runRecordedDemo: Bool

    init(
        provider: any ProviderClient = AnthropicProviderClient(),
        runRecordedDemo: Bool = false
    ) {
        _store = State(initialValue: WorkbenchStore(provider: provider))
        self.runRecordedDemo = runRecordedDemo
    }

    var body: some View {
        NavigationSplitView(columnVisibility: $store.columnVisibility) {
            SidebarView()
        } content: {
            EditorView(store: store)
        } detail: {
            ResultsView(store: store)
        }
        .navigationSplitViewStyle(.balanced)
        .sheet(isPresented: $store.isSettingsPresented) {
            SettingsSheet()
        }
        .task {
            guard runRecordedDemo, store.draft.isEmpty else { return }
            store.draft = "Analyze this product feature idea and recommend the smallest useful version."
            store.startEnhance(modelContext: modelContext)
        }
    }
}

private struct SidebarView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \PromptEntry.sourceIndex) private var prompts: [PromptEntry]
    @Query(sort: \Pad.updatedAt, order: .reverse) private var pads: [Pad]
    @Query(sort: \RunRecord.createdAt, order: .reverse) private var runs: [RunRecord]
    @State private var isImporting = false
    @State private var isExporting = false
    @State private var exportDocument: LibraryJSONDocument?
    @State private var notice: LibraryNotice?

    var body: some View {
        List {
            Section("Library") {
                if prompts.isEmpty {
                    Label("No saved prompts", systemImage: "books.vertical")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(prompts) { prompt in
                        Label(prompt.title, systemImage: "text.book.closed")
                            .lineLimit(1)
                    }
                }
            }
            Section("Pads") {
                if pads.isEmpty {
                    Label("No scratchpads", systemImage: "note.text")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(pads) { pad in
                        Label(pad.title, systemImage: "note.text")
                    }
                }
            }
            Section("Runs") {
                if runs.isEmpty {
                    Text("No runs yet")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(runs.prefix(8)) { run in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(run.promptTitle)
                                .lineLimit(1)
                            HStack {
                                Text(run.enhanceMode.capitalized)
                                Spacer()
                                Text(run.status.capitalized)
                            }
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .navigationTitle("Prompt Lab")
        .toolbar {
            ToolbarItemGroup(placement: .bottomBar) {
                Button {
                    isImporting = true
                } label: {
                    Label("Import Library", systemImage: "square.and.arrow.down")
                }
                .accessibilityLabel("Import Prompt Lab library JSON")

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
                let summary = try LibraryInterchange.importData(Data(contentsOf: url), into: modelContext)
                notice = LibraryNotice(
                    message: "Imported \(summary.promptCount) prompt\(summary.promptCount == 1 ? "" : "s") and preserved \(summary.collectionCount) collection\(summary.collectionCount == 1 ? "" : "s")."
                )
            } catch {
                notice = LibraryNotice(message: error.localizedDescription)
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
        .alert(item: $notice) { notice in
            Alert(title: Text("Library"), message: Text(notice.message), dismissButton: .default(Text("OK")))
        }
    }
}

private struct LibraryNotice: Identifiable {
    let id = UUID()
    let message: String
}

private struct EditorView: View {
    @Bindable var store: WorkbenchStore

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Editor")
                    .font(.title2.bold())
                Spacer()
                Button {
                    store.isSettingsPresented = true
                } label: {
                    Label("API Settings", systemImage: "key")
                }
                .labelStyle(.iconOnly)
                .accessibilityLabel("Anthropic API settings")
            }

            Picker("Enhance mode", selection: $store.selectedMode) {
                ForEach(EnhanceMode.allCases) { mode in
                    Text(mode.label).tag(mode)
                }
            }
            .pickerStyle(.menu)

            TextEditor(text: $store.draft)
                .font(.body.monospaced())
                .padding(8)
                .scrollContentBackground(.hidden)
                .background(.background.secondary, in: RoundedRectangle(cornerRadius: 12))
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
                Label("Enhance canceled. No partial run was saved.", systemImage: "xmark.circle")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            HStack {
                if store.isEnhancing {
                    Button("Cancel", role: .cancel) {
                        store.cancelEnhance()
                    }
                    .buttonStyle(.bordered)
                }
                Button {
                    store.startEnhance(modelContext: modelContext)
                } label: {
                    Label(store.isEnhancing ? "Enhancing…" : "Enhance", systemImage: "sparkles")
                }
                .buttonStyle(.borderedProminent)
                .disabled(!store.canEnhance)
                .keyboardShortcut(.return, modifiers: .command)
            }
        }
        .padding()
        .navigationTitle("Editor")
    }

    @Environment(\.modelContext) private var modelContext
}

private struct ResultsView: View {
    let store: WorkbenchStore

    var body: some View {
        Group {
            if let result = store.result {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        ResultSection(title: "Enhanced", text: result.enhanced)
                        ForEach(result.variants, id: \.self) { variant in
                            ResultSection(title: variant.label, text: variant.content)
                        }
                        ResultSection(title: "Notes", text: result.notes)
                        if !result.assumptions.isEmpty {
                            ResultSection(title: "Assumptions", text: result.assumptions.joined(separator: "\n• "), bulleted: true)
                        }
                        if !result.tags.isEmpty {
                            HStack {
                                ForEach(result.tags, id: \.self) { tag in
                                    Text(tag)
                                        .font(.caption.weight(.medium))
                                        .padding(.horizontal, 9)
                                        .padding(.vertical, 5)
                                        .background(.tint.opacity(0.12), in: Capsule())
                                }
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
                }
            } else if store.isEnhancing {
                VStack(spacing: 16) {
                    ProgressView("Streaming from Anthropic…")
                    if !store.streamedText.isEmpty {
                        ScrollView {
                            Text(store.streamedText)
                                .font(.caption.monospaced())
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
}

private struct ResultSection: View {
    let title: String
    let text: String
    var bulleted = false

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title)
                .font(.headline)
            Text(bulleted ? "• \(text)" : text)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
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
