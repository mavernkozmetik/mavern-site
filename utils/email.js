// utils/email.js
const nodemailer = require("nodemailer");

const host   = process.env.BREVO_HOST || "smtp-relay.brevo.com";
const port   = Number(process.env.BREVO_PORT || 587);
const secure =
  String(process.env.BREVO_SECURE || "").toLowerCase() === "true" ||
  port === 465;

const user = process.env.BREVO_USER;
const pass = process.env.BREVO_PASS;

const FROM_EMAIL = process.env.FROM_EMAIL || user;
const FROM_NAME  = process.env.FROM_NAME  || "Mavern Kozmetik";
const MAIL_TO    = process.env.MAIL_TO    || FROM_EMAIL;

const transporter = nodemailer.createTransport({
  host,
  port,
  secure,
  auth: { user, pass },
  pool: true,
  maxConnections: 3,
  maxMessages: 50,
  connectionTimeout: 15000,
  greetingTimeout: 10000,
  socketTimeout: 20000,
  tls: { rejectUnauthorized: false }
});

async function sendMail({ to, subject, text, html, replyTo }) {
  const mailOpts = {
    from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
    to: to || MAIL_TO,
    subject,
    text,
    html,
    replyTo
  };
  return transporter.sendMail(mailOpts);
}

// Kayıt sonrası e-posta doğrulama maili
async function sendVerificationEmail(to, token) {
  const verifyUrl = `https://mavern-site-1.onrender.com//verify?token=${encodeURIComponent(
    token
  )}`;
  const subject = "Mavern • E-posta Adresinizi Doğrulayın";

  const text = [
    "Merhaba,",
    "",
    "Mavern hesabınızı aktifleştirmek için aşağıdaki bağlantıya tıklayın:",
    verifyUrl,
    "",
    "Bu talebi siz yapmadıysanız, bu e-postayı yok sayabilirsiniz.",
    "",
    "Mavern Kozmetik"
  ].join("\n");

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111827;">
      <h2 style="font-weight:600;margin-bottom:12px;">Merhaba,</h2>
      <p>Mavern hesabınızı aktifleştirmek için aşağıdaki butona tıklayın:</p>
      <p style="margin:20px 0;">
        <a href="${verifyUrl}"
           style="display:inline-block;padding:10px 18px;border-radius:999px;background:#111827;color:#f9fafb;text-decoration:none;font-weight:600;">
          E-posta Adresimi Doğrula
        </a>
      </p>
      <p>Bağlantı açılmazsa bu adresi tarayıcınıza kopyalayın:</p>
      <p style="font-size:13px;color:#4b5563;word-break:break-all;">${verifyUrl}</p>
      <p style="margin-top:20px;font-size:13px;color:#6b7280;">
        Bu talebi siz yapmadıysanız, bu e-postayı yok sayabilirsiniz.
      </p>
      <p style="margin-top:8px;">Mavern Kozmetik</p>
    </div>
  `;

  return sendMail({ to, subject, text, html });
}

async function sendAdminTestMail() {
  return sendMail({
    to: MAIL_TO,
    subject: "Mavern SMTP Test",
    text: "Bu bir Mavern SMTP test e-postasıdır."
  });
}

async function verifyTransport() {
  return transporter.verify();
}

module.exports = {
  transporter,
  sendMail,
  sendVerificationEmail,
  sendAdminTestMail,
  verifyTransport,
  FROM_EMAIL,
  FROM_NAME,
  MAIL_TO
};
