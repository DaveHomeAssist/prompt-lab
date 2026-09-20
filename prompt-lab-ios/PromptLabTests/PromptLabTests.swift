import SwiftData
import XCTest
@testable import PromptLab

final class PromptLabTests: XCTestCase {
    @MainActor
    func testNativeCreatedArtifactHasStableIdentityAndVersions() throws {
        let container = try makeInMemoryContainer()
        let context = ModelContext(container)
        let store = WorkbenchStore(provider: RecordedAnthropicProviderClient())
        store.draft = "Native created compatibility record."
        let entry = try store.saveCurrentPrompt(modelContext: context)
        let initial = try XCTUnwrap(JSONSerialization.jsonObject(with: entry.rawJSON) as? [String: Any])
        let originalVersionID = try XCTUnwrap(initial["currentVersionId"] as? String)
        store.draft = "Native revised compatibility record."
        _ = try store.saveCurrentPrompt(modelContext: context)
        let exported = try LibraryInterchange.exportData(from: context)
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: exported) as? [String: Any])
        let library = try XCTUnwrap(root["library"] as? [[String: Any]])
        XCTAssertEqual(library[0]["id"] as? String, entry.id)
        XCTAssertNotEqual(library[0]["currentVersionId"] as? String, originalVersionID)
        let versions = try XCTUnwrap(library[0]["versions"] as? [[String: Any]])
        XCTAssertEqual(versions.last?["id"] as? String, originalVersionID)
        XCTAssertEqual(versions.last?["enhanced"] as? String, "Native created compatibility record.")
        let attachment = XCTAttachment(data: exported, uniformTypeIdentifier: "public.json")
        attachment.name = "native-created-library.json"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    func testSharedLibrarySurvivesNativeEditAndStoreReopen() throws {
        let data = try Data(contentsOf: XCTUnwrap(Bundle(for: Self.self).url(
            forResource: "promptlab-library-v2", withExtension: "json"
        )))
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("LibraryContract-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let configuration = ModelConfiguration(
            "LibraryContract", schema: appSchema,
            url: directory.appendingPathComponent("Library.store"), cloudKitDatabase: .none
        )
        let descriptor = FetchDescriptor<PromptEntry>(sortBy: [SortDescriptor(\.sourceIndex)])
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        do {
            let container = try ModelContainer(for: appSchema, configurations: [configuration])
            let context = ModelContext(container)
            _ = try LibraryInterchange.importData(data, into: context)
            XCTAssertEqual(try LibraryInterchange.exportData(from: context), data)
            let entries = try context.fetch(descriptor)
            XCTAssertEqual(entries.map(\.id), ["contract-child", "contract-parent"])
            XCTAssertEqual(entries[0].createdAt, formatter.date(from: "2026-07-27T10:00:00.456Z"))
            XCTAssertEqual(entries[0].updatedAt, formatter.date(from: "2026-07-27T10:01:00.999Z"))
            XCTAssertEqual(entries[1].createdAt, formatter.date(from: "2026-07-26T14:30:00.123Z"))
            entries[0].notes = "Edited on native; preserve lineage."
            entries[0].updatedAt = try XCTUnwrap(formatter.date(from: "2026-09-20T10:30:00.321Z"))
            entries[0].isDirty = true
            try context.save()
        }
        let reopened = try ModelContainer(for: appSchema, configurations: [configuration])
        let context = ModelContext(reopened)
        XCTAssertEqual(try context.fetch(descriptor).map(\.id), ["contract-child", "contract-parent"])
        let exported = try LibraryInterchange.exportData(from: context)
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: exported) as? [String: Any])
        let source = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let library = try XCTUnwrap(root["library"] as? [[String: Any]])
        let originalLibrary = try XCTUnwrap(source["library"] as? [[String: Any]])
        XCTAssertEqual(library[0]["createdAt"] as? String, "2026-07-27T10:00:00.456Z")
        XCTAssertEqual(library[0]["updatedAt"] as? String, "2026-09-20T10:30:00.321Z")
        XCTAssertEqual(library[0]["updated_at"] as? String, "2026-09-20T10:30:00.321Z")
        XCTAssertEqual(library[0]["metadata"] as? NSDictionary, originalLibrary[0]["metadata"] as? NSDictionary)
        XCTAssertEqual(library[1] as NSDictionary, originalLibrary[1] as NSDictionary)
        for key in ["collections", "trash", "packs", "scratch", "runs", "testCases"] {
            XCTAssertEqual(root[key] as? NSObject, source[key] as? NSObject, key)
        }
        // CI consumes this actual Swift export with the production JS importer.
        // It contains only the checked-in synthetic fixture, never user data.
        let attachment = XCTAttachment(data: exported, uniformTypeIdentifier: "public.json")
        attachment.name = "native-library-contract.json"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    func testLibraryLegacyAliasesDuplicateAndCorruptImports() throws {
        let container = try makeInMemoryContainer()
        let context = ModelContext(container)
        let legacy = Data(#"[{"id":"legacy","currentVersionId":"legacy-v1","prompt":"Legacy content","category":"Old folder","createdAt":"2025-01-01T00:00:00Z","updated_at":"2025-01-02T00:00:00.123Z"}]"#.utf8)
        _ = try LibraryInterchange.importData(legacy, into: context)
        _ = try LibraryInterchange.importData(legacy, into: context)
        let entries = try context.fetch(FetchDescriptor<PromptEntry>())
        XCTAssertEqual(entries.map(\.id), ["legacy"])
        XCTAssertEqual(entries[0].original, "Legacy content")
        XCTAssertEqual(entries[0].enhanced, "Legacy content")
        XCTAssertEqual(entries[0].updatedAt.timeIntervalSince1970, 1_735_776_000.123, accuracy: 0.001)
        for invalid in [
            #"{"library":[{"id":"same","original":"One"},{"id":"same","original":"Two"}]}"#,
            #"{"library":[{"id":123,"original":"Invalid identity"}]}"#,
            #"{"library":[{"id":"empty","enhanced":" "}]}"#,
            #"{"library":[null]}"#,
            "not json",
        ] {
            XCTAssertThrowsError(try LibraryInterchange.importData(Data(invalid.utf8), into: context))
            XCTAssertEqual(try LibraryInterchange.exportData(from: context), legacy)
        }
        let retained = try XCTUnwrap(context.fetch(FetchDescriptor<PromptEntry>()).first)
        let store = WorkbenchStore(provider: RecordedAnthropicProviderClient())
        store.loadPrompt(retained)
        store.draft = "Revised legacy content"
        _ = try store.saveCurrentPrompt(modelContext: context)
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: LibraryInterchange.exportData(from: context)) as? [String: Any])
        let library = try XCTUnwrap(root["library"] as? [[String: Any]])
        let history = try XCTUnwrap(library[0]["versions"] as? [[String: Any]])
        XCTAssertEqual(history.last?["id"] as? String, "legacy-v1")
        XCTAssertEqual(history.last?["enhanced"] as? String, "Legacy content")
        XCTAssertEqual(history.last?["original"] as? String, "Legacy content")
    }

    @MainActor
    func testNativeDeletionAndExplicitBackupRestorePreserveIdentity() throws {
        let data = try Data(contentsOf: XCTUnwrap(Bundle(for: Self.self).url(
            forResource: "promptlab-library-v2", withExtension: "json"
        )))
        let container = try makeInMemoryContainer()
        let context = ModelContext(container)
        _ = try LibraryInterchange.importData(data, into: context)
        let child = try XCTUnwrap(context.fetch(FetchDescriptor<PromptEntry>()).first { $0.id == "contract-child" })
        context.delete(child)
        try context.save()
        let exportRoot = try XCTUnwrap(JSONSerialization.jsonObject(with: LibraryInterchange.exportData(from: context)) as? [String: Any])
        XCTAssertEqual((exportRoot["library"] as? [[String: Any]])?.compactMap { $0["id"] as? String }, ["contract-parent"])
        _ = try LibraryInterchange.importData(data, into: context)
        XCTAssertEqual(try LibraryInterchange.exportData(from: context), data)
        XCTAssertEqual(try context.fetchCount(FetchDescriptor<PromptEntry>()), 2)
    }

    @MainActor
    func testOlderImportedCreationDateIsRecoveredFromRawSourceOnExport() throws {
        let container = try makeInMemoryContainer()
        let context = ModelContext(container)
        let raw = Data(#"{"id":"old-import","original":"Original","enhanced":"Original","createdAt":"2025-01-01T00:00:00.123Z"}"#.utf8)
        context.insert(PromptEntry(
            id: "old-import", title: "Old import", original: "Original", enhanced: "Native revision",
            createdAt: .now, rawJSON: raw, isDirty: true
        ))
        try context.save()
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: LibraryInterchange.exportData(from: context)) as? [String: Any])
        let library = try XCTUnwrap(root["library"] as? [[String: Any]])
        XCTAssertEqual(library[0]["createdAt"] as? String, "2025-01-01T00:00:00.123Z")
        XCTAssertEqual(library[0]["enhanced"] as? String, "Native revision")
    }

    @MainActor
    func testNativeParentEditKeepsTheFollowUpSourceVersion() throws {
        let data = try Data(contentsOf: XCTUnwrap(Bundle(for: Self.self).url(
            forResource: "promptlab-library-v2", withExtension: "json"
        )))
        let container = try makeInMemoryContainer()
        let context = ModelContext(container)
        _ = try LibraryInterchange.importData(data, into: context)
        let parent = try XCTUnwrap(context.fetch(FetchDescriptor<PromptEntry>()).first { $0.id == "contract-parent" })
        let store = WorkbenchStore(provider: RecordedAnthropicProviderClient())
        store.loadPrompt(parent)
        store.draft = "Native revision of the parent prompt."
        _ = try store.saveCurrentPrompt(modelContext: context)
        let exported = try LibraryInterchange.exportData(from: context)
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: exported) as? [String: Any])
        let library = try XCTUnwrap(root["library"] as? [[String: Any]])
        let edited = try XCTUnwrap(library.first { $0["id"] as? String == "contract-parent" })
        XCTAssertNotEqual(edited["currentVersionId"] as? String, "parent-v2")
        let versions = try XCTUnwrap(edited["versions"] as? [[String: Any]])
        XCTAssertEqual(versions.last?["id"] as? String, "parent-v2")
        XCTAssertEqual(versions.last?["enhanced"] as? String, "Summarize {{incident}} with impact and actions.")
        let childMetadata = try XCTUnwrap(library[0]["metadata"] as? [String: Any])
        let origin = try XCTUnwrap(childMetadata["followUpOrigin"] as? [String: Any])
        XCTAssertEqual(origin["sourcePromptVersionId"] as? String, "parent-v2")
        _ = try store.saveCurrentPrompt(modelContext: context)
        let repeated = try XCTUnwrap(JSONSerialization.jsonObject(with: LibraryInterchange.exportData(from: context)) as? [String: Any])
        let repeatedLibrary = try XCTUnwrap(repeated["library"] as? [[String: Any]])
        XCTAssertEqual(repeatedLibrary[1]["currentVersionId"] as? String, edited["currentVersionId"] as? String)
        XCTAssertEqual(repeatedLibrary[1]["versions"] as? NSArray, versions as NSArray)
        let attachment = XCTAttachment(data: exported, uniformTypeIdentifier: "public.json")
        attachment.name = "native-parent-edit-contract.json"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

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
        let origin = try XCTUnwrap(metadata["followUpOrigin"] as? [String: Any])
        XCTAssertEqual(origin["sourceRunId"] as? String, "external-run")
        XCTAssertEqual(root["collections"] as? [String], ["Operations", "Empty Collection"])

        prompt.enhanced = "Summarize {{incident}} for leadership with owners and follow-up dates."
        prompt.notes = "Revised for accountable follow-up."
        prompt.variants = [
            PromptVariant(label: "Brief", content: "Summarize {{incident}} in three bullets."),
            PromptVariant(label: "Actions", content: "List owners and dated next steps for {{incident}}."),
        ]
        prompt.tags = ["Writing", "System"]
        prompt.updatedAt = Date(timeIntervalSince1970: 1_786_000_000)
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
        let editedOrigin = try XCTUnwrap(editedMetadata["followUpOrigin"] as? [String: Any])
        XCTAssertEqual(editedOrigin["sourceRunId"] as? String, "external-run")
        XCTAssertEqual(editedOrigin["generationModel"] as? String, "fixture-model")
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
    func testSwitchingPromptsRecordsOriginalAttemptWithoutClobberingNewEditor() async throws {
        let container = try makeInMemoryContainer()
        let context = ModelContext(container)
        let store = WorkbenchStore(provider: SlowProviderClient())
        let original = PromptEntry(title: "Original title", original: "Original input")
        let next = PromptEntry(title: "Next title", original: "Next input")
        store.loadPrompt(original)
        store.selectedMode = .concise
        store.startEnhance(modelContext: context)
        try await waitUntil { !store.streamedText.isEmpty }

        store.loadPrompt(next)
        store.selectedMode = .code
        store.startEnhance(modelContext: context)
        try await waitUntil {
            (try? context.fetchCount(FetchDescriptor<RunRecord>())) == 1 && store.state == .inFlight
        }
        let runs = try context.fetch(FetchDescriptor<RunRecord>())
        XCTAssertEqual(runs.first?.promptId, original.id)
        XCTAssertEqual(runs.first?.promptTitle, "Original title")
        XCTAssertEqual(runs.first?.input, "Original input")
        XCTAssertEqual(runs.first?.enhanceMode, "concise")
        XCTAssertEqual(runs.first?.status, "canceled")
        XCTAssertEqual(store.currentPromptID, next.id)
        XCTAssertEqual(store.draft, "Next input")
        XCTAssertEqual(store.selectedMode, .code)
        XCTAssertEqual(store.state, .inFlight)
        // The old task's cleanup must not clear the new task's cancellation handle.
        store.cancelEnhance()
        try await waitUntil { store.state == .canceled }
        XCTAssertEqual(try context.fetchCount(FetchDescriptor<RunRecord>()), 2)
    }

    @MainActor
    func testNavigationDuringEnhancePreservesNewAndHistoricalEditorState() async throws {
        for openHistory in [false, true] {
            let container = try makeInMemoryContainer()
            let context = ModelContext(container)
            let store = WorkbenchStore(provider: SlowProviderClient())
            let original = PromptEntry(title: "Original", original: "Original input")
            store.loadPrompt(original)
            store.startEnhance(modelContext: context)
            try await waitUntil { !store.streamedText.isEmpty }
            if openHistory {
                let history = RunRecord(promptId: "history-parent", promptTitle: "Historical",
                                        enhanceMode: "code", provider: "fixture", model: "fixture",
                                        input: "Historical input", output: "Historical output", latencyMs: 1, notes: "Fixture")
                store.loadRun(history)
            } else {
                store.startNewPrompt()
            }
            try await waitUntil { (try? context.fetchCount(FetchDescriptor<RunRecord>())) == 1 }
            XCTAssertEqual(store.state, .idle)
            XCTAssertEqual(store.currentPromptID, openHistory ? "history-parent" : nil)
            XCTAssertEqual(store.draft, openHistory ? "Historical input" : "")
            XCTAssertTrue(store.streamedText.isEmpty)
            let runs = try context.fetch(FetchDescriptor<RunRecord>())
            XCTAssertEqual(runs.first?.promptId, original.id)
            XCTAssertEqual(runs.first?.status, "canceled")
        }
    }

    @MainActor
    func testEditingDraftInvalidatesTheStreamAndKeepsOriginalHistory() async throws {
        let container = try makeInMemoryContainer()
        let context = ModelContext(container)
        let store = WorkbenchStore(provider: SlowProviderClient())
        store.draft = "Original input"
        store.startEnhance(modelContext: context)
        try await waitUntil { !store.streamedText.isEmpty }
        store.draft = "Edited input"
        try await waitUntil { (try? context.fetchCount(FetchDescriptor<RunRecord>())) == 1 }
        XCTAssertEqual(store.state, .idle)
        XCTAssertEqual(store.draft, "Edited input")
        XCTAssertTrue(store.streamedText.isEmpty)
        XCTAssertNil(store.result)
        let runs = try context.fetch(FetchDescriptor<RunRecord>())
        XCTAssertEqual(runs.first?.input, "Original input")
        XCTAssertEqual(runs.first?.status, "canceled")
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
