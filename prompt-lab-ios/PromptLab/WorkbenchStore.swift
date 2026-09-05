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
    var draft = "" { didSet { if oldValue != draft { invalidateAttempt() } } }
    var currentPromptID: String? { didSet { if oldValue != currentPromptID { invalidateAttempt() } } }
    var currentPromptTitle = "Untitled Prompt"
    var selectedMode: EnhanceMode = .balanced { didSet { if oldValue != selectedMode { invalidateAttempt() } } }
    private(set) var state: EnhanceState = .idle
    private(set) var streamedText = ""
    private(set) var result: EnhanceResponse?
    var isSettingsPresented = false

    @ObservationIgnored private let provider: any ProviderClient
    @ObservationIgnored private let keychain: any APIKeyStoring
    @ObservationIgnored private var enhanceTask: Task<Void, Never>?
    @ObservationIgnored private var activeAttemptID: UUID?

    private struct Attempt {
        let id = UUID()
        let input: String
        let promptID: String?
        let title: String
        let mode: EnhanceMode
        let startedAt = Date()
    }

    private func invalidateAttempt() {
        guard activeAttemptID != nil else { return }
        activeAttemptID = nil
        enhanceTask?.cancel()
        enhanceTask = nil
        streamedText = ""
        state = .idle
    }

    private func beginAttempt() -> Attempt? {
        guard activeAttemptID == nil else { return nil }
        let input = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !input.isEmpty else { return nil }
        let attempt = Attempt(input: input, promptID: currentPromptID,
                              title: currentPromptID == nil ? PromptTitleSuggester.suggest(from: input) : currentPromptTitle,
                              mode: selectedMode)
        activeAttemptID = attempt.id
        return attempt
    }

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
        invalidateAttempt()
        draft = ""
        currentPromptID = nil
        currentPromptTitle = "Untitled Prompt"
        streamedText = ""
        result = nil
        state = .idle
    }

    func loadPrompt(_ prompt: PromptEntry) {
        invalidateAttempt()
        currentPromptID = prompt.id
        currentPromptTitle = prompt.title
        draft = prompt.enhanced.isEmpty ? prompt.original : prompt.enhanced
        streamedText = ""
        result = nil
        state = .idle
    }

    func loadRun(_ run: RunRecord) {
        invalidateAttempt()
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
        guard let attempt = beginAttempt() else { return }
        enhanceTask = Task { [weak self] in
            await self?.performEnhance(attempt, modelContext: modelContext)
        }
    }

    func cancelEnhance() {
        enhanceTask?.cancel()
    }

    func enhance(modelContext: ModelContext) async {
        guard let attempt = beginAttempt() else { return }
        await performEnhance(attempt, modelContext: modelContext)
    }

    private func performEnhance(_ attempt: Attempt, modelContext: ModelContext) async {
        guard activeAttemptID == attempt.id else { return }
        defer {
            if activeAttemptID == attempt.id {
                activeAttemptID = nil
                enhanceTask = nil
            }
        }
        let input = attempt.input
        var partialText = ""

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
        let startedAt = attempt.startedAt
        let request = EnhanceRequest(prompt: input, mode: attempt.mode)

        do {
            for try await chunk in provider.streamEnhance(request: request, apiKey: apiKey) {
                try Task.checkCancellation()
                guard activeAttemptID == attempt.id else { throw CancellationError() }
                partialText += chunk
                streamedText = partialText
            }
            try Task.checkCancellation()
            guard activeAttemptID == attempt.id else { throw CancellationError() }
            let parsed = try EnhanceResponseParser.parse(partialText)
            try Task.checkCancellation()
            let latency = max(0, Int(Date().timeIntervalSince(startedAt) * 1_000))
            let run = RunRecord(
                promptId: attempt.promptID,
                promptTitle: attempt.title,
                enhanceMode: attempt.mode.rawValue,
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
                attempt: attempt,
                output: partialText,
                startedAt: startedAt,
                status: "canceled",
                notes: "Enhance canceled before completion."
            )
            if activeAttemptID == attempt.id {
                streamedText = ""
                result = nil
                state = .canceled
            }
        } catch {
            recordRun(
                modelContext: modelContext,
                attempt: attempt,
                output: partialText,
                startedAt: startedAt,
                status: "error",
                notes: error.localizedDescription
            )
            if activeAttemptID == attempt.id {
                result = nil
                state = .failed(error.localizedDescription)
            }
        }
    }

    /// Failed and canceled attempts belong in run history too — matching the web
    /// app, where dropping them hid real failures from the timeline (issue 009).
    /// Best-effort: a run record must never mask the underlying enhance error.
    private func recordRun(
        modelContext: ModelContext,
        attempt: Attempt,
        output: String,
        startedAt: Date,
        status: String,
        notes: String
    ) {
        let run = RunRecord(
            promptId: attempt.promptID,
            promptTitle: attempt.title,
            enhanceMode: attempt.mode.rawValue,
            provider: provider.providerID,
            model: provider.modelID,
            input: attempt.input,
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
