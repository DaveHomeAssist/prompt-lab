import SwiftData
import SwiftUI

@main
struct PromptLabApp: App {
    var body: some Scene {
        WindowGroup {
            WorkbenchRootView()
        }
        .modelContainer(for: [PromptEntry.self, Pad.self, RunRecord.self])
    }
}
