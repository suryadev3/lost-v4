const nodemailer = require("nodemailer");

let transporterPromise = null;

function getTransporter() {
  if (transporterPromise) return transporterPromise;

  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    transporterPromise = Promise.resolve(
      nodemailer.createTransport({
        service: "gmail",
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
      })
    );
  } else {
    console.log(
      "No EMAIL_USER/EMAIL_PASS set - emails will not reach real inboxes. " +
        "OTP codes are always returned in the API response and printed in logs."
    );
    // Use a no-op style: still create ethereal for local preview, but don't block forever
    transporterPromise = nodemailer.createTestAccount().then((testAccount) =>
      nodemailer.createTransport({
        host: "smtp.ethereal.email",
        port: 587,
        secure: false,
        auth: { user: testAccount.user, pass: testAccount.pass },
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 8000,
      })
    );
  }
  return transporterPromise;
}

/**
 * Send email with a hard timeout so registration/login never hangs
 * if SMTP is slow or unreachable (common on free Render).
 */
async function sendMail({ to, subject, html }) {
  const timeoutMs = 8000;
  const work = (async () => {
    const transporter = await getTransporter();
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || '"Lost & Found Portal" <no-reply@lostfound.app>',
      to,
      subject,
      html,
    });
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      console.log(`\nPreview email (test mode): ${previewUrl}\n`);
    }
    return info;
  })();

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Email send timed out after 8s")), timeoutMs)
  );

  return Promise.race([work, timeout]);
}

module.exports = { sendMail };
