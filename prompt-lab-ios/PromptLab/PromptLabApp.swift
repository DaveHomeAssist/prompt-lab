import os
import SwiftData
import SwiftUI
import UniformTypeIdentifiers

private let storageLog = Logger(subsystem: "com.davehomeassist.promptlab", category: "storage")

struct StorageLaunch {
    var container: ModelContainer?
    var storeURL: URL
    var message: String?

    static func make(isUITesting: Bool = ProcessInfo.processInfo.arguments.contains("-uiTesting")) -> StorageLaunch {
        let schema = Schema(versionedSchema: PromptLabSchemaV2.self)
        if !isUITesting,
           let applicationSupport = FileManager.default.urls(
               for: .applicationSupportDirectory,
               in: .userDomainMask
           ).first {
            try? FileManager.default.createDirectory(
                at: applicationSupport,
                withIntermediateDirectories: true
            )
        }
        let configuration = ModelConfiguration(schema: schema, isStoredInMemoryOnly: isUITesting)
        return open(configuration)
    }

    static func open(_ configuration: ModelConfiguration) -> StorageLaunch {
        let schema = Schema(versionedSchema: PromptLabSchemaV2.self)
        do {
            let container = try ModelContainer(
                for: schema,
                migrationPlan: PromptLabMigrationPlan.self,
                configurations: [configuration]
            )
            return StorageLaunch(container: container, storeURL: configuration.url, message: nil)
        } catch {
            storageLog.error("Unable to open the library store")
            return StorageLaunch(
                container: nil,
                storeURL: configuration.url,
                message: error.localizedDescription
            )
        }
    }
}

enum StorageRecovery {
    static func storeFileURLs(for storeURL: URL) -> [URL] {
        [
            storeURL,
            URL(fileURLWithPath: storeURL.path + "-wal"),
            URL(fileURLWithPath: storeURL.path + "-shm"),
        ]
    }

    static func exportStore(at storeURL: URL, to directory: URL, fileManager: FileManager = .default) throws -> [URL] {
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        var copied: [URL] = []
        for source in storeFileURLs(for: storeURL) where fileManager.fileExists(atPath: source.path) {
            let destination = directory.appendingPathComponent(source.lastPathComponent)
            if fileManager.fileExists(atPath: destination.path) {
                try fileManager.removeItem(at: destination)
            }
            try fileManager.copyItem(at: source, to: destination)
            copied.append(destination)
        }
        return copied
    }

    static func resetStore(at storeURL: URL, fileManager: FileManager = .default) throws {
        for url in storeFileURLs(for: storeURL) where fileManager.fileExists(atPath: url.path) {
            try fileManager.removeItem(at: url)
        }
    }

    /// Every store file that exists, including the write-ahead log and shared-memory sidecar.
    static func archiveFiles(at storeURL: URL, fileManager: FileManager = .default) throws -> [String: Data] {
        let directory = fileManager.temporaryDirectory
            .appendingPathComponent("PromptLabStore-\(UUID().uuidString)", isDirectory: true)
        defer { try? fileManager.removeItem(at: directory) }
        var entries: [String: Data] = [:]
        for url in try exportStore(at: storeURL, to: directory, fileManager: fileManager) {
            entries[url.lastPathComponent] = try Data(contentsOf: url)
        }
        if entries.isEmpty {
            throw CocoaError(.fileReadNoSuchFile)
        }
        return entries
    }

    /// Stored (uncompressed) zip of the complete store set the recovery screen saves.
    static func exportDocumentData(at storeURL: URL, fileManager: FileManager = .default) throws -> Data {
        try zip(archiveFiles(at: storeURL, fileManager: fileManager))
    }

    static func zip(_ entries: [String: Data]) -> Data {
        var archive = Data()
        var central = Data()
        var offset: UInt32 = 0
        for name in entries.keys.sorted() {
            let payload = entries[name] ?? Data()
            let nameData = Data(name.utf8)
            let checksum = crc32(payload)
            let size = UInt32(payload.count)
            var local = Data()
            append(&local, UInt32(0x0403_4b50))
            append(&local, UInt16(20))
            append(&local, UInt16(0))
            append(&local, UInt16(0))
            append(&local, UInt16(0))
            append(&local, UInt16(0))
            append(&local, checksum)
            append(&local, size)
            append(&local, size)
            append(&local, UInt16(nameData.count))
            append(&local, UInt16(0))
            local.append(nameData)
            local.append(payload)
            archive.append(local)

            var header = Data()
            append(&header, UInt32(0x0201_4b50))
            append(&header, UInt16(20))
            append(&header, UInt16(20))
            append(&header, UInt16(0))
            append(&header, UInt16(0))
            append(&header, UInt16(0))
            append(&header, UInt16(0))
            append(&header, checksum)
            append(&header, size)
            append(&header, size)
            append(&header, UInt16(nameData.count))
            append(&header, UInt16(0))
            append(&header, UInt16(0))
            append(&header, UInt16(0))
            append(&header, UInt16(0))
            append(&header, UInt32(0))
            append(&header, offset)
            header.append(nameData)
            central.append(header)
            offset += UInt32(local.count)
        }
        let centralOffset = UInt32(archive.count)
        archive.append(central)
        var end = Data()
        append(&end, UInt32(0x0605_4b50))
        append(&end, UInt16(0))
        append(&end, UInt16(0))
        append(&end, UInt16(entries.count))
        append(&end, UInt16(entries.count))
        append(&end, UInt32(central.count))
        append(&end, centralOffset)
        append(&end, UInt16(0))
        archive.append(end)
        return archive
    }

    static func readStoredZip(_ archive: Data) -> [String: Data] {
        var entries: [String: Data] = [:]
        var cursor = 0
        let bytes = [UInt8](archive)
        func read16(_ index: Int) -> UInt16 {
            UInt16(bytes[index]) | (UInt16(bytes[index + 1]) << 8)
        }
        func read32(_ index: Int) -> UInt32 {
            UInt32(bytes[index]) | (UInt32(bytes[index + 1]) << 8) | (UInt32(bytes[index + 2]) << 16) | (UInt32(bytes[index + 3]) << 24)
        }
        while cursor + 30 <= bytes.count {
            let signature = read32(cursor)
            if signature != 0x0403_4b50 { break }
            let method = read16(cursor + 8)
            let size = Int(read32(cursor + 18))
            let nameLength = Int(read16(cursor + 26))
            let extraLength = Int(read16(cursor + 28))
            let nameStart = cursor + 30
            let dataStart = nameStart + nameLength + extraLength
            guard method == 0, dataStart + size <= bytes.count else { break }
            let name = String(decoding: bytes[nameStart..<(nameStart + nameLength)], as: UTF8.self)
            entries[name] = Data(bytes[dataStart..<(dataStart + size)])
            cursor = dataStart + size
        }
        return entries
    }
}

private func crc32(_ data: Data) -> UInt32 {
    var crc: UInt32 = 0xFFFF_FFFF
    for byte in data {
        crc ^= UInt32(byte)
        for _ in 0..<8 {
            let mask: UInt32 = (crc & 1) == 1 ? 0xEDB8_8320 : 0
            crc = (crc >> 1) ^ mask
        }
    }
    return crc ^ 0xFFFF_FFFF
}

private func append(_ data: inout Data, _ value: UInt16) {
    data.append(UInt8(value & 0xFF))
    data.append(UInt8((value >> 8) & 0xFF))
}

private func append(_ data: inout Data, _ value: UInt32) {
    append(&data, UInt16(value & 0xFFFF))
    append(&data, UInt16((value >> 16) & 0xFFFF))
}

private struct StoreFileDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.zip] }
    var data: Data

    init(data: Data) { self.data = data }

    init(configuration: ReadConfiguration) throws {
        data = configuration.file.regularFileContents ?? Data()
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}

struct StorageRecoveryView: View {
    let storeURL: URL
    let message: String
    var retry: () -> Void

    @State private var notice = ""
    @State private var exportDocument: StoreFileDocument?
    @State private var showExporter = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Library storage could not be opened")
                .font(.title2.weight(.semibold))
            Text(message)
            Text("The store is still on this device. Export a copy, including its write-ahead files, or reset storage and start with an empty library.")
                .foregroundStyle(.secondary)
            if !notice.isEmpty {
                Text(notice)
            }
            HStack {
                Button("Export store") { exportStore() }
                Button("Reset storage", role: .destructive) { resetStore() }
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .fileExporter(
            isPresented: $showExporter,
            document: exportDocument,
            contentType: .zip,
            defaultFilename: "PromptLabStore.zip"
        ) { result in
            if case .failure(let error) = result {
                notice = error.localizedDescription
            }
        }
    }

    private func exportStore() {
        do {
            exportDocument = StoreFileDocument(data: try StorageRecovery.exportDocumentData(at: storeURL))
            showExporter = true
        } catch {
            notice = error.localizedDescription
        }
    }

    private func resetStore() {
        do {
            try StorageRecovery.resetStore(at: storeURL)
            retry()
        } catch {
            notice = error.localizedDescription
        }
    }
}

@main
struct PromptLabApp: App {
    @State private var launch = StorageLaunch.make()

    var body: some Scene {
        WindowGroup {
            if let container = launch.container {
                rootView
                    .modelContainer(container)
            } else {
                StorageRecoveryView(
                    storeURL: launch.storeURL,
                    message: launch.message ?? "Prompt Lab could not open its library."
                ) {
                    launch = StorageLaunch.make()
                }
            }
        }
    }

    @MainActor @ViewBuilder
    private var rootView: some View {
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("-recordedAnthropic") {
            WorkbenchRootView(
                provider: RecordedAnthropicProviderClient(),
                runRecordedDemo: arguments.contains("-runRecordedDemo")
            )
        } else {
            WorkbenchRootView()
        }
        #else
        WorkbenchRootView()
        #endif
    }
}
