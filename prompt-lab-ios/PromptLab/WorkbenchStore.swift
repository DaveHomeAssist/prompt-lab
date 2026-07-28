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
            try modelContext.save()
            result = parsed
            state = .completed
        } catch is CancellationError {
            streamedText = ""
            result = nil
            state = .canceled
        } catch {
            result = nil
            state = .failed(error.localizedDescription)
        }
    }
}
