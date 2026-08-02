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

        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: exported) as? [String: Any])
        let library = try XCTUnwrap(root["library"] as? [[String: Any]])
        let metadata = try XCTUnwrap(library.first?["metadata"] as? [String: Any])
        XCTAssertEqual(metadata["customField"] as? String, "preserve-me")
        XCTAssertEqual(root["collections"] as? [String], ["Operations", "Empty Collection"])
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
            XCTAssertEqual(store.result?.variants.count, 2)
            XCTAssertFalse(store.result?.notes.isEmpty ?? true)
            XCTAssertEqual(try context.fetchCount(FetchDescriptor<RunRecord>()), 1)
        }

        let reopenedContainer = try ModelContainer(for: schema, configurations: [configuration])
        let reopenedContext = ModelContext(reopenedContainer)
        let records = try reopenedContext.fetch(FetchDescriptor<RunRecord>())
        XCTAssertEqual(records.count, 1)
        XCTAssertEqual(records.first?.status, "success")
        XCTAssertEqual(records.first?.enhanceMode, "balanced")
        XCTAssertFalse(records.first?.output.isEmpty ?? true)
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
        XCTAssertEqual(runs.first?.status, "failed")
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
