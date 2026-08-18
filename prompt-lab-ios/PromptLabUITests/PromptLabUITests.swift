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

    func testRegularWidthSimpleContentPassesElementDetectionAudit() throws {
        try launchRegularWidthProbe(arguments: ["-auditSimpleContent"])
        XCTAssertTrue(app.staticTexts["auditContentProbe"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.navigationBars["Results"].waitForExistence(timeout: 3))
        printRegularWidthFrames(surface: "Simple content")
        try performElementDetectionAudit(surface: "Simple content")
    }

    func testRegularWidthSimpleDetailPassesElementDetectionAudit() throws {
        try launchRegularWidthProbe(arguments: ["-auditSimpleDetail"])
        XCTAssertTrue(app.textViews["promptEditor"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["auditDetailProbe"].waitForExistence(timeout: 3))
        printRegularWidthFrames(surface: "Simple detail")
        try performElementDetectionAudit(surface: "Simple detail")
    }

    func testRegularWidthSimpleSplitPassesElementDetectionAudit() throws {
        try launchRegularWidthProbe(arguments: ["-auditSimpleContent", "-auditSimpleDetail"])
        XCTAssertTrue(app.staticTexts["auditContentProbe"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["auditDetailProbe"].waitForExistence(timeout: 3))
        printRegularWidthFrames(surface: "Simple split")
        try performElementDetectionAudit(surface: "Simple split")
    }

    func testRegularWidthWideEditorPassesElementDetectionAudit() throws {
        try launchRegularWidthProbe(arguments: ["-auditWideContent"], doubleColumn: false)
        XCTAssertTrue(app.buttons["newPromptButton"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.textViews["promptEditor"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.navigationBars["Results"].waitForExistence(timeout: 3))
        printRegularWidthFrames(surface: "Wide editor")
        try performElementDetectionAudit(surface: "Wide editor")
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

    private func launchRegularWidthProbe(arguments: [String], doubleColumn: Bool = true) throws {
        if doubleColumn {
            app.launchArguments.append("-auditDoubleColumn")
        }
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
            "window=\(app.windows.firstMatch.frame) " +
            "editor=\(app.textViews["promptEditor"].frame) " +
            "results=\(app.navigationBars["Results"].frame) " +
            "contentProbe=\(app.staticTexts["auditContentProbe"].frame) " +
            "detailProbe=\(app.staticTexts["auditDetailProbe"].frame)"
        )
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
