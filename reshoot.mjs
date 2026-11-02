import { chromium } from "@playwright/test"
import path from "node:path"
const BASE = "http://localhost:5173"
const OUT = "C:/Users/tanak/AppData/Local/Temp/docx-shots"
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.setDefaultTimeout(20000)
await page.goto(BASE + "/sign-in", { waitUntil: "networkidle" })
await page.locator('input[type="email"]').fill("r.chikafu@mohcc.org.zw")
await page.locator('input[type="password"]').fill("password123")
await page.locator('button[type="submit"]').first().click()
await page.waitForURL(u => !u.pathname.includes("sign-in"), { timeout: 15000 })
await page.goto(BASE + "/signals", { waitUntil: "networkidle" })
await page.waitForTimeout(1500)
await page.screenshot({ path: path.join(OUT, "13-signals.png"), fullPage: false })
console.log("captured signals")
await browser.close()
