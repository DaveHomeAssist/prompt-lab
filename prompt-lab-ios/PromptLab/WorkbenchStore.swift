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
                promptTitle: String(input.prefix(60)),
                enhanceMode: selectedMode.rawValue,
                provider: provider.providerID,
                model: provider.modelID,
                input: input,
                output: parsed.enhanced,
                latencyMs: latency,
                notes: parsed.notes
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
                status: "failed",
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
            promptTitle: String(input.prefix(60)),
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
