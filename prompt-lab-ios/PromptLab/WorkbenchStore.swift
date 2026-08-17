import Observation
import SwiftData
import SwiftUI

enum EnhanceState: Equatable {
    case idle
    case noAPIKey
    case inFlight
    case completed
    case failed(String)
    case canceled
}

@MainActor
@Observable
final class WorkbenchStore {
    var columnVisibility: NavigationSplitViewVisibility = .all
    var draft = ""
    var currentPromptID: String?
    var currentPromptTitle = "Untitled Prompt"
    var selectedMode: EnhanceMode = .balanced
    private(set) var state: EnhanceState = .idle
    private(set) var streamedText = ""
    private(set) var result: EnhanceResponse?
    var isSettingsPresented = false

    @ObservationIgnored private let provider: any ProviderClient
    @ObservationIgnored private let keychain: any APIKeyStoring
    @ObservationIgnored private var enhanceTask: Task<Void, Never>?

    init(
        provider: any ProviderClient = AnthropicProviderClient(),
        keychain: any APIKeyStoring = KeychainStore()
    ) {
        self.provider = provider
        self.keychain = keychain
    }

    var isEnhancing: Bool {
        state == .inFlight
    }

    var canEnhance: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isEnhancing
    }

    func startNewPrompt() {
        enhanceTask?.cancel()
        draft = ""
        currentPromptID = nil
        currentPromptTitle = "Untitled Prompt"
        streamedText = ""
        result = nil
        state = .idle
    }

    func loadPrompt(_ prompt: PromptEntry) {
        enhanceTask?.cancel()
        currentPromptID = prompt.id
        currentPromptTitle = prompt.title
        draft = prompt.enhanced.isEmpty ? prompt.original : prompt.enhanced
        streamedText = ""
        result = nil
        state = .idle
    }

    func loadRun(_ run: RunRecord) {
        enhanceTask?.cancel()
        currentPromptID = run.promptId
        currentPromptTitle = run.promptTitle
        draft = run.input
        selectedMode = EnhanceMode(rawValue: run.enhanceMode) ?? .balanced
        streamedText = ""
        result = run.response
        // Reusing a historical input is an editor action, not a fresh completion.
        // Keeping the response available preserves its metadata without causing
        // the root completion observer to route straight back to Results.
        state = .idle
    }

    @discardableResult
    func saveCurrentPrompt(modelContext: ModelContext) throws -> PromptEntry {
        let content = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else { throw WorkbenchStoreError.emptyPrompt }

        if let currentPromptID,
           let existing = try modelContext.fetch(
               FetchDescriptor<PromptEntry>(predicate: #Predicate { $0.id == currentPromptID })
           ).first {
            existing.enhanced = content
            if existing.original.isEmpty { existing.original = content }
            if let result {
                existing.notes = result.notes
                existing.variants = result.variants
                existing.tags = result.tags
            }
            existing.updatedAt = .now
            existing.isDirty = true
            try modelContext.save()
            currentPromptTitle = existing.title
            return existing
        }

        let sourceIndex = (try modelContext.fetch(FetchDescriptor<PromptEntry>()).map(\.sourceIndex).max() ?? -1) + 1
        let entry = PromptEntry(
            title: PromptTitleSuggester.suggest(from: content),
            original: content,
            enhanced: content,
            notes: result?.notes ?? "",
            variants: result?.variants ?? [],
            tags: result?.tags ?? [],
            sourceIndex: sourceIndex,
            isDirty: true
        )
        modelContext.insert(entry)
        try modelContext.save()
        currentPromptID = entry.id
        currentPromptTitle = entry.title
        return entry
    }

    @discardableResult
    func saveResult(_ text: String, modelContext: ModelContext) throws -> PromptEntry {
        let content = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else { throw WorkbenchStoreError.emptyPrompt }
        let sourceIndex = (try modelContext.fetch(FetchDescriptor<PromptEntry>()).map(\.sourceIndex).max() ?? -1) + 1
        let entry = PromptEntry(
            title: PromptTitleSuggester.suggest(from: content),
            original: draft,
            enhanced: content,
            notes: result?.notes ?? "",
            variants: result?.variants ?? [],
            tags: result?.tags ?? [],
            sourceIndex: sourceIndex,
            isDirty: true
        )
        modelContext.insert(entry)
        try modelContext.save()
        return entry
    }

    func useResult(_ text: String) {
        draft = text
        currentPromptID = nil
        currentPromptTitle = PromptTitleSuggester.suggest(from: text)
        state = .idle
    }

    func startEnhance(modelContext: ModelContext) {
        guard enhanceTask == nil else { return }
        enhanceTask = Task { [weak self] in
            guard let self else { return }
            await enhance(modelContext: modelContext)
            enhanceTask = nil
        }
    }

    func cancelEnhance() {
        enhanceTask?.cancel()
    }

    func enhance(modelContext: ModelContext) async {
        let input = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !input.isEmpty else { return }

        let apiKey: String
        do {
            if provider.requiresAPIKey {
                guard let storedKey = try keychain.retrieve(), !storedKey.isEmpty else {
                    state = .noAPIKey
                    isSettingsPresented = true
                    return
                }
                apiKey = storedKey
            } else {
                apiKey = ""
            }
        } catch {
            state = .failed(error.localizedDescription)
            return
        }

        state = .inFlight
        streamedText = ""
        result = nil
        let startedAt = Date()
        let request = EnhanceRequest(prompt: input, mode: selectedMode)

        do {
            for try await chunk in provider.streamEnhance(request: request, apiKey: apiKey) {
                try Task.checkCancellation()
                streamedText += chunk
            }
            try Task.checkCancellation()
            let parsed = try EnhanceResponseParser.parse(streamedText)
            try Task.checkCancellation()
            let latency = max(0, Int(Date().timeIntervalSince(startedAt) * 1_000))
            let run = RunRecord(
                promptId: currentPromptID,
                promptTitle: currentPromptID == nil ? PromptTitleSuggester.suggest(from: input) : currentPromptTitle,
                enhanceMode: selectedMode.rawValue,
                provider: provider.providerID,
                model: provider.modelID,
                input: input,
                output: parsed.enhanced,
                latencyMs: latency,
                notes: parsed.notes,
                response: parsed
            )
            modelContext.insert(run)
            do {
                try modelContext.save()
            } catch {
                modelContext.delete(run)
                throw error
            }
            result = parsed
            state = .completed
        } catch is CancellationError {
            recordRun(
                modelContext: modelContext,
                input: input,
                output: streamedText,
                startedAt: startedAt,
                status: "canceled",
                notes: "Enhance canceled before completion."
            )
            streamedText = ""
            result = nil
            state = .canceled
        } catch {
            recordRun(
                modelContext: modelContext,
                input: input,
                output: streamedText,
                startedAt: startedAt,
                status: "error",
                notes: error.localizedDescription
            )
            result = nil
            state = .failed(error.localizedDescription)
        }
    }

    /// Failed and canceled attempts belong in run history too — matching the web
    /// app, where dropping them hid real failures from the timeline (issue 009).
    /// Best-effort: a run record must never mask the underlying enhance error.
    private func recordRun(
        modelContext: ModelContext,
        input: String,
        output: String,
        startedAt: Date,
        status: String,
        notes: String
    ) {
        let run = RunRecord(
            promptId: currentPromptID,
            promptTitle: currentPromptID == nil ? PromptTitleSuggester.suggest(from: input) : currentPromptTitle,
            enhanceMode: selectedMode.rawValue,
            provider: provider.providerID,
            model: provider.modelID,
            input: input,
            output: output,
            latencyMs: max(0, Int(Date().timeIntervalSince(startedAt) * 1_000)),
            notes: notes,
            status: status
        )
        modelContext.insert(run)
        do {
            try modelContext.save()
        } catch {
            modelContext.delete(run)
        }
    }
}

enum WorkbenchStoreError: LocalizedError {
    case emptyPrompt

    var errorDescription: String? {
        "Write a prompt before saving."
    }
}
