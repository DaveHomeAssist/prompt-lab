import Foundation
import SwiftData

@Model
final class RunRecord {
    @Attribute(.unique) var id: String
    var createdAt: Date
    var promptId: String?
    var promptVersionId: String?
    var promptTitle: String
    var mode: String
    var enhanceMode: String
    var provider: String
    var model: String
    var variantLabel: String
    var input: String
    var output: String
    var latencyMs: Int
    var verdict: String?
    var notes: String
    var status: String
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
