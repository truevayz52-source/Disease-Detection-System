import { expect, request, test } from "@playwright/test"
import { apiLogin, CREDS, loginAs } from "../helpers/auth"

const API = () => process.env.E2E_API_URL ?? "http://localhost:4000"

test.describe("TC-04 outbreak cluster detection", () => {
  test("seeded 12-case waterborne cluster produced an active alert", async () => {
    const api = await request.newContext({ baseURL: API() })
    const token = await apiLogin(CREDS.epidemiologist.email, CREDS.epidemiologist.password)
    const res = await api.get("/api/alerts?status=active", {
      headers: { Authorization: `Bearer ${token}` },
    })
    const { items } = await res.json()
    const cluster = items.find(
      (a: any) => a.disease_category === "Infectious - Waterborne" && a.district === "Harare",
    )
    expect(cluster, "expected seeded outbreak alert in Harare").toBeTruthy()
    expect(cluster.case_count).toBeGreaterThanOrEqual(10)
  })

  test("manual detection run returns a result object", async () => {
    const api = await request.newContext({ baseURL: API() })
    const token = await apiLogin(CREDS.epidemiologist.email, CREDS.epidemiologist.password)
    const res = await api.post("/api/analytics/detect", {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body).toHaveProperty("created")
    expect(Array.isArray(body.created)).toBeTruthy()
  })

  test("cluster analytics endpoint returns clusters via whichever engine is up", async () => {
    const api = await request.newContext({ baseURL: API() })
    const token = await apiLogin(CREDS.epidemiologist.email, CREDS.epidemiologist.password)
    const res = await api.get("/api/analytics/clusters", {
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = await res.json()
    expect(["python-sklearn", "node-fallback"]).toContain(body.engine)
    expect(body.clusters.length).toBeGreaterThan(0)
    const harareWaterborne = body.clusters.find(
      (c: any) => c.category === "Infectious - Waterborne" && (c.district === "Harare" || c.count >= 10),
    )
    expect(harareWaterborne).toBeTruthy()
  })

  test("alerts page displays the outbreak alert to epidemiologist", async ({ page }) => {
    await loginAs(page, CREDS.epidemiologist.email, CREDS.epidemiologist.password)
    await page.goto("/alerts")
    await expect(page.getByText("Infectious - Waterborne").first()).toBeVisible()
    await expect(page.getByText(/Risk \d+/).first()).toBeVisible()
  })

  test("analytics and map pages load", async ({ page }) => {
    await loginAs(page, CREDS.epidemiologist.email, CREDS.epidemiologist.password)
    await page.goto("/analytics")
    await expect(page.getByText("Weekly mortality by disease category")).toBeVisible()
    await page.goto("/analytics/map")
    await expect(page.locator(".leaflet-container")).toBeVisible({ timeout: 20000 })
  })
})
