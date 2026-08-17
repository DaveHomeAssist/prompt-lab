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
        try app.performAccessibilityAudit { issue in
            print("Accessibility audit: \(issue.compactDescription) — \(issue.detailedDescription)")
            return false
        }
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
}
