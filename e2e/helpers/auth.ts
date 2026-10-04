import { expect, request, type Page } from "@playwright/test"

export const CREDS = {
  officer: { email: "medical.officer@domews.health.gov.zw", password: "password123" },
  pathologist: { email: "pathologist@domews.health.gov.zw", password: "password123" },
  epidemiologist: { email: "epidemiologist@domews.health.gov.zw", password: "password123" },
  sysadmin: { email: "sysadmin@domews.health.gov.zw", password: "password123" },
}

/** Log in via the API and inject the JWT — fast path for most tests. */
export async function loginAs(page: Page, email: string, password: string) {
  const apiBase = process.env.E2E_API_URL ?? "http://localhost:4000"
  const ctx = await request.newContext({ baseURL: apiBase })
  const res = await ctx.post("/api/auth/login", { data: { email, password } })
  expect(res.ok()).toBeTruthy()
  const { token } = await res.json()
  await page.goto("/sign-in")
  await page.evaluate((t) => localStorage.setItem("dds_token", t), token)
}

export async function apiLogin(email: string, password: string): Promise<string> {
  const apiBase = process.env.E2E_API_URL ?? "http://localhost:4000"
  const ctx = await request.newContext({ baseURL: apiBase })
  const res = await ctx.post("/api/auth/login", { data: { email, password } })
  const body = await res.json()
  return body.token
}

/** Create a death notification as the medical officer — gives specs a case they own. */
export async function createNotification(): Promise<string> {
  const apiBase = process.env.E2E_API_URL ?? "http://localhost:4000"
  const token = await apiLogin(CREDS.officer.email, CREDS.officer.password)
  const ctx = await request.newContext({ baseURL: apiBase })
  const facilities = await ctx.get("/api/facilities", { headers: { Authorization: `Bearer ${token}` } })
  const facilityId = (await facilities.json()).items[0].facility_id
  const res = await ctx.post("/api/notifications", {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      patient: {
        nationalId: null,
        fullName: `E2E Review Case ${Date.now()}`,
        age: 47,
        gender: "male",
        residentialAddress: "1 Specimen Way, Harare",
        latitude: -17.83,
        longitude: 31.05,
      },
      facilityId,
      dateOfDeath: new Date().toISOString(),
      preliminaryIcdCode: "A00",
      clinicalSummary: "E2E test case.",
      isMaternalPerinatal: false,
    },
  })
  expect(res.ok()).toBeTruthy()
  return (await res.json()).notificationId
}
