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
}

private struct StoreFileDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.data] }
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
            Text("The store file is still on this device. Export a copy, or reset storage and start with an empty library.")
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
            contentType: .data,
            defaultFilename: "PromptLab.store"
        ) { result in
            if case .failure(let error) = result {
                notice = error.localizedDescription
            }
        }
    }

    private func exportStore() {
        do {
            let directory = FileManager.default.temporaryDirectory
                .appendingPathComponent("PromptLabStore-\(UUID().uuidString)", isDirectory: true)
            let copied = try StorageRecovery.exportStore(at: storeURL, to: directory)
            guard let primary = copied.first else {
                notice = "No store file was found to export."
                return
            }
            exportDocument = StoreFileDocument(data: try Data(contentsOf: primary))
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
