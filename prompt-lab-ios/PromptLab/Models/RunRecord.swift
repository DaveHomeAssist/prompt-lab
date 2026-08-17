import Foundation
import SwiftData

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
    var responseJSON: Data?
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
        response: EnhanceResponse? = nil,
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
        responseJSON = response.flatMap { try? JSONEncoder().encode($0) }
        self.testCaseId = testCaseId
        self.goldenScore = goldenScore
    }
}

extension RunRecord {
    var response: EnhanceResponse? {
        get {
            guard let responseJSON else { return nil }
            return try? JSONDecoder().decode(EnhanceResponse.self, from: responseJSON)
        }
        set {
            responseJSON = newValue.flatMap { try? JSONEncoder().encode($0) }
        }
    }

    /// `failed` shipped in the first prototype. Keep those records readable,
    /// but expose the web contract's canonical `error` status everywhere new.
    var canonicalStatus: String {
        status == "failed" ? "error" : status
    }
}
