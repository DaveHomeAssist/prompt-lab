import Foundation
import SwiftData

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
