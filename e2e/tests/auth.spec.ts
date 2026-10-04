import { expect, test } from "@playwright/test"
import { CREDS, loginAs } from "../helpers/auth"

test.describe("authentication", () => {
  test("login page renders DDS branding", async ({ page }) => {
    await page.goto("/sign-in")
    await expect(page.getByRole("heading", { name: "Disease Detection System" })).toBeVisible()
  })

  test("valid login reaches dashboard", async ({ page }) => {
    await page.goto("/sign-in")
    await page.getByLabel("Email").fill(CREDS.officer.email)
    await page.getByLabel("Password").fill(CREDS.officer.password)
    await page.getByRole("button", { name: "Sign in" }).click()
    await page.waitForURL("**/dashboard")
    await expect(page.getByText("National mortality surveillance overview")).toBeVisible()
  })

  test("invalid credentials show an error", async ({ page }) => {
    await page.goto("/sign-in")
    await page.getByLabel("Email").fill(CREDS.officer.email)
    await page.getByLabel("Password").fill("wrong-password-1")
    await page.getByRole("button", { name: "Sign in" }).click()
    await expect(page.getByText("Invalid email or password")).toBeVisible()
  })

  test("medical officer sees scoped nav (no admin items)", async ({ page }) => {
    await loginAs(page, CREDS.officer.email, CREDS.officer.password)
    await page.goto("/dashboard")
    await expect(page.getByRole("link", { name: "Death Notifications" })).toBeVisible()
    await expect(page.getByRole("link", { name: "User Management" })).toHaveCount(0)
    await expect(page.getByRole("link", { name: "Outbreak Analytics" })).toHaveCount(0)
  })

  test("epidemiologist sees analytics nav", async ({ page }) => {
    await loginAs(page, CREDS.epidemiologist.email, CREDS.epidemiologist.password)
    await page.goto("/dashboard")
    await expect(page.getByRole("link", { name: "Outbreak Analytics" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Outbreak Map" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Audit Trail" })).toBeVisible()
  })
})
