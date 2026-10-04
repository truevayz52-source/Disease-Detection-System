import { expect, request, test } from "@playwright/test"
import { CREDS, loginAs } from "../helpers/auth"

test.describe("TC-01 death notification workflow", () => {
  test("medical officer submits a valid notification end-to-end", async ({ page }) => {
    await loginAs(page, CREDS.officer.email, CREDS.officer.password)
    await page.goto("/notifications/new")

    const name = `E2E Patient ${Date.now()}`
    // Step 1 — demographics
    await page.getByLabel("Full name *").fill(name)
    await page.getByLabel("Age").fill("42")
    await page.getByLabel("Gender *").click()
    await page.getByRole("option", { name: "Male", exact: true }).click()
    await page.getByRole("button", { name: "Next" }).click()

    // Step 2 — death details
    await page.getByLabel("Reporting facility *").click()
    await page.getByRole("option").first().click()
    await page.getByLabel("Date & time of death *").fill("2026-09-20T10:30")
    await page.getByPlaceholder("Type ICD code or disease name…").click()
    await page.getByPlaceholder("Type ICD code or disease name…").fill("chol")
    await page.getByRole("button", { name: /Cholera/ }).click()
    await page.getByRole("button", { name: "Next" }).click()

    // Step 3 — review & submit
    await expect(page.getByText(name)).toBeVisible()
    await page.getByRole("button", { name: "Submit notification" }).click()

    await page.waitForURL(/notifications\//)
    await expect(page.getByText(name)).toBeVisible()

    // Audit trail recorded the mutation
    const api = await request.newContext({ baseURL: process.env.E2E_API_URL ?? "http://localhost:4000" })
    const login = await api.post("/api/auth/login", { data: CREDS.epidemiologist })
    const { token } = await login.json()
    const audit = await api.get("/api/audit?action=create_death_notification", {
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = await audit.json()
    expect(body.total).toBeGreaterThan(0)
  })
})

test.describe("TC-05 degraded-network resilience", () => {
  test("failed submission queues locally instead of losing data", async ({ page }) => {
    await loginAs(page, CREDS.officer.email, CREDS.officer.password)
    await page.goto("/notifications/new")

    await page.getByLabel("Full name *").fill("Offline Patient")
    await page.getByLabel("Gender *").click()
    await page.getByRole("option", { name: "Female" }).click()
    await page.getByRole("button", { name: "Next" }).click()

    await page.getByLabel("Reporting facility *").click()
    await page.getByRole("option").first().click()
    await page.getByLabel("Date & time of death *").fill("2026-09-21T08:00")
    await page.getByPlaceholder("Type ICD code or disease name…").click()
    await page.getByPlaceholder("Type ICD code or disease name…").fill("pneu")
    await page.getByRole("button", { name: /Pneumonia/ }).click()
    await page.getByRole("button", { name: "Next" }).click()

    // Kill the POST to simulate a network drop (TC-05)
    await page.route("**/api/notifications", (route) => route.abort())
    await page.getByRole("button", { name: "Submit notification" }).click()

    // The app must report the queued submission and keep the payload in
    // localStorage for replay.
    await expect(page.getByText(/cached locally|Network unavailable/i)).toBeVisible({ timeout: 15000 })
    const queued = await page.evaluate(() => JSON.parse(localStorage.getItem("dds_submit_queue") ?? "[]"))
    expect(queued.length).toBeGreaterThan(0)
    expect(queued[0].patient.fullName).toBe("Offline Patient")
  })
})
