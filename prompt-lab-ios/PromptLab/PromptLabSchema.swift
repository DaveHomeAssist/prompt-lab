import Foundation
import SwiftData

// Preserve the shipped prototype schema so upgrades are tested against the
// store shape that existing installs actually have, not a current-schema mock.
enum PromptLabSchemaV1: VersionedSchema {
    static let versionIdentifier = Schema.Version(1, 0, 0)
    static var models: [any PersistentModel.Type] {
        [PromptEntry.self, Pad.self, RunRecord.self, LibraryMetadata.self]
    }

    @Model
    final class PromptEntry {
        @Attribute(.unique) var id: String = UUID().uuidString
        var title: String = "Untitled Prompt"
        var original: String = ""
        var enhanced: String = ""
        var createdAt: Date = Date.now
        var rawJSON: Data = Data()
        var sourceIndex: Int = 0
        var isDirty: Bool = false

        init(
            id: String = UUID().uuidString,
            title: String,
            original: String,
            enhanced: String = "",
            createdAt: Date = .now,
            rawJSON: Data = Data(),
            sourceIndex: Int = 0,
            isDirty: Bool = false
        ) {
            self.id = id
            self.title = title
            self.original = original
            self.enhanced = enhanced
            self.createdAt = createdAt
            self.rawJSON = rawJSON
            self.sourceIndex = sourceIndex
            self.isDirty = isDirty
        }
    }

    @Model
    final class Pad {
        @Attribute(.unique) var id: UUID
        var title: String
        var content: String
        var updatedAt: Date

        init(id: UUID = UUID(), title: String, content: String = "", updatedAt: Date = .now) {
            self.id = id
            self.title = title
            self.content = content
            self.updatedAt = updatedAt
        }
    }

    @Model
    final class RunRecord {
        @Attribute(.unique) var id: String = UUID().uuidString
        var createdAt: Date = Date.now
        var promptId: String?
        var promptVersionId: String?
        var promptTitle: String = "Untitled prompt"
        var mode: String = "enhance"
        var enhanceMode: String = "balanced"
        var provider: String = "unknown"
        var model: String = "unknown"
        var variantLabel: String = ""
        var input: String = ""
        var output: String = ""
        var latencyMs: Int = 0
        var verdict: String?
        var notes: String = ""
        var status: String = "success"
        var testCaseId: String?
        var goldenScore: Double?

        init(
            id: String = UUID().uuidString,
            createdAt: Date = .now,
            promptId: String? = nil,
            promptVersionId: String? = nil,
            promptTitle: String = "Untitled prompt",
            mode: String = "enhance",
            enhanceMode: String,
            provider: String,
            model: String,
            variantLabel: String = "",
            input: String,
            output: String,
            latencyMs: Int,
            verdict: String? = nil,
            notes: String,
            status: String = "success",
            testCaseId: String? = nil,
            goldenScore: Double? = nil
        ) {
            self.id = id
            self.createdAt = createdAt
            self.promptId = promptId
            self.promptVersionId = promptVersionId
            self.promptTitle = promptTitle
            self.mode = mode
            self.enhanceMode = enhanceMode
            self.provider = provider
            self.model = model
            self.variantLabel = variantLabel
            self.input = input
            self.output = output
            self.latencyMs = latencyMs
            self.verdict = verdict
            self.notes = notes
            self.status = status
            self.testCaseId = testCaseId
            self.goldenScore = goldenScore
        }
    }

    @Model
    final class LibraryMetadata {
        @Attribute(.unique) var id: String = "active-library"
        var rawDocument: Data = Data()
        var importedAt: Date = Date.now

        init(
            id: String = "active-library",
            rawDocument: Data,
            importedAt: Date = .now
        ) {
            self.id = id
            self.rawDocument = rawDocument
            self.importedAt = importedAt
        }
    }
}

private typealias CurrentPromptEntry = PromptEntry
private typealias CurrentPad = Pad
private typealias CurrentRunRecord = RunRecord
private typealias CurrentLibraryMetadata = LibraryMetadata

enum PromptLabSchemaV2: VersionedSchema {
    static let versionIdentifier = Schema.Version(2, 0, 0)
    static var models: [any PersistentModel.Type] {
        [CurrentPromptEntry.self, CurrentPad.self, CurrentRunRecord.self, CurrentLibraryMetadata.self]
    }
}

enum PromptLabMigrationPlan: SchemaMigrationPlan {
    static var schemas: [any VersionedSchema.Type] {
        [PromptLabSchemaV1.self, PromptLabSchemaV2.self]
    }

    static var stages: [MigrationStage] {
        [
            .lightweight(
                fromVersion: PromptLabSchemaV1.self,
                toVersion: PromptLabSchemaV2.self
            ),
        ]
    }
}
