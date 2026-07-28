import SwiftData
import XCTest
@testable import PromptLab

final class PromptLabTests: XCTestCase {
    @MainActor
    func testRecordedEnhancePersistsRunAcrossContainerReopen() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PromptLabTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let storeURL = directory.appendingPathComponent("PromptLab.store")
        let schema = Schema([PromptEntry.self, Pad.self, RunRecord.self])
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
}
