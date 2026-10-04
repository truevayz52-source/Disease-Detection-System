import { query,newId,getPool } from "../src/db.js"
import { hashPassword } from "../src/auth/password.js"
const pairs=[
  ["medical.officer@domews.health.gov.zw","t.moyo@mohcc.org.zw"],
  ["pathologist@domews.health.gov.zw","c.ndlovu@mohcc.org.zw"],
  ["epidemiologist@domews.health.gov.zw","r.chikafu@mohcc.org.zw"],
  ["sysadmin@domews.health.gov.zw","sysadmin@mohcc.org.zw"]
]
try {
  for(const [oldEmail,email] of pairs){
    const [row]=await query<any[]>("SELECT user_id FROM users WHERE email=?",[oldEmail])
    if(!row)continue
    const [exists]=await query<any[]>("SELECT user_id FROM users WHERE email=?",[email])
    if(exists)throw Error(`Cannot migrate ${oldEmail}: target email already exists`)
    await query("INSERT IGNORE INTO email_aliases (email,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 30 DAY))",[oldEmail,row.user_id])
    await query("UPDATE users SET email=? WHERE user_id=?",[email,row.user_id])
    console.log(`Migrated demo address to ${email}`)
  }
  const [officer]=await query<any[]>("SELECT facility_id FROM users WHERE email='t.moyo@mohcc.org.zw'")
  for(const [name,email,role] of [["Tawanda Moyo","t.moyo.clerk@mohcc.org.zw","mortuary_clerk"],["Dr. Rumbidzai Chikwamba","r.chikwamba@mohcc.org.zw","executive"]]){
    const [exists]=await query<any[]>("SELECT user_id FROM users WHERE email=?",[email]);if(exists)continue
    await query("INSERT INTO users (user_id,full_name,email,password_hash,role,facility_id) VALUES (?,?,?,?,?,?)",[newId("usr"),name,email,await hashPassword("password123"),role,role==="mortuary_clerk"?officer?.facility_id??null:null])
    console.log(`Added ${role} demo account`)
  }
} finally {await getPool().end()}
