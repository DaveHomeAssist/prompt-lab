import Observation
import SwiftUI

@MainActor
@Observable
final class WorkbenchStore {
    var columnVisibility: NavigationSplitViewVisibility = .all
    var draft = ""
}
