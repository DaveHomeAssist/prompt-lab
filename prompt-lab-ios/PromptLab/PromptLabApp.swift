import SwiftData
import SwiftUI

@main
struct PromptLabApp: App {
    private let modelContainer: ModelContainer

    init() {
        let schema = Schema(versionedSchema: PromptLabSchemaV2.self)
        let isUITesting = ProcessInfo.processInfo.arguments.contains("-uiTesting")
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
        do {
            modelContainer = try ModelContainer(
                for: schema,
                migrationPlan: PromptLabMigrationPlan.self,
                configurations: [configuration]
            )
        } catch {
            fatalError("Unable to initialize Prompt Lab storage: \(error.localizedDescription)")
        }
    }

    var body: some Scene {
        WindowGroup {
            rootView
        }
        .modelContainer(modelContainer)
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
