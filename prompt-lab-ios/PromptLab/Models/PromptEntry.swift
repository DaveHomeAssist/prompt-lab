import Foundation
import SwiftData

@Model
final class PromptEntry {
    @Attribute(.unique) var id: UUID
    var title: String
    var original: String
    var enhanced: String
    var createdAt: Date

    init(
        id: UUID = UUID(),
        title: String,
        original: String,
        enhanced: String = "",
        createdAt: Date = .now
    ) {
        self.id = id
        self.title = title
        self.original = original
        self.enhanced = enhanced
        self.createdAt = createdAt
    }
}
