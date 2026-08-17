import SwiftData
import XCTest
@testable import PromptLab

final class PromptLabTests: XCTestCase {
    @MainActor
    func testWebLibraryExportRoundTripsByteForByte() throws {
        let fixtureURL = try XCTUnwrap(
            Bundle(for: Self.self).url(forResource: "web-library-export-1.7.0", withExtension: "json")
        )
        let fixture = try Data(contentsOf: fixtureURL)
        let container = try makeInMemoryContainer()
        let context = ModelContext(container)

        let summary = try LibraryInterchange.importData(fixture, into: context)
        let exported = try LibraryInterchange.exportData(from: context)

        XCTAssertEqual(summary, LibraryImportSummary(promptCount: 1, collectionCount: 2))
        XCTAssertEqual(exported, fixture)
        let prompt = try XCTUnwrap(context.fetch(FetchDescriptor<PromptEntry>()).first)
        XCTAssertEqual(prompt.id, "web-export-001")
        XCTAssertEqual(prompt.title, "Incident summary")
        XCTAssertEqual(prompt.notes, "Adds an explicit executive structure.")
        XCTAssertEqual(prompt.variants.map(\.label), ["Concise", "Detailed"])
        XCTAssertEqual(prompt.tags, ["Writing", "Analysis"])

        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: exported) as? [String: Any])
        let library = try XCTUnwrap(root["library"] as? [[String: Any]])
        let metadata = try XCTUnwrap(library.first?["metadata"] as? [String: Any])
        XCTAssertEqual(metadata["customField"] as? String, "preserve-me")
        XCTAssertEqual(root["collections"] as? [String], ["Operations", "Empty Collection"])

        prompt.enhanced = "Summarize {{incident}} for leadership with owners and follow-up dates."
        prompt.notes = "Revised for accountable follow-up."
        prompt.variants = [
            PromptVariant(label: "Brief", content: "Summarize {{incident}} in three bullets."),
            PromptVariant(label: "Actions", content: "List owners and dated next steps for {{incident}}."),
        ]
        prompt.tags = ["Writing", "System"]
        prompt.updatedAt = Date(timeIntervalSince1970: 1_722_500_000)
        prompt.isDirty = true
        try context.save()

        let editedExport = try LibraryInterchange.exportData(from: context)
        XCTAssertNotEqual(editedExport, fixture)
        let editedRoot = try XCTUnwrap(JSONSerialization.jsonObject(with: editedExport) as? [String: Any])
        let editedLibrary = try XCTUnwrap(editedRoot["library"] as? [[String: Any]])
        let editedPrompt = try XCTUnwrap(editedLibrary.first)
        let editedVariants = try XCTUnwrap(editedPrompt["variants"] as? [[String: Any]])
        let editedMetadata = try XCTUnwrap(editedPrompt["metadata"] as? [String: Any])

        XCTAssertEqual(editedPrompt["enhanced"] as? String, prompt.enhanced)
        XCTAssertEqual(editedPrompt["notes"] as? String, prompt.notes)
        XCTAssertEqual(editedPrompt["tags"] as? [String], prompt.tags)
        XCTAssertEqual(editedVariants.compactMap { $0["label"] as? String }, ["Brief", "Actions"])
        XCTAssertEqual(editedRoot["collections"] as? [String], ["Operations", "Empty Collection"])
        XCTAssertEqual(editedMetadata["customField"] as? String, "preserve-me")
        XCTAssertEqual(editedPrompt["useCount"] as? Int, 3)
    }

    func testEnhanceParserRejectsMalformedOutput() {
        XCTAssertThrowsError(try EnhanceResponseParser.parse("not json")) { error in
            XCTAssertEqual(error as? EnhanceContractError, .invalidJSON)
        }
    }

    func testEnhanceParserRejectsTruncatedOutput() {
        let truncated = #"{"enhanced":"Improved","variants":[{"label":"A""#
        XCTAssertThrowsError(try EnhanceResponseParser.parse(truncated)) { error in
            XCTAssertEqual(error as? EnhanceContractError, .invalidJSON)
        }
    }

    func testEnhanceParserAcceptsMarkdownFencedOutput() throws {
        let fenced = """
        ```json
        \(Self.validContractJSON)
        ```
        """
        let parsed = try EnhanceResponseParser.parse(fenced)
        XCTAssertEqual(parsed.enhanced, "Improved")
        XCTAssertEqual(parsed.variants.count, 2)
    }

    func testEnhanceParserAcceptsPreambleBeforeJSON() throws {
        let withPreamble = "Here is the enhanced prompt:\n\n\(Self.validContractJSON)"
        let parsed = try EnhanceResponseParser.parse(withPreamble)
        XCTAssertEqual(parsed.enhanced, "Improved")
    }

    func testHTTPStatusErrorSurfacesAnthropicDetail() {
        XCTAssertEqual(
            ProviderError.httpStatus(401, "invalid x-api-key").errorDescription,
            "Anthropic returned HTTP 401: invalid x-api-key"
        )
        XCTAssertEqual(
            ProviderError.httpStatus(500, nil).errorDescription,
            "Anthropic returned HTTP 500."
        )
    }

    func testEnhanceParserRejectsWrongVariantCount() {
        let oneVariant = #"{"enhanced":"Improved","variants":[{"label":"A","content":"One"}],"notes":"Changed it.","assumptions":[],"tags":[]}"#
        XCTAssertThrowsError(try EnhanceResponseParser.parse(oneVariant)) { error in
            XCTAssertEqual(error as? EnhanceContractError, .invalidVariantCount(1))
        }
    }

    func testSystemPromptKeepsWebEnhanceContractSnapshot() {
        let prompt = SystemPromptBuilder.build(mode: .balanced, tags: SystemPromptBuilder.availableTags)
        XCTAssertTrue(prompt.contains(#"{"enhanced":"...","variants":[{"label":"...","content":"..."}],"notes":"...","assumptions":["..."],"tags":["..."]}"#))
        XCTAssertTrue(prompt.contains("Produce 2 variants."))
        XCTAssertTrue(prompt.contains("Available tags: Writing, Code, Research, Analysis, Creative, System, Role-play, Other."))
    }

    func testSharedNativeContractMatchesRuntimeDefaults() throws {
        let fixtureURL = try XCTUnwrap(
            Bundle(for: Self.self).url(forResource: "promptlab-enhance-contract-v1", withExtension: "json")
        )
        let data = try Data(contentsOf: fixtureURL)
        let contract = try JSONDecoder().decode(NativeContractFixture.self, from: data)

        XCTAssertEqual(contract.provider.defaultModel, ProviderDefaults.model)
        XCTAssertEqual(contract.provider.maxTokens, ProviderDefaults.maxTokens)
        XCTAssertEqual(contract.provider.temperature, ProviderDefaults.temperature)
        XCTAssertEqual(contract.enhance.modes, EnhanceMode.allCases.map(\.rawValue))
        XCTAssertEqual(contract.enhance.tags, SystemPromptBuilder.availableTags)
        XCTAssertEqual(contract.enhance.responseFields, ["enhanced", "variants", "notes", "assumptions", "tags"])
        XCTAssertEqual(contract.enhance.statuses, ["success", "error", "blocked", "canceled"])
        for titleCase in contract.titleCases {
            XCTAssertEqual(PromptTitleSuggester.suggest(from: titleCase.input), titleCase.expected)
        }
    }

    @MainActor
    func testLibraryPreviewDoesNotReplaceUntilConfirmed() throws {
        let fixtureURL = try XCTUnwrap(
            Bundle(for: Self.self).url(forResource: "web-library-export-1.7.0", withExtension: "json")
        )
        let fixture = try Data(contentsOf: fixtureURL)
        let container = try makeInMemoryContainer()
        let context = ModelContext(container)
        context.insert(PromptEntry(id: "keep-me", title: "Keep me", original: "Existing"))
        try context.save()

        let preview = try LibraryInterchange.previewData(fixture)
        XCTAssertEqual(preview.summary, LibraryImportSummary(promptCount: 1, collectionCount: 2))
        XCTAssertEqual(try context.fetch(FetchDescriptor<PromptEntry>()).map(\.id), ["keep-me"])

        _ = try LibraryInterchange.importPreview(preview, into: context)
        XCTAssertEqual(try context.fetch(FetchDescriptor<PromptEntry>()).map(\.id), ["web-export-001"])
    }

    @MainActor
    func testRecordedEnhancePersistsRunAcrossContainerReopen() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PromptLabTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let storeURL = directory.appendingPathComponent("PromptLab.store")
        let schema = appSchema
        let configuration = ModelConfiguration(
            "PromptLabTests",
            schema: schema,
            url: storeURL,
            allowsSave: true,
            cloudKitDatabase: .none
        )

        do {
            let container = try ModelContainer(for: schema, configurations: [configuration])
            let context = ModelContext(container)
            let store = WorkbenchStore(provider: RecordedAnthropicProviderClient())
            store.draft = "Analyze this product feature idea and recommend the smallest useful version."

            await store.enhance(modelContext: context)

            XCTAssertEqual(store.state, .completed)
            let response = try XCTUnwrap(store.result)
            XCTAssertEqual(response.variants.count, 2)
            XCTAssertFalse(response.notes.isEmpty)
            XCTAssertEqual(try context.fetchCount(FetchDescriptor<RunRecord>()), 1)

            let savedPrompt = try store.saveResult(response.enhanced, modelContext: context)
            XCTAssertEqual(savedPrompt.notes, response.notes)
            XCTAssertEqual(savedPrompt.variants, response.variants)
            XCTAssertEqual(savedPrompt.tags, response.tags)
        }

        let reopenedContainer = try ModelContainer(for: schema, configurations: [configuration])
        let reopenedContext = ModelContext(reopenedContainer)
        let records = try reopenedContext.fetch(FetchDescriptor<RunRecord>())
        XCTAssertEqual(records.count, 1)
        XCTAssertEqual(records.first?.status, "success")
        XCTAssertEqual(records.first?.enhanceMode, "balanced")
        XCTAssertFalse(records.first?.output.isEmpty ?? true)
        XCTAssertEqual(records.first?.response?.enhanced, records.first?.output)
        XCTAssertEqual(records.first?.response?.variants.count, 2)
        XCTAssertFalse(records.first?.response?.notes.isEmpty ?? true)
        XCTAssertEqual(
            records.first?.response?.assumptions,
            ["The desired output is a product recommendation rather than implementation code."]
        )
        XCTAssertEqual(records.first?.response?.tags, ["Analysis", "Creative"])

        let prompts = try reopenedContext.fetch(FetchDescriptor<PromptEntry>())
        XCTAssertEqual(prompts.count, 1)
        XCTAssertEqual(prompts.first?.enhanced, records.first?.response?.enhanced)
        XCTAssertEqual(prompts.first?.notes, records.first?.response?.notes)
        XCTAssertEqual(prompts.first?.variants, records.first?.response?.variants)
        XCTAssertEqual(prompts.first?.tags, records.first?.response?.tags)
    }

    func testKeychainStoreRetrieveUpdateDelete() throws {
        let service = "com.davehomeassist.promptlab.tests.\(UUID().uuidString)"
        let keychain = KeychainStore(service: service, account: "anthropic")
        defer { try? keychain.delete() }
        let first = "sk-ant-test-first-\(UUID().uuidString)"
        let second = "sk-ant-test-second-\(UUID().uuidString)"

        XCTAssertNil(try keychain.retrieve())
        try keychain.store(first)
        XCTAssertEqual(try keychain.retrieve(), first)
        try keychain.store(second)
        XCTAssertEqual(try keychain.retrieve(), second)
        XCTAssertFalse(UserDefaults.standard.dictionaryRepresentation().values.contains { value in
            String(describing: value).contains(second)
        })
        try keychain.delete()
        XCTAssertNil(try keychain.retrieve())
    }

    @MainActor
    func testCancellationMidStreamRecordsCanceledRun() async throws {
        let container = try makeInMemoryContainer()
        let context = ModelContext(container)
        let store = WorkbenchStore(provider: SlowProviderClient())
        store.draft = "Cancel this enhance."

        store.startEnhance(modelContext: context)
        try await waitUntil { store.state == .inFlight && !store.streamedText.isEmpty }
        store.cancelEnhance()
        try await waitUntil { store.state == .canceled }

        let runs = try context.fetch(FetchDescriptor<RunRecord>())
        XCTAssertEqual(runs.count, 1)
        XCTAssertEqual(runs.first?.status, "canceled")
        XCTAssertEqual(runs.first?.enhanceMode, "balanced")
        // The partial stream is kept on the record even though the view clears it.
        XCTAssertFalse(runs.first?.output.isEmpty ?? true)
        XCTAssertNil(store.result)
        XCTAssertTrue(store.streamedText.isEmpty)
    }

    @MainActor
    func testAPIErrorRecordsFailedRunWithReason() async throws {
        let container = try makeInMemoryContainer()
        let context = ModelContext(container)
        let store = WorkbenchStore(provider: ErrorProviderClient())
        store.draft = "Trigger an API error."

        await store.enhance(modelContext: context)

        guard case let .failed(message) = store.state else {
            return XCTFail("Expected a failed state, got \(store.state)")
        }
        XCTAssertEqual(message, "Recorded API failure.")

        let runs = try context.fetch(FetchDescriptor<RunRecord>())
        XCTAssertEqual(runs.count, 1)
        XCTAssertEqual(runs.first?.status, "error")
        XCTAssertEqual(runs.first?.canonicalStatus, "error")
        XCTAssertEqual(runs.first?.notes, "Recorded API failure.")
        XCTAssertEqual(runs.first?.input, "Trigger an API error.")
    }

    @MainActor
    func testNoAPIKeyStatePresentsSettingsWithoutCallingProvider() async throws {
        let container = try makeInMemoryContainer()
        let context = ModelContext(container)
        let provider = RequiresKeyProviderClient()
        let store = WorkbenchStore(provider: provider, keychain: MemoryAPIKeyStore())
        store.draft = "Needs a key."

        await store.enhance(modelContext: context)

        XCTAssertEqual(store.state, .noAPIKey)
        XCTAssertTrue(store.isSettingsPresented)
        XCTAssertEqual(try context.fetchCount(FetchDescriptor<RunRecord>()), 0)
    }

    @MainActor
    func testEmptyLibraryStateHasNoPromptsPadsOrRuns() throws {
        let container = try makeInMemoryContainer()
        let context = ModelContext(container)

        XCTAssertEqual(try context.fetchCount(FetchDescriptor<PromptEntry>()), 0)
        XCTAssertEqual(try context.fetchCount(FetchDescriptor<Pad>()), 0)
        XCTAssertEqual(try context.fetchCount(FetchDescriptor<RunRecord>()), 0)
    }

    @MainActor
    func testLegacyFailedRunAndPromptDefaultsRemainReadable() throws {
        let container = try makeInMemoryContainer()
        let context = ModelContext(container)
        let legacyRun = RunRecord(
            enhanceMode: "balanced",
            provider: "anthropic",
            model: ProviderDefaults.model,
            input: "Legacy input",
            output: "",
            latencyMs: 1,
            notes: "Historical failure",
            status: "failed"
        )
        let legacyPrompt = PromptEntry(title: "Legacy prompt", original: "Legacy content")
        context.insert(legacyRun)
        context.insert(legacyPrompt)
        try context.save()

        XCTAssertEqual(legacyRun.canonicalStatus, "error")
        XCTAssertNil(legacyRun.response)
        XCTAssertEqual(legacyPrompt.notes, "")
        XCTAssertEqual(legacyPrompt.variants, [])
        XCTAssertEqual(legacyPrompt.tags, [])
        XCTAssertEqual(legacyPrompt.updatedAt, legacyPrompt.createdAt)
    }

    @MainActor
    func testVersionOneStoreMigratesAndPreservesHistoricalData() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PromptLabMigrationTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let storeURL = directory.appendingPathComponent("PromptLab.store")
        let createdAt = Date(timeIntervalSince1970: 1_722_000_000)

        do {
            let legacySchema = Schema(versionedSchema: PromptLabSchemaV1.self)
            let legacyConfiguration = ModelConfiguration(
                "PromptLab",
                schema: legacySchema,
                url: storeURL,
                allowsSave: true,
                cloudKitDatabase: .none
            )
            let legacyContainer = try ModelContainer(
                for: legacySchema,
                configurations: [legacyConfiguration]
            )
            let legacyContext = ModelContext(legacyContainer)
            legacyContext.insert(PromptLabSchemaV1.PromptEntry(
                id: "legacy-prompt",
                title: "Legacy prompt",
                original: "Original legacy prompt",
                enhanced: "Enhanced legacy prompt",
                createdAt: createdAt,
                sourceIndex: 4
            ))
            legacyContext.insert(PromptLabSchemaV1.RunRecord(
                id: "legacy-run",
                createdAt: createdAt,
                promptId: "legacy-prompt",
                promptTitle: "Legacy prompt",
                enhanceMode: "balanced",
                provider: "anthropic",
                model: ProviderDefaults.model,
                input: "Original legacy prompt",
                output: "Partial legacy output",
                latencyMs: 42,
                notes: "Historical failure",
                status: "failed"
            ))
            try legacyContext.save()
        }

        let currentSchema = Schema(versionedSchema: PromptLabSchemaV2.self)
        let currentConfiguration = ModelConfiguration(
            "PromptLab",
            schema: currentSchema,
            url: storeURL,
            allowsSave: true,
            cloudKitDatabase: .none
        )
        let migratedContainer = try ModelContainer(
            for: currentSchema,
            migrationPlan: PromptLabMigrationPlan.self,
            configurations: [currentConfiguration]
        )
        let migratedContext = ModelContext(migratedContainer)

        let prompt = try XCTUnwrap(
            migratedContext.fetch(
                FetchDescriptor<PromptEntry>(predicate: #Predicate { $0.id == "legacy-prompt" })
            ).first
        )
        XCTAssertEqual(prompt.title, "Legacy prompt")
        XCTAssertEqual(prompt.enhanced, "Enhanced legacy prompt")
        XCTAssertEqual(prompt.notes, "")
        XCTAssertEqual(prompt.variants, [])
        XCTAssertEqual(prompt.tags, [])
        XCTAssertGreaterThanOrEqual(prompt.updatedAt, prompt.createdAt)

        let run = try XCTUnwrap(
            migratedContext.fetch(
                FetchDescriptor<RunRecord>(predicate: #Predicate { $0.id == "legacy-run" })
            ).first
        )
        XCTAssertEqual(run.output, "Partial legacy output")
        XCTAssertEqual(run.canonicalStatus, "error")
        XCTAssertNil(run.response)
    }

    @MainActor
    private func makeInMemoryContainer() throws -> ModelContainer {
        try ModelContainer(
            for: appSchema,
            configurations: [ModelConfiguration(schema: appSchema, isStoredInMemoryOnly: true)]
        )
    }

    private var appSchema: Schema {
        Schema([PromptEntry.self, Pad.self, RunRecord.self, LibraryMetadata.self])
    }

    private static let validContractJSON = #"{"enhanced":"Improved","variants":[{"label":"A","content":"One"},{"label":"B","content":"Two"}],"notes":"Changed it.","assumptions":[],"tags":[]}"#

    @MainActor
    private func waitUntil(
        timeout: TimeInterval = 2,
        condition: @escaping @MainActor () -> Bool
    ) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition() {
            guard Date() < deadline else {
                XCTFail("Timed out waiting for state transition.")
                return
            }
            try await Task.sleep(for: .milliseconds(10))
        }
    }
}

private struct NativeContractFixture: Decodable {
    let provider: Provider
    let enhance: Enhance
    let titleCases: [TitleCase]

    struct Provider: Decodable {
        let defaultModel: String
        let maxTokens: Int
        let temperature: Double
    }

    struct Enhance: Decodable {
        let modes: [String]
        let tags: [String]
        let responseFields: [String]
        let statuses: [String]
    }

    struct TitleCase: Decodable {
        let input: String
        let expected: String
    }
}

/// Live network smoke test for the shipping Anthropic path.
///
/// Skipped unless ANTHROPIC_API_KEY is present in the test runner environment.
/// Run locally with:
///   TEST_RUNNER_ANTHROPIC_API_KEY=<key> xcodebuild test ... -only-testing:PromptLabTests/LiveAnthropicSmokeTests
final class LiveAnthropicSmokeTests: XCTestCase {
    func testLiveEnhanceStreamsAndSatisfiesContract() async throws {
        guard let apiKey = ProcessInfo.processInfo.environment["ANTHROPIC_API_KEY"],
              !apiKey.isEmpty else {
            throw XCTSkip("ANTHROPIC_API_KEY not set; skipping live Anthropic smoke test.")
        }

        let client = AnthropicProviderClient()
        let request = EnhanceRequest(
            prompt: "Summarize this repository's README for a new contributor.",
            mode: .concise
        )

        var streamed = ""
        var deltaCount = 0
        for try await delta in client.streamEnhance(request: request, apiKey: apiKey) {
            streamed += delta
            deltaCount += 1
        }

        XCTAssertGreaterThan(deltaCount, 1, "Expected multiple SSE text deltas, got \(deltaCount).")
        XCTAssertFalse(streamed.isEmpty, "Streamed response was empty.")

        let parsed = try EnhanceResponseParser.parse(streamed)
        XCTAssertFalse(parsed.enhanced.isEmpty)
        XCTAssertEqual(parsed.variants.count, 2)
        XCTAssertFalse(parsed.notes.isEmpty)
    }
}

private final class MemoryAPIKeyStore: APIKeyStoring {
    private var value: String?

    func store(_ key: String) throws { value = key }
    func retrieve() throws -> String? { value }
    func delete() throws { value = nil }
}

private struct SlowProviderClient: ProviderClient {
    let providerID = "anthropic"
    let modelID = "slow-recorded"
    let requiresAPIKey = false

    func streamEnhance(request: EnhanceRequest, apiKey: String) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            let producer = Task {
                do {
                    continuation.yield(#"{"enhanced":"partial"#)
                    try await Task.sleep(for: .seconds(10))
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in producer.cancel() }
        }
    }
}

private struct ErrorProviderClient: ProviderClient {
    let providerID = "anthropic"
    let modelID = "error-recorded"
    let requiresAPIKey = false

    func streamEnhance(request: EnhanceRequest, apiKey: String) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            continuation.finish(throwing: ProviderError.remote("Recorded API failure."))
        }
    }
}

private struct RequiresKeyProviderClient: ProviderClient {
    let providerID = "anthropic"
    let modelID = "requires-key"
    let requiresAPIKey = true

    func streamEnhance(request: EnhanceRequest, apiKey: String) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            continuation.finish(throwing: ProviderError.remote("Provider should not be called without a key."))
        }
    }
}
