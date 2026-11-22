import XCTest

final class OceanDMGUITests: XCTestCase {
    private struct Inputs: Decodable {
        let application: String
        let origin: String
        let openTask: String
        let openTaskID: Int
        let doneTask: String
        let workerCount: Int
        let output: String
        let home: String
    }

    private func require(_ element: XCUIElement, _ message: String, in window: XCUIElement? = nil) throws -> XCUIElement {
        guard element.waitForExistence(timeout: 25) else {
            if let window { print(window.debugDescription) }
            throw UITestFailure(message)
        }
        return element
    }

    private func requireVisibleText(in window: XCUIElement, prefix: String) throws {
        let deadline = Date().addingTimeInterval(20)
        repeat {
            if window.staticTexts.allElementsBoundByIndex.contains(where: {
                ($0.value as? String)?.hasPrefix(prefix) == true
            }) { return }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        } while Date() < deadline
        print(window.debugDescription)
        throw UITestFailure("Missing native text beginning with " + prefix)
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
        app.launchEnvironment = ["HOME": input.home, "CFFIXED_USER_HOME": input.home]
        app.launch()

        let connection = try require(app.windows["Ocean (BACH) verbinden"], "Installed connection window not found")
        let connect = try require(connection.buttons["Verbinden"].firstMatch,
                                  "Connect button not found", in: connection)
        let address = try require(connection.textFields["Backendadresse"].firstMatch, "Backend address field not found", in: connection)
        address.click()
        address.typeText(input.origin)
        connect.click()
        _ = try require(connection.staticTexts["HTTPS verwenden. HTTP ist nur für ausdrücklich bestätigte lokale Loopbackadressen möglich."].firstMatch,
                        "Expected confirmation before using HTTP", in: connection)
        let consent = try require(connection.checkBoxes["HTTP für diese lokale Loopbackadresse erlauben"].firstMatch, "HTTP confirmation checkbox not found", in: connection)
        consent.click()
        connect.click()

        let backend = try require(app.windows["Ocean (BACH)"], "BACH backend window not found")
        let web = backend
        let heading = web.staticTexts.matching(NSPredicate(format: "title BEGINSWITH %@", "Willkommen")).firstMatch
        _ = try require(heading, "Dashboard did not render in WKWebView", in: backend)
        let dashboardTask = web.staticTexts["#\(input.openTaskID): \(input.openTask)"].firstMatch
        _ = try require(dashboardTask, "The enrolled device could not read its open BACH task", in: backend)
        try backend.screenshot().pngRepresentation.write(to: output.appendingPathComponent("dashboard.png"))

        let tasks = try require(web.links["Aufgaben"].firstMatch, "Tasks link not found")
        tasks.click()
        let openTitle = web.staticTexts[input.openTask].firstMatch
        _ = try require(openTitle, "Open task not rendered on the Tasks page", in: backend)
        let filter = try require(web.popUpButtons["Status"].firstMatch, "Task status filter not found", in: backend)
        filter.click()
        let doneOption = try require(app.menuItems.matching(NSPredicate(format: "title CONTAINS %@ OR label CONTAINS %@", "Erledigt · alle", "Erledigt · alle")).firstMatch,
                                     "Completed task option not found", in: app)
        doneOption.click()
        let doneTitle = web.staticTexts[input.doneTask].firstMatch
        _ = try require(doneTitle, "Completed task not rendered after filtering", in: backend)
        XCTAssertFalse(openTitle.exists)
        try backend.screenshot().pngRepresentation.write(to: output.appendingPathComponent("aufgaben.png"))

        let running = try require(web.links["Deine Agenten"].firstMatch, "Living & Running link not found")
        running.click()
        _ = try require(web.staticTexts.matching(NSPredicate(format: "title CONTAINS %@", "Living & Running")).firstMatch,
                        "Living & Running did not render", in: backend)
        try requireVisibleText(in: backend, prefix: "\(input.workerCount) Worker registriert")
        try backend.screenshot().pngRepresentation.write(to: output.appendingPathComponent("running.png"))

        try require(backend.buttons["_XCUI:CloseWindow"].firstMatch, "Backend close button not found").click()
        _ = try require(connection, "Connection window did not return after closing BACH")
        try require(connection.buttons["_XCUI:CloseWindow"].firstMatch, "Connection close button not found").click()
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
