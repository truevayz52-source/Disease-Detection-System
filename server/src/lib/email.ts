import nodemailer from "nodemailer"

export function emailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM)
}

export async function sendEmail(to: string, subject: string, text: string) {
  if (!emailConfigured()) throw Error("Email delivery is not configured")
  const secure = process.env.SMTP_SECURE === "true"
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || (secure ? 465 : 587)),
    secure,
    requireTLS: true,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    disableFileAccess: true, disableUrlAccess: true,
  })
  try {
    const result = await transport.sendMail({ from: process.env.SMTP_FROM, to, subject, text })
    if (result.rejected.length) throw Error("Email recipient rejected")
  } finally { transport.close() }
}
