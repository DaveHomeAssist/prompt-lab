import Foundation
import SwiftData

@Model
final class RunRecord {
    @Attribute(.unique) var id: UUID
    var createdAt: Date
    var input: String
    var output: String
    var status: String

    init(
        id: UUID = UUID(),
        createdAt: Date = .now,
        input: String,
        output: String,
        status: String
    ) {
        self.id = id
        self.createdAt = createdAt
        self.input = input
        self.output = output
        self.status = status
    }
}
