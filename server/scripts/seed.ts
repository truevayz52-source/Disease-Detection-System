/**
 * Seed script — run with: pnpm --filter server seed
 * Seeds facilities, ICD-10 codes, demo users (Argon2), and demo mortality
 * data including a 12-case cholera cluster in Harare inside 48h so outbreak
 * detection (TC-04) is demonstrable on first run.
 */
import { randomUUID } from "node:crypto"
import { getPool, query } from "../src/db.js"
import { hashPassword } from "../src/auth/password.js"
import { detectOutbreaks } from "../src/lib/outbreak.js"

const FACILITIES = [
  { name: "Harare Central Hospital", province: "Harare", district: "Harare", lat: -17.8292, lng: 31.0522, type: "central_hospital" },
  { name: "Parirenyatwa Group of Hospitals", province: "Harare", district: "Harare", lat: -17.8146, lng: 31.0492, type: "central_hospital" },
  { name: "Mpilo Central Hospital", province: "Bulawayo", district: "Bulawayo", lat: -20.15, lng: 28.5833, type: "central_hospital" },
  { name: "Mutare Provincial Hospital", province: "Manicaland", district: "Mutare", lat: -18.9707, lng: 32.6709, type: "provincial_hospital" },
  { name: "Gweru Provincial Hospital", province: "Midlands", district: "Gweru", lat: -19.45, lng: 29.8167, type: "provincial_hospital" },
  { name: "Chinhoyi District Hospital", province: "Mashonaland West", district: "Chinhoyi", lat: -17.3667, lng: 30.2, type: "district_hospital" },
]

const ICD_CODES = [
  { code: "A00", desc: "Cholera", category: "Infectious - Waterborne", notifiable: true },
  { code: "A01", desc: "Typhoid and paratyphoid fevers", category: "Infectious - Waterborne", notifiable: true },
  { code: "A90", desc: "Dengue fever", category: "Infectious - Vector-borne", notifiable: true },
  { code: "A95", desc: "Yellow fever", category: "Infectious - Vector-borne", notifiable: true },
  { code: "B50", desc: "Plasmodium falciparum malaria", category: "Infectious - Vector-borne", notifiable: true },
  { code: "B54", desc: "Unspecified malaria", category: "Infectious - Vector-borne", notifiable: true },
  { code: "A09", desc: "Diarrhoea and gastroenteritis of presumed infectious origin", category: "Infectious - Waterborne", notifiable: true },
  { code: "U07.1", desc: "COVID-19", category: "Infectious - Respiratory", notifiable: true },
  { code: "J18", desc: "Pneumonia, unspecified organism", category: "Respiratory", notifiable: false },
  { code: "I21", desc: "Acute myocardial infarction", category: "Cardiovascular", notifiable: false },
  { code: "O95", desc: "Obstetric death of unspecified cause", category: "Maternal", notifiable: true },
  { code: "P95", desc: "Fetal death of unspecified cause", category: "Perinatal", notifiable: true },
  { code: "X59", desc: "Exposure to unspecified factor / undetermined cause", category: "External / Undetermined", notifiable: false },
  { code: "R99", desc: "Ill-defined and unspecified cause of mortality", category: "Ill-defined", notifiable: false },
]

type UserRole = "medical_officer" | "pathologist" | "public_health_analyst" | "system_admin" | "mortuary_clerk" | "executive"

interface UserSeed {
  name: string
  email: string
  role: UserRole
  facility: number | null
  phone: string
  department: string
}

const USERS: UserSeed[] = [
  { name: "Dr. Tendai Moyo", email: "t.moyo@mohcc.org.zw", role: "medical_officer", facility: 0, phone: "+263-71-123-4567", department: "Emergency Department" },
  { name: "Dr. Chipo Ndlovu", email: "c.ndlovu@mohcc.org.zw", role: "pathologist", facility: 1, phone: "+263-71-234-5678", department: "Pathology Department" },
  { name: "Mrs. Rutendo Chikafu", email: "r.chikafu@mohcc.org.zw", role: "public_health_analyst", facility: null, phone: "+263-71-345-6789", department: "Epidemiology Unit" },
  { name: "System Administrator", email: "sysadmin@mohcc.org.zw", role: "system_admin", facility: null, phone: "+263-71-456-7890", department: "IT Directorate" },
  { name: "Tawanda Moyo", email: "t.moyo.clerk@mohcc.org.zw", role: "mortuary_clerk", facility: 0, phone: "+263-71-567-8901", department: "Records Office" },
  { name: "Dr. Rumbidzai Chikwamba", email: "r.chikwamba@mohcc.org.zw", role: "executive", facility: null, phone: "+263-71-678-9012", department: "Executive Office" },
]

const DEMO_PASSWORD = "password123"

const FIRST = ["Tapiwa", "Rudo", "Simba", "Chido", "Tatenda", "Nyasha", "Kudzai", "Farai", "Tinashe", "Rutendo", "Munyaradzi", "Paidamoyo"]
const LAST = ["Moyo", "Ndlovu", "Chikafu", "Mukono", "Dube", "Sibanda", "Mawere", "Zvarevashe", "Gumbo", "Marowa", "Chirume", "ZHOU"]

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

async function main() {
  const pool = getPool()

  console.log("[seed] facilities...")
  const facilityIds: string[] = []
  for (const f of FACILITIES) {
    const id = randomUUID()
    facilityIds.push(id)
    await query(
      `INSERT INTO facilities (facility_id, facility_name, province, district, latitude, longitude, facility_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, f.name, f.province, f.district, f.lat, f.lng, f.type],
    )
  }

  console.log("[seed] ICD codes...")
  for (const c of ICD_CODES) {
    await query(
      `INSERT INTO icd_codes (icd_code, icd_version, description, disease_category, is_notifiable)
       VALUES (?, 'ICD-10', ?, ?, ?)
       ON DUPLICATE KEY UPDATE description = VALUES(description), disease_category = VALUES(disease_category), is_notifiable = VALUES(is_notifiable)`,
      [c.code, c.desc, c.category, c.notifiable],
    )
  }

  console.log("[seed] users (argon2)...")
  const hash = await hashPassword(DEMO_PASSWORD)
  const userIds: string[] = []
  for (const u of USERS) {
    const id = randomUUID()
    userIds.push(id)
    await query(
      `INSERT INTO users (user_id, full_name, email, password_hash, role, facility_id, phone, department, language, timezone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = VALUES(role), phone = VALUES(phone), department = VALUES(department)`,
      [id, u.name, u.email, hash, u.role, u.facility !== null ? facilityIds[u.facility] : null, u.phone, u.department, 'en', 'Africa/Harare'],
    )
    console.log(`[seed]   ${u.email} (${u.role})`)
  }

  // Reuse existing user ids on re-runs (emails are unique).
  const existingUsers = await query<any[]>("SELECT user_id, email FROM users")
  const userIdByEmail = new Map(existingUsers.map((r: any) => [r.email, r.user_id]))
  const reporterId = userIdByEmail.get("t.moyo@mohcc.org.zw")!

  console.log("[seed] demo patients + death notifications...")
  const nonCholera = ICD_CODES.filter((c) => c.code !== "A00")
  let inserted = 0

  async function addCase(icdCode: string, facilityIdx: number, deathTime: Date, mpdsr = false) {
    const pId = randomUUID()
    const fac = FACILITIES[facilityIdx]
    const jitter = () => (Math.random() - 0.5) * 0.08
    await query(
      `INSERT INTO patients (patient_id, national_id, full_name, age, gender, residential_address, latitude, longitude)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pId,
        `63-${Math.floor(100000 + Math.random() * 899999)}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${Math.floor(Math.random() * 90 + 10)}`,
        `${rand(FIRST)} ${rand(LAST)}`,
        Math.floor(1 + Math.random() * 89),
        rand(["male", "female"]),
        `${Math.floor(Math.random() * 999)} ${rand(["Main", "Chitungwiza", "Mbare", "Highfield", "Borrowdale"])} St, ${fac.district}`,
        fac.lat + jitter(),
        fac.lng + jitter(),
      ],
    )
    const nId = randomUUID()
    await query(
      `INSERT INTO death_notifications
       (notification_id, patient_id, facility_id, date_of_death, preliminary_icd_code, clinical_summary, reported_by, status, is_maternal_perinatal)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nId,
        pId,
        facilityIds[facilityIdx],
        deathTime,
        icdCode,
        "Demo record — clinical summary pending.",
        reporterId,
        rand(["pending_review", "under_review", "finalized"]),
        mpdsr,
      ],
    )
    inserted++
    return nId
  }

  // ~60 background cases spread across facilities/categories over 60 days.
  for (let i = 0; i < 60; i++) {
    const daysAgo = Math.floor(Math.random() * 60)
    const d = new Date(Date.now() - daysAgo * 86400_000 - Math.random() * 86400_000)
    await addCase(rand(nonCholera).code, Math.floor(Math.random() * FACILITIES.length), d)
  }
  // 2 maternal/perinatal demo cases.
  await addCase("O95", 0, new Date(Date.now() - 5 * 86400_000), true)
  await addCase("P95", 2, new Date(Date.now() - 12 * 86400_000), true)
  // TC-04 cluster: 12 cholera cases in Harare facilities within 48h.
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.now() - Math.random() * 40 * 3600_000)
    await addCase("A00", i % 2 === 0 ? 0 : 1, d)
  }
  console.log(`[seed]   inserted ${inserted} notifications`)

  console.log("[seed] running outbreak detection...")
  const alerts = await detectOutbreaks()
  console.log(`[seed]   ${alerts.length} alert(s) created`, alerts.map((a) => `${a.category}@${a.district}`))

  console.log("[seed] done.")
  await pool.end()
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
