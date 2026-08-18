import XCTest

final class PromptLabUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-uiTesting", "-recordedAnthropic"]
    }

    func testColdLaunchOpensEditorAndNewPromptIsReachable() {
        app.launch()

        XCTAssertTrue(app.textViews["promptEditor"].waitForExistence(timeout: 5))
        XCTAssertTrue(
            app.descendants(matching: .any)["editorEmptyHint"].waitForExistence(timeout: 3)
        )
        openWorkspace()
        XCTAssertTrue(app.buttons["newPromptButton"].waitForExistence(timeout: 3))
        app.buttons["newPromptButton"].tap()
        XCTAssertTrue(app.textViews["promptEditor"].waitForExistence(timeout: 3))
    }

    func testForcedCompactLayoutOnAnyDeviceUsesEditorFirstFlow() {
        app.launchArguments.append("-forceCompactLayout")
        app.launch()

        XCTAssertTrue(app.textViews["promptEditor"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["workspaceButton"].waitForExistence(timeout: 3))
        app.buttons["workspaceButton"].tap()
        XCTAssertTrue(app.buttons["newPromptButton"].waitForExistence(timeout: 3))
    }

    func testRecordedEnhanceOpensResultsAndSupportsActions() {
        app.launchArguments.append("-runRecordedDemo")
        app.launch()

        waitForRecordedResults()
        XCTAssertTrue(app.buttons["useResultButton_Enhanced"].exists)
        XCTAssertTrue(app.buttons["copyResultButton_Enhanced"].exists)
        XCTAssertTrue(app.buttons["saveResultButton_Enhanced"].exists)
        XCTAssertTrue(app.buttons["shareResultButton_Enhanced"].exists)

        app.buttons["copyResultButton_Enhanced"].tap()
        XCTAssertEqual(app.descendants(matching: .any)["resultNotice"].label, "Copied to the clipboard.")
        app.buttons["saveResultButton_Enhanced"].tap()
        XCTAssertTrue(
            app.descendants(matching: .any)["resultNotice"].label.hasPrefix("Saved ")
        )
    }

    func testSavedPromptReopensAndRunDetailReusesInput() {
        app.launchArguments.append("-runRecordedDemo")
        app.launch()
        waitForRecordedResults()
        app.buttons["saveResultButton_Enhanced"].tap()

        openWorkspaceFromAnywhere()
        let prompt = app.buttons.matching(
            NSPredicate(format: "identifier BEGINSWITH 'libraryPrompt_'")
        ).firstMatch
        XCTAssertTrue(prompt.waitForExistence(timeout: 3))
        prompt.tap()
        XCTAssertTrue(app.textViews["promptEditor"].waitForExistence(timeout: 3))

        openWorkspace()
        let run = app.buttons.matching(
            NSPredicate(format: "identifier BEGINSWITH 'runRow_'")
        ).firstMatch
        XCTAssertTrue(run.waitForExistence(timeout: 3))
        run.tap()
        XCTAssertTrue(app.navigationBars["Run Detail"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["useRunOutputButton"].exists)
        XCTAssertTrue(app.staticTexts["Assumptions"].exists)
        XCTAssertTrue(app.staticTexts["Tags"].exists)
        app.buttons["Reuse Input"].tap()
        XCTAssertTrue(app.textViews["promptEditor"].waitForExistence(timeout: 3))
    }

    func testPrimarySurfacePassesAccessibilityAudit() throws {
        app.launch()
        XCTAssertTrue(app.textViews["promptEditor"].waitForExistence(timeout: 5))
        let auditTypes: [(name: String, type: XCUIAccessibilityAuditType)] = [
            ("Contrast", .contrast),
            ("Element Detection", .elementDetection),
            ("Hit Region", .hitRegion),
            ("Sufficient Element Description", .sufficientElementDescription),
            ("Dynamic Type", .dynamicType),
            ("Text Clipped", .textClipped),
            ("Trait", .trait),
        ]

        // Running the complete audit as one all-types request can exceed XCTest's
        // aggregate timeout on the three-column iPad surface. Serializing every
        // public audit type preserves the same coverage and still fails on any issue.
        for audit in auditTypes {
            print("Starting accessibility audit: \(audit.name)")
            try app.performAccessibilityAudit(for: audit.type) { issue in
                let element = issue.element
                print(
                    "Accessibility audit [\(audit.name)]: \(issue.compactDescription) — " +
                    "\(issue.detailedDescription) | label=\(element?.label ?? "<none>") " +
                    "identifier=\(element?.identifier ?? "<none>") " +
                    "type=\(String(describing: element?.elementType)) " +
                    "frame=\(String(describing: element?.frame)) " +
                    "element=\(String(describing: element))"
                )
                return false
            }
        }
    }

    func testRegularWidthTextEditorOnlyPassesElementDetectionAudit() throws {
        try launchRegularWidthProbe(arguments: ["-auditTextEditorOnly"])
        XCTAssertTrue(app.textViews["auditTextEditorProbe"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.navigationBars["Results"].waitForExistence(timeout: 3))
        printRegularWidthFrames(surface: "Text editor only")
        try performElementDetectionAudit(surface: "Text editor only")
    }

    func testRegularWidthEditorWithoutTextEditorPassesElementDetectionAudit() throws {
        try launchRegularWidthProbe(arguments: ["-auditEditorWithoutTextEditor"])
        XCTAssertTrue(app.buttons["newPromptButton"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.navigationBars["Results"].waitForExistence(timeout: 3))
        printRegularWidthFrames(surface: "Editor without text editor")
        try performElementDetectionAudit(surface: "Editor without text editor")
    }

    func testRegularWidthResultsTitleOnlyPassesElementDetectionAudit() throws {
        try launchRegularWidthProbe(arguments: ["-auditResultsTitleOnly"])
        XCTAssertTrue(app.textViews["promptEditor"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.navigationBars["Results"].waitForExistence(timeout: 3))
        printRegularWidthFrames(surface: "Results title only")
        try performElementDetectionAudit(surface: "Results title only")
    }

    func testRegularWidthResultsBodyOnlyPassesElementDetectionAudit() throws {
        try launchRegularWidthProbe(arguments: ["-auditResultsBodyOnly"])
        XCTAssertTrue(app.textViews["promptEditor"].waitForExistence(timeout: 3))
        XCTAssertTrue(
            app.descendants(matching: .any)["emptyResultsState"].waitForExistence(timeout: 3)
        )
        printRegularWidthFrames(surface: "Results body only")
        try performElementDetectionAudit(surface: "Results body only")
    }

    private func openWorkspace() {
        if app.buttons["newPromptButton"].exists { return }
        let workspace = app.buttons["workspaceButton"]
        XCTAssertTrue(workspace.waitForExistence(timeout: 3))
        workspace.tap()
    }

    private func waitForRecordedResults() {
        XCTAssertTrue(app.staticTexts["Results"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["Enhanced"].waitForExistence(timeout: 3))
    }

    private func openWorkspaceFromAnywhere() {
        if app.buttons["newPromptButton"].exists { return }
        if !app.buttons["workspaceButton"].exists {
            app.navigationBars.buttons.firstMatch.tap()
        }
        openWorkspace()
    }

    private func launchRegularWidthProbe(arguments: [String]) throws {
        app.launchArguments.append(contentsOf: arguments)
        app.launch()
        try XCTSkipUnless(
            app.windows.firstMatch.frame.width >= 700,
            "The regular-width diagnostic applies only to iPad-sized windows."
        )
    }

    private func printRegularWidthFrames(surface: String) {
        print(
            "Regular-width frames [\(surface)]: " +
            "window=\(frameDescription(app.windows.firstMatch)) " +
            "editor=\(frameDescription(app.textViews["promptEditor"])) " +
            "results=\(frameDescription(app.navigationBars["Results"])) " +
            "textEditorProbe=\(frameDescription(app.textViews["auditTextEditorProbe"])) " +
            "emptyResults=\(frameDescription(app.descendants(matching: .any)["emptyResultsState"]))"
        )
    }

    private func frameDescription(_ element: XCUIElement) -> String {
        element.exists ? String(describing: element.frame) : "<missing>"
    }

    private func performElementDetectionAudit(surface: String) throws {
        print("Starting accessibility audit: Element Detection (\(surface))")
        try app.performAccessibilityAudit(for: .elementDetection) { issue in
            let element = issue.element
            print(
                "Accessibility audit [Element Detection — \(surface)]: " +
                "\(issue.compactDescription) — \(issue.detailedDescription) | " +
                "label=\(element?.label ?? "<none>") " +
                "identifier=\(element?.identifier ?? "<none>") " +
                "type=\(String(describing: element?.elementType)) " +
                "frame=\(String(describing: element?.frame)) " +
                "element=\(String(describing: element))"
            )
            return false
        }
    }

}
