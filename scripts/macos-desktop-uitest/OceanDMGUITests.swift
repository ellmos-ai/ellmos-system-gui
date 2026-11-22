import XCTest

final class OceanDMGUITests: XCTestCase {
    private struct Inputs: Decodable {
        let application: String
        let origin: String
        let openTask: String
        let doneTask: String
        let workerCount: Int
        let output: String
    }

    private func require(_ element: XCUIElement, _ message: String) throws -> XCUIElement {
        guard element.waitForExistence(timeout: 25) else {
            throw UITestFailure(message)
        }
        return element
    }

    private struct UITestFailure: LocalizedError {
        let errorDescription: String?
        init(_ message: String) { errorDescription = message }
    }

    func testInstalledDMGConnectsToBACH() throws {
        continueAfterFailure = false
        let configURL = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "ocean-test", withExtension: "json"))
        let input = try JSONDecoder().decode(Inputs.self, from: Data(contentsOf: configURL))
        let output = URL(fileURLWithPath: input.output, isDirectory: true)
        let app = XCUIApplication(url: URL(fileURLWithPath: input.application, isDirectory: true))
        app.launchEnvironment = ["HOME": input.output, "CFFIXED_USER_HOME": input.output]
        app.launch()

        let connection = try require(app.windows["Ocean (BACH) verbinden"], "Installed connection window not found")
        let connect = try require(connection.webViews.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Verbinden")).firstMatch,
                                  "Connect button not found")
        let address = try require(connection.webViews.textFields.firstMatch, "Backend address field not found")
        address.click()
        address.typeText(input.origin)
        connect.click()
        _ = try require(connection.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Loopbackadressen")).firstMatch,
                        "Expected confirmation before using HTTP")
        let consent = try require(connection.webViews.checkBoxes.firstMatch, "HTTP confirmation checkbox not found")
        consent.click()
        connect.click()

        let backend = try require(app.windows["Ocean (BACH)"], "BACH backend window not found")
        let web = backend.webViews.firstMatch
        let heading = web.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Willkommen")).firstMatch
        _ = try require(heading, "Dashboard did not render in WKWebView")
        let openTitle = web.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", input.openTask)).firstMatch
        _ = try require(openTitle, "The enrolled device could not read its open BACH task")
        try backend.screenshot().pngRepresentation.write(to: output.appendingPathComponent("dashboard.png"))

        let tasks = try require(web.links["Aufgaben"].firstMatch, "Tasks link not found")
        tasks.click()
        _ = try require(openTitle, "Open task not rendered on the Tasks page")
        let filter = try require(web.popUpButtons.matching(
            NSPredicate(format: "value CONTAINS %@", "Offen · alle aktiven")).firstMatch, "Task status filter not found")
        filter.click()
        let doneOption = try require(app.menuItems.matching(NSPredicate(format: "label CONTAINS %@", "Erledigt · alle")).firstMatch,
                                     "Completed task option not found")
        doneOption.click()
        let doneTitle = web.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", input.doneTask)).firstMatch
        _ = try require(doneTitle, "Completed task not rendered after filtering")
        XCTAssertFalse(openTitle.exists)
        try backend.screenshot().pngRepresentation.write(to: output.appendingPathComponent("aufgaben.png"))

        let running = try require(web.links["Deine Agenten"].firstMatch, "Living & Running link not found")
        running.click()
        _ = try require(web.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Living & Running")).firstMatch,
                        "Living & Running did not render")
        _ = try require(web.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "\(input.workerCount) Worker registriert")).firstMatch,
                        "Worker count did not match the Control API")
        try backend.screenshot().pngRepresentation.write(to: output.appendingPathComponent("running.png"))

        try require(backend.buttons["Close"].firstMatch, "Backend close button not found").click()
        _ = try require(connection, "Connection window did not return after closing BACH")
        try require(connection.buttons["Close"].firstMatch, "Connection close button not found").click()
        XCTAssertTrue(app.wait(for: .notRunning, timeout: 10), "Ocean stayed open after closing both windows")

        let evidence: [String: Any] = [
            "renderer": "WKWebView",
            "routes": ["/", "/tasks", "/agenten/running"],
            "native_windows_observed": true,
            "http_consent_enforced": true,
            "tasks_filter_verified": true,
            "connection_restored_after_backend_close": true,
            "clean_window_exit": true,
        ]
        try JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys]).write(
            to: output.appendingPathComponent("macos-ui-result.json"), options: .atomic)
    }
}
