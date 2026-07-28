import Foundation
import SwiftData

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
