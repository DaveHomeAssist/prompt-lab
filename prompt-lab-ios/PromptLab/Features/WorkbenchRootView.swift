import SwiftUI

struct WorkbenchRootView: View {
    @State private var store = WorkbenchStore()

    var body: some View {
        NavigationSplitView(columnVisibility: $store.columnVisibility) {
            SidebarView()
        } content: {
            EditorView(draft: $store.draft)
        } detail: {
            ResultsView()
        }
        .navigationSplitViewStyle(.balanced)
    }
}

private struct SidebarView: View {
    var body: some View {
        List {
            Section("Workbench") {
                Label("Library", systemImage: "books.vertical")
                Label("Pads", systemImage: "note.text")
                Label("Runs", systemImage: "clock.arrow.circlepath")
            }
        }
        .navigationTitle("Prompt Lab")
    }
}

private struct EditorView: View {
    @Binding var draft: String

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Editor")
                .font(.title2.bold())
            TextEditor(text: $draft)
                .font(.body.monospaced())
                .padding(8)
                .background(.background.secondary, in: RoundedRectangle(cornerRadius: 12))
                .overlay {
                    if draft.isEmpty {
                        ContentUnavailableView(
                            "Start a prompt",
                            systemImage: "square.and.pencil",
                            description: Text("Write or paste a prompt here.")
                        )
                        .allowsHitTesting(false)
                    }
                }
        }
        .padding()
        .navigationTitle("Editor")
    }
}

private struct ResultsView: View {
    var body: some View {
        ContentUnavailableView(
            "No result yet",
            systemImage: "sparkles",
            description: Text("Enhanced prompts will appear here.")
        )
        .navigationTitle("Results")
    }
}
