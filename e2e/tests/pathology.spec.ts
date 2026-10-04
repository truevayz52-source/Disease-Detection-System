import { expect, request, test } from "@playwright/test"
import { createNotification, CREDS, loginAs } from "../helpers/auth"

const API = () => process.env.E2E_API_URL ?? "http://localhost:4000"

// Minimal valid PNG (1x1) padded out — the bytes stay decodable past IEND.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
)
const BIG_IMAGE = Buffer.concat([PNG_1X1, Buffer.alloc(2 * 1024 * 1024, 7)]) // ~2MB

test.describe("TC-02 tele-pathology + autopsy workflow", () => {
  test("pathologist uploads a high-res image, files autopsy, finalizes", async ({ page }) => {
    // Own-case setup — independent of whatever the seed left pending.
    const notificationId = await createNotification()

    await loginAs(page, CREDS.pathologist.email, CREDS.pathologist.password)
    await page.goto(`/pathology/review/${notificationId}`)

    // Upload a large specimen image through the file input
    const chooser = page.locator('input[type="file"]').first()
    await chooser.setInputFiles({ name: "specimen.png", mimeType: "image/png", buffer: BIG_IMAGE })
    await expect(page.getByText("Image uploaded.")).toBeVisible({ timeout: 20000 })

    // The pan/zoom viewer renders the uploaded image
    await expect(page.locator(".bg-black\\/90 img").first()).toBeVisible({ timeout: 20000 })

    // Autopsy form
    await page.getByLabel("Internal observations").fill("E2E: multi-organ congestion consistent with sepsis.")
    await page.getByLabel("Toxicology results").fill("E2E: no toxins detected.")
    await page.getByLabel("Final ICD code *").fill("A00")
    await page.getByLabel("Final cause of death *").fill("Acute watery diarrhoea due to cholera")
    await page.getByLabel("Digital signature *").fill("Dr. Chipo Ndlovu")
    await page.getByRole("button", { name: "Finalize & sign" }).click()

    await page.waitForURL(/notifications\//)
    // Status badge (not the toast) confirms the finalize landed.
    await expect(page.locator('[data-slot="badge"]', { hasText: "Finalized" }).first()).toBeVisible()

    // Death certificate is now available and renders the patient's details
    await expect(page.getByRole("link", { name: "Death certificate" })).toBeVisible()
    const certUrl = await page.getByRole("link", { name: "Death certificate" }).getAttribute("href")
    const api = await request.newContext({ baseURL: API() })
    const cert = await api.get(certUrl!)
    expect(cert.status()).toBe(200)
    expect(await cert.text()).toContain("Digital Death Certificate")
  })
})
