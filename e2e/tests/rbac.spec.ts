import { expect, request, test } from "@playwright/test"
import { apiLogin, CREDS, loginAs } from "../helpers/auth"

const API = () => process.env.E2E_API_URL ?? "http://localhost:4000"

test.describe("TC-03 role-based access control", () => {
  test("unauthenticated API calls return 401", async () => {
    const api = await request.newContext({ baseURL: API() })
    const res = await api.get("/api/notifications")
    expect(res.status()).toBe(401)
  })

  test("invalid JWT returns 401", async () => {
    const api = await request.newContext({ baseURL: API() })
    const res = await api.get("/api/notifications", {
      headers: { Authorization: "Bearer invalid.jwt.token" },
    })
    expect(res.status()).toBe(401)
  })

  test("medical officer cannot reach admin-only APIs (403)", async () => {
    const api = await request.newContext({ baseURL: API() })
    const token = await apiLogin(CREDS.officer.email, CREDS.officer.password)
    for (const path of ["/api/users", "/api/audit", "/api/analytics/trends", "/api/analytics/detect"]) {
      const res = path.includes("detect")
        ? await api.post(path, { headers: { Authorization: `Bearer ${token}` } })
        : await api.get(path, { headers: { Authorization: `Bearer ${token}` } })
      expect(res.status(), `${path} must reject medical_officer`).toBe(403)
    }
  })

  test("medical officer cannot create a user (403)", async () => {
    const api = await request.newContext({ baseURL: API() })
    const token = await apiLogin(CREDS.officer.email, CREDS.officer.password)
    const res = await api.post("/api/users", {
      headers: { Authorization: `Bearer ${token}` },
      data: { fullName: "X", email: "x@x.zw", password: "password123", role: "medical_officer" },
    })
    expect(res.status()).toBe(403)
  })

  test("forbidden UI route redirects to /forbidden", async ({ page }) => {
    await loginAs(page, CREDS.officer.email, CREDS.officer.password)
    await page.goto("/admin/users")
    await page.waitForURL("**/forbidden")
    await expect(page.getByText("Access restricted")).toBeVisible()
  })

  test("pathologist cannot access notifications/new UI", async ({ page }) => {
    await loginAs(page, CREDS.pathologist.email, CREDS.pathologist.password)
    await page.goto("/notifications/new")
    await page.waitForURL("**/forbidden")
    await expect(page.getByText("Access restricted")).toBeVisible()
  })
})
