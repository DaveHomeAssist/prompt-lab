import SwiftData
import SwiftUI

@main
struct PromptLabApp: App {
    var body: some Scene {
        WindowGroup {
            rootView
        }
        .modelContainer(for: [PromptEntry.self, Pad.self, RunRecord.self, LibraryMetadata.self])
    }

    @ViewBuilder
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
