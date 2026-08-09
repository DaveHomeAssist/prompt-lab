import Foundation
import SwiftData
import SwiftUI
import UniformTypeIdentifiers

struct LibraryJSONDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }

    var data: Data

    init(data: Data = Data()) {
        self.data = data
    }

    init(configuration: ReadConfiguration) throws {
        guard let contents = configuration.file.regularFileContents else {
            throw LibraryInterchangeError.unreadableDocument
        }
        data = contents
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}

struct LibraryImportSummary: Equatable {
    let promptCount: Int
    let collectionCount: Int
}

enum LibraryInterchangeError: LocalizedError, Equatable {
    case unreadableDocument
    case invalidRoot
    case missingLibrary
    case invalidEntry(Int)
    case duplicateID(String)
    case emptyPrompt(Int)

    var errorDescription: String? {
        switch self {
        case .unreadableDocument:
            "The selected file could not be read."
        case .invalidRoot:
            "The selected file is not valid Prompt Lab JSON."
        case .missingLibrary:
            "The selected file does not contain a prompt library."
        case let .invalidEntry(index):
            "Library entry \(index + 1) is not a JSON object."
        case let .duplicateID(id):
            "The library contains the duplicate prompt ID \(id)."
        case let .emptyPrompt(index):
            "Library entry \(index + 1) has no prompt content."
        }
    }
}

@MainActor
enum LibraryInterchange {
    static func importData(_ data: Data, into modelContext: ModelContext) throws -> LibraryImportSummary {
        let root: Any
        do {
            root = try JSONSerialization.jsonObject(with: data)
        } catch {
            throw LibraryInterchangeError.invalidRoot
        }

        let rawEntries: [Any]
        let collections: [String]
        if let envelope = root as? [String: Any] {
            guard let library = envelope["library"] as? [Any] else {
                throw LibraryInterchangeError.missingLibrary
            }
            rawEntries = library
            collections = (envelope["collections"] as? [Any] ?? []).compactMap { $0 as? String }
        } else if let library = root as? [Any] {
            rawEntries = library
            collections = []
        } else {
            throw LibraryInterchangeError.invalidRoot
        }

        var seenIDs = Set<String>()
        let prepared: [PromptEntry] = try rawEntries.enumerated().map { index, rawEntry in
            guard let object = rawEntry as? [String: Any], JSONSerialization.isValidJSONObject(object) else {
                throw LibraryInterchangeError.invalidEntry(index)
            }
            let original = string(object["original"])
            let enhanced = string(object["enhanced"]).isEmpty
                ? (string(object["prompt"]).isEmpty ? original : string(object["prompt"]))
                : string(object["enhanced"])
            guard !enhanced.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw LibraryInterchangeError.emptyPrompt(index)
            }
            let id = string(object["id"]).isEmpty ? UUID().uuidString : string(object["id"])
            guard seenIDs.insert(id).inserted else {
                throw LibraryInterchangeError.duplicateID(id)
            }
            let title = string(object["title"]).trimmingCharacters(in: .whitespacesAndNewlines)
            let rawJSON = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
            return PromptEntry(
                id: id,
                title: title.isEmpty ? "Untitled Prompt" : title,
                original: original,
                enhanced: enhanced,
                createdAt: parseDate(string(object["createdAt"])) ?? .now,
                rawJSON: rawJSON,
                sourceIndex: index,
                isDirty: false
            )
        }

        do {
            try modelContext.fetch(FetchDescriptor<PromptEntry>()).forEach(modelContext.delete)
            try modelContext.fetch(FetchDescriptor<LibraryMetadata>()).forEach(modelContext.delete)
            prepared.forEach(modelContext.insert)
            modelContext.insert(LibraryMetadata(rawDocument: data))
            try modelContext.save()
        } catch {
            modelContext.rollback()
            throw error
        }

        return LibraryImportSummary(promptCount: prepared.count, collectionCount: collections.count)
    }

    static func exportData(from modelContext: ModelContext) throws -> Data {
        let descriptor = FetchDescriptor<PromptEntry>(sortBy: [SortDescriptor(\.sourceIndex)])
        let entries = try modelContext.fetch(descriptor)
        let metadata = try modelContext.fetch(FetchDescriptor<LibraryMetadata>()).first

        if let metadata, canReturnOriginal(metadata.rawDocument, entries: entries) {
            return metadata.rawDocument
        }

        var envelope = decodedEnvelope(metadata?.rawDocument) ?? [
            "version": "1.7.0",
            "schemaVersion": 1,
            "exportedAt": ISO8601DateFormatter().string(from: .now),
            "collections": [],
        ]
        envelope["library"] = try entries.map(exportObject)
        envelope["count"] = entries.count
        return try JSONSerialization.data(
            withJSONObject: envelope,
            options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        )
    }

    private static func canReturnOriginal(_ data: Data, entries: [PromptEntry]) -> Bool {
        guard !data.isEmpty,
              entries.allSatisfy({ !$0.isDirty }),
              let root = try? JSONSerialization.jsonObject(with: data) else {
            return false
        }
        let originalEntries: [Any]
        if let envelope = root as? [String: Any], let library = envelope["library"] as? [Any] {
            originalEntries = library
        } else if let library = root as? [Any] {
            originalEntries = library
        } else {
            return false
        }
        let originalIDs = originalEntries.compactMap { ($0 as? [String: Any])?["id"] as? String }
        return originalEntries.count == entries.count && originalIDs == entries.map(\.id)
    }

    private static func decodedEnvelope(_ data: Data?) -> [String: Any]? {
        guard let data, !data.isEmpty,
              let object = try? JSONSerialization.jsonObject(with: data),
              let envelope = object as? [String: Any] else {
            return nil
        }
        return envelope
    }

    private static func exportObject(_ entry: PromptEntry) throws -> [String: Any] {
        var object: [String: Any] = [:]
        if !entry.rawJSON.isEmpty,
           let raw = try? JSONSerialization.jsonObject(with: entry.rawJSON) as? [String: Any] {
            object = raw
        }
        object["id"] = entry.id
        object["title"] = entry.title
        object["original"] = entry.original
        object["enhanced"] = entry.enhanced
        return object
    }

    private static func string(_ value: Any?) -> String {
        value as? String ?? ""
    }

    private static func parseDate(_ value: String) -> Date? {
        guard !value.isEmpty else { return nil }
        return ISO8601DateFormatter().date(from: value)
    }
}
