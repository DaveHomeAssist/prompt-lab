import Foundation
import SwiftData

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
