// utils/email.js
"use strict";

const nodemailer = require("nodemailer");

// —————————————————————————————
// SMTP / Brevo ayarları (env üzerinden)
// —————————————————————————————
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

// Uygulama base URL (doğrulama linkleri için)
// Örnek .env:
// APP_BASE_URL=http://localhost:3000   (lokal)
// APP_BASE_URL=https://mavern-site-1.onrender.com   (canlı)
const APP_BASE_URL = process.env.APP_BASE_URL || "http://localhost:3000";

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

// —————————————————————————————
// Yardımcı: verify linkini güvenli şekilde üret
// —————————————————————————————
function buildVerifyUrl(token) {
  const base = (APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/verify?token=${encodeURIComponent(token)}`;
}

// —————————————————————————————
// Ortak HTML iskeleti (premium, sade)
// —————————————————————————————
function buildHtmlShell({ title, preheader, heading, bodyHtml, ctaLabel, ctaUrl, footerNote }) {
  const safeTitle      = title || "Mavern";
  const safePreheader  = preheader || "";
  const safeHeading    = heading || "";
  const safeBody       = bodyHtml || "";
  const hasCta         = ctaLabel && ctaUrl;

  return `
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>${safeTitle}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#050509;color:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,system-ui,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <!-- Preheader (bazı istemcilerde küçük önizleme) -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      ${safePreheader}
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tr>
        <td style="padding-bottom:16px;text-align:left;">
          <div style="font-size:20px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;">
            Mavern
          </div>
        </td>
      </tr>

      <tr>
        <td>
          <div style="background:#0b0b0d;border-radius:18px;border:1px solid #1b1b20;padding:20px 18px;">
            ${safeHeading
              ? `<h1 style="margin:0 0 12px;font-size:18px;font-weight:600;">${safeHeading}</h1>`
              : ""}

            <div style="font-size:14px;line-height:1.7;color:#d4d4d8;">
              ${safeBody}
            </div>

            ${
              hasCta
                ? `
            <div style="margin:22px 0 10px;">
              <a href="${ctaUrl}"
                 style="display:inline-block;padding:10px 22px;border-radius:999px;background:#fafafa;color:#050509;text-decoration:none;font-size:14px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;">
                ${ctaLabel}
              </a>
            </div>
            <div style="font-size:11px;color:#9ca3af;word-break:break-all;margin-top:4px;">
              Bağlantı açılmazsa bu adresi tarayıcınıza kopyalayabilirsiniz:<br>
              <span>${ctaUrl}</span>
            </div>
              `
                : ""
            }

            ${
              footerNote
                ? `<div style="margin-top:18px;font-size:11px;color:#9ca3af;">${footerNote}</div>`
                : ""
            }
          </div>
        </td>
      </tr>

      <tr>
        <td style="padding-top:14px;text-align:left;font-size:11px;color:#6b7280;">
          © ${new Date().getFullYear()} Mavern. Tüm hakları saklıdır.
        </td>
      </tr>
    </table>
  </div>
</body>
</html>
`.trim();
}

// —————————————————————————————
// Temel mail gönderici
// —————————————————————————————
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

// —————————————————————————————
// 1) Kayıt sonrası e-posta doğrulama maili
// —————————————————————————————
async function sendVerificationEmail(to, token) {
  const verifyUrl = buildVerifyUrl(token);

  const subject = "Mavern • E-posta Adresinizi Doğrulayın";

  const text = [
    "Merhaba,",
    "",
    "Mavern hesabınızı güvenle kullanabilmeniz için e-posta adresinizi doğrulamanız gerekiyor.",
    "Aşağıdaki bağlantıyı tarayıcınızda açarak doğrulama işlemini tamamlayabilirsiniz:",
    verifyUrl,
    "",
    "Bu talep size ait değilse, bu e-postayı yok sayabilirsiniz.",
    "",
    "Mavern Kozmetik"
  ].join("\n");

  const html = buildHtmlShell({
    title: subject,
    preheader: "Mavern hesabınızı kullanmaya başlamadan önce e-posta adresinizi doğrulayın.",
    heading: "E-posta Adresinizi Doğrulayın",
    bodyHtml: `
      <p>Merhaba,</p>
      <p>
        Mavern hesabınızı güvenle kullanabilmeniz için e-posta adresinizi doğrulamanız gerekiyor.
        Aşağıdaki butona tıklayarak doğrulama işlemini birkaç saniye içinde tamamlayabilirsiniz.
      </p>
      <p>
        Doğrulama işlemini tamamladığınızda hesabınız aktif hale gelecek ve siparişlerinizi
        daha hızlı yönetebilecek, kayıtlı bilgilerinizle daha kişisel bir deneyim yaşayacaksınız.
      </p>
      <p style="margin-top:12px;">
        Mavern’e gösterdiğiniz ilgi için teşekkür ederiz.
      </p>
    `,
    ctaLabel: "E-posta Adresimi Doğrula",
    ctaUrl: verifyUrl,
    footerNote:
      "Bu talep size ait değilse lütfen herhangi bir işlem yapmayın. Bu e-posta yalnızca bilgilendirme amacıyla gönderilmiştir; yanıtlamanıza gerek yoktur."
  });

  return sendMail({ to, subject, text, html });
}

// —————————————————————————————
// 2) Admin SMTP test maili
// —————————————————————————————
async function sendAdminTestMail() {
  const subject = "Mavern SMTP Test";
  const text = "Bu bir Mavern SMTP test e-postasıdır.";
  const html = buildHtmlShell({
    title: subject,
    preheader: "Mavern SMTP test e-postası.",
    heading: "SMTP Test",
    bodyHtml: `
      <p>Merhaba,</p>
      <p>Bu e-posta, Mavern sunucusundaki SMTP ayarlarınızın başarılı şekilde çalıştığını test etmek için gönderilmiştir.</p>
      <p>Bu mesaj size ulaşıyorsa, e-posta altyapınız hazır demektir.</p>
    `
  });

  return sendMail({
    to: MAIL_TO,
    subject,
    text,
    html
  });
}

// —————————————————————————————
// 3) İleride kullanılmak üzere şablon örnekleri
//    (sipariş özeti, iletişim teşekkür vs. için)
// —————————————————————————————

// Sipariş sonrası kullanıcıya özet maili göndermek için kullanabileceğin örnek fonksiyon.
// Şimdilik projede kullanılmıyorsa çağırmak zorunda değilsin.
// Backend tarafında hazır olduğunda bu fonksiyonu import edip kullanabilirsin.
async function sendOrderSummaryEmail(to, payload = {}) {
  const subject = "Mavern • Siparişiniz Alındı";

  const text = "Siparişiniz alındı. Teşekkür ederiz.";
  const html = buildHtmlShell({
    title: subject,
    preheader: "Siparişiniz başarıyla alındı.",
    heading: "Siparişiniz Alındı",
    bodyHtml: `
      <p>Merhaba,</p>
      <p>Siparişiniz başarıyla alındı. Hazırlık aşamasına geçtiğinde size ayrıca bilgi verilecektir.</p>
      <p>Mavern'e duyduğunuz güven için teşekkür ederiz.</p>
    `
  });

  return sendMail({ to, subject, text, html });
}

// İletişim formu sonrası kullanıcıya teşekkür maili göndermek için örnek fonksiyon.
async function sendContactThanksEmail(to) {
  const subject = "Mavern • Mesajınız Bize Ulaştı";

  const text = [
    "Merhaba,",
    "",
    "Mavern ile iletişime geçtiğiniz için teşekkür ederiz.",
    "Mesajınızı aldık; en kısa sürede size dönüş yapacağız.",
    "",
    "Mavern Kozmetik"
  ].join("\n");

  const html = buildHtmlShell({
    title: subject,
    preheader: "Mesajınız başarıyla alındı.",
    heading: "Mesajınız Bize Ulaştı",
    bodyHtml: `
      <p>Merhaba,</p>
      <p>
        Mavern ile iletişime geçtiğiniz için teşekkür ederiz.
        Mesajınızı aldık; ekibimiz en kısa sürede size geri dönüş yapacaktır.
      </p>
      <p style="margin-top:12px;">
        İlginiz ve güveniniz için teşekkür ederiz.
      </p>
    `
  });

  return sendMail({ to, subject, text, html });
}

// —————————————————————————————
// Transport test
// —————————————————————————————
async function verifyTransport() {
  return transporter.verify();
}

module.exports = {
  transporter,
  sendMail,
  sendVerificationEmail,
  sendAdminTestMail,
  sendOrderSummaryEmail,
  sendContactThanksEmail,
  verifyTransport,
  FROM_EMAIL,
  FROM_NAME,
  MAIL_TO,
  APP_BASE_URL
};
