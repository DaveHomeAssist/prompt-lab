import Foundation
import SwiftData

@Model
final class PromptEntry {
    @Attribute(.unique) var id: String = UUID().uuidString
    var title: String = "Untitled Prompt"
    var original: String = ""
    var enhanced: String = ""
    var notes: String = ""
    var variantsData: Data = Data()
    var tagsData: Data = Data()
    var createdAt: Date = Date.now
    var updatedAt: Date = Date.now
    var rawJSON: Data = Data()
    var sourceIndex: Int = 0
    var isDirty: Bool = false

    init(
        id: String = UUID().uuidString,
        title: String,
        original: String,
        enhanced: String = "",
        notes: String = "",
        variants: [PromptVariant] = [],
        tags: [String] = [],
        createdAt: Date = .now,
        updatedAt: Date? = nil,
        rawJSON: Data = Data(),
        sourceIndex: Int = 0,
        isDirty: Bool = false
    ) {
        self.id = id
        self.title = title
        self.original = original
        self.enhanced = enhanced
        self.notes = notes
        variantsData = (try? JSONEncoder().encode(variants)) ?? Data()
        tagsData = (try? JSONEncoder().encode(tags)) ?? Data()
        self.createdAt = createdAt
        self.updatedAt = updatedAt ?? createdAt
        self.rawJSON = rawJSON
        self.sourceIndex = sourceIndex
        self.isDirty = isDirty
    }
}

extension PromptEntry {
    var variants: [PromptVariant] {
        get { (try? JSONDecoder().decode([PromptVariant].self, from: variantsData)) ?? [] }
        set { variantsData = (try? JSONEncoder().encode(newValue)) ?? Data() }
    }

    var tags: [String] {
        get { (try? JSONDecoder().decode([String].self, from: tagsData)) ?? [] }
        set { tagsData = (try? JSONEncoder().encode(newValue)) ?? Data() }
    }
}
