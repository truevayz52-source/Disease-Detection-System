// Capture live UI screenshots of the running DDS for the documentation.
// Run: node capture_screenshots.mjs   (requires dev stack on :5174/:4001)
import { chromium } from "@playwright/test"
import path from "node:path"

const BASE = process.env.DDS_WEB || "http://localhost:5174"
const OUT = path.resolve(process.env.SHOT_DIR || "../screenshots")

const SHOTS = [
  // [file, url, account]
  ["01-signin.png", "/sign-in", null],
  ["02-dashboard.png", "/dashboard", "mo"],
  ["03-notifications.png", "/notifications", "mo"],
  ["04-notification-new.png", "/notifications/new", "mo"],
  ["05-pathology-queue.png", "/pathology/queue", "patho"],
  ["06-autopsies.png", "/autopsy", "patho"],
  ["07-alerts.png", "/alerts", "analyst"],
  ["08-analytics.png", "/analytics", "analyst"],
  ["09-analytics-map.png", "/analytics/map", "analyst"],
  ["10-audit.png", "/audit", "analyst"],
  ["11-admin-users.png", "/admin/users", "admin"],
]

const ACCOUNTS = {
  mo: "t.moyo@mohcc.org.zw",
  patho: "c.ndlovu@mohcc.org.zw",
  analyst: "r.chikafu@mohcc.org.zw",
  admin: "sysadmin@mohcc.org.zw",
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.setDefaultTimeout(20000)

let current = null
async function login(role) {
  if (current === role) return
  if (current !== null) {
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() }).catch(() => {})
    await page.context().clearCookies().catch(() => {})
  }
  await page.goto(BASE + "/sign-in", { waitUntil: "networkidle" })
  await page.locator('input[type="email"]').fill(ACCOUNTS[role])
  await page.locator('input[type="password"]').fill("password123")
  await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Sign In")').first().click()
  await page.waitForURL(u => !u.pathname.includes("sign-in"), { timeout: 15000 })
  await page.waitForLoadState("networkidle")
  current = role
  console.log("logged in as", role)
}

for (const [file, url, role] of SHOTS) {
  try {
    if (role) await login(role)
    else await page.goto(BASE + "/sign-in", { waitUntil: "networkidle" })
    await page.goto(BASE + url, { waitUntil: "networkidle" })
    await page.waitForTimeout(1200) // let charts/map tiles settle
    await page.screenshot({ path: path.join(OUT, file), fullPage: false })
    console.log("captured", file)
  } catch (e) {
    console.log("FAILED", file, url, "-", e.message.split("\n")[0])
  }
}
await browser.close()
console.log("done")
