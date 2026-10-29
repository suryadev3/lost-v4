const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { one, query } = require("../db");
const { sendMail } = require("../config/mailer");
const { isValidEmail, isValidPassword } = require("../utils/validators");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const EMAIL_CONFIGURED = !!(process.env.EMAIL_USER && process.env.EMAIL_PASS);

// Common disposable / temporary email domains
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "tempmail.com",
  "temp-mail.org", "throwaway.email", "yopmail.com", "sharklasers.com",
  "trashmail.com", "10minutemail.com", "getnada.com", "maildrop.cc",
  "discard.email", "mailnesia.com", "tempail.com", "fakeinbox.com",
  "emailondeck.com", "mohmal.com", "tmpmail.org", "tmpmail.net",
]);

function isDisposableEmail(email) {
  const domain = String(email).toLowerCase().split("@")[1] || "";
  return DISPOSABLE_DOMAINS.has(domain);
}

function makeOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function makeResetCode() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

// ---------- Register ----------
router.post("/register", async (req, res) => {
  try {
    const { register_no, email, password } = req.body;

    if (!register_no || !email || !password) {
      return res.status(400).json({ error: "Register number, email, and password are required" });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Please enter a valid email address" });
    }
    if (isDisposableEmail(email)) {
      return res.status(400).json({
        error: "Temporary/disposable emails are not allowed. Please use a real email (Gmail, etc.).",
      });
    }
    if (!isValidPassword(password)) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const cleanRegisterNo = String(register_no).trim();
    const student = await one("SELECT * FROM students WHERE register_no = $1", [cleanRegisterNo]);
    if (!student) {
      return res.status(404).json({
        error: "That register number was not found in the CHE class roster. Please check and try again.",
      });
    }

    const existingByRegNo = await one("SELECT id FROM users WHERE register_no = $1", [cleanRegisterNo]);
    if (existingByRegNo) {
      return res.status(409).json({ error: "An account already exists for this register number." });
    }
    const existingByEmail = await one("SELECT id FROM users WHERE email = $1", [
      email.toLowerCase().trim(),
    ]);
    if (existingByEmail) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const hash = bcrypt.hashSync(password, 10);
    const otp = makeOtp();
    const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    // If real email is configured, send OTP first — reject if send fails
    // (this stops people using fake inboxes)
    let emailSent = false;
    if (EMAIL_CONFIGURED) {
      try {
        await sendMail({
          to: email,
          subject: "Your Lost & Found verification code",
          html: `
            <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:20px">
              <h2>Welcome, ${student.name}!</h2>
              <p>Your verification code is:</p>
              <p style="font-size:32px;font-weight:bold;letter-spacing:6px;background:#f0f4f8;padding:16px;text-align:center;border-radius:8px">${otp}</p>
              <p>Enter this code on the website to activate your account.</p>
              <p style="color:#888;font-size:12px">Code expires in 30 minutes. Roll No: ${student.roll_no}</p>
            </div>
          `,
        });
        emailSent = true;
      } catch (err) {
        console.error("Email send failed:", err.message);
        return res.status(502).json({
          error:
            "Could not send verification email. Check that the address is correct and try again. (If this keeps failing, the server email settings may be wrong.)",
        });
      }
    }

    const result = await query(
      `INSERT INTO users (name, register_no, roll_no, email, password, role, verified, verify_token, verify_token_expires)
       VALUES ($1, $2, $3, $4, $5, 'student', 0, $6, $7)
       RETURNING id`,
      [student.name, student.register_no, student.roll_no, email.toLowerCase().trim(), hash, otp, expires]
    );

    console.log(`\n======== VERIFICATION OTP for ${email}: ${otp} ========\n`);

    // If email is NOT configured (local/dev), still return OTP so testing works
    // If email IS configured, do NOT return OTP — user must open their inbox
    const payload = {
      message: emailSent
        ? `Account created for ${student.name}! Check your email inbox (and Spam) for the 6-digit code.`
        : `Account created for ${student.name}! Use the verification code shown below.`,
      userId: result.rows[0].id,
      studentName: student.name,
      rollNo: student.roll_no,
      emailSent: emailSent || !EMAIL_CONFIGURED,
    };
    if (!EMAIL_CONFIGURED) {
      payload.otp = otp; // demo/dev only
    }

    res.status(201).json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Registration failed. Please try again." });
  }
});

// ---------- Verify OTP ----------
router.post("/verify", async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ error: "Email and verification code are required" });
    }

    const user = await one("SELECT * FROM users WHERE email = $1", [email.toLowerCase().trim()]);
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.verified) return res.status(400).json({ error: "Account is already verified. You can log in." });

    if (user.verify_token !== String(code).trim()) {
      return res.status(400).json({ error: "Invalid verification code" });
    }
    if (new Date(user.verify_token_expires) < new Date()) {
      return res.status(400).json({ error: "Verification code has expired. Please request a new one." });
    }

    await query(
      "UPDATE users SET verified = 1, verify_token = NULL, verify_token_expires = NULL WHERE id = $1",
      [user.id]
    );

    const token = jwt.sign(
      { id: user.id, name: user.name, role: user.role, roll_no: user.roll_no },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.json({
      message: "Email verified successfully! You are now logged in.",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        register_no: user.register_no,
        roll_no: user.roll_no,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Verification failed" });
  }
});

router.get("/verify/:token", async (req, res) => {
  try {
    const user = await one(
      "SELECT * FROM users WHERE verify_token = $1 AND verify_token_expires > NOW()",
      [req.params.token]
    );
    if (!user) {
      return res.send("<h2>This verification link is invalid or has expired.</h2>");
    }
    await query(
      "UPDATE users SET verified = 1, verify_token = NULL, verify_token_expires = NULL WHERE id = $1",
      [user.id]
    );
    res.send("<h2>Email verified!</h2><p>You can now go back to the app and log in.</p>");
  } catch (err) {
    console.error(err);
    res.status(500).send("<h2>Verification failed</h2>");
  }
});

// ---------- Resend verification OTP ----------
router.post("/resend-verification", async (req, res) => {
  try {
    const { email } = req.body;
    const user = await one("SELECT * FROM users WHERE email = $1", [
      (email || "").toLowerCase().trim(),
    ]);

    const genericMsg = { message: "If that account exists and isn't verified yet, a new code has been sent." };
    if (!user || user.verified) return res.json(genericMsg);

    const otp = makeOtp();
    const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    await query("UPDATE users SET verify_token = $1, verify_token_expires = $2 WHERE id = $3", [
      otp,
      expires,
      user.id,
    ]);

    console.log(`\n======== RESEND OTP for ${email}: ${otp} ========\n`);

    if (EMAIL_CONFIGURED) {
      try {
        await sendMail({
          to: email,
          subject: "Your new Lost & Found verification code",
          html: `<p>Your new code is: <strong style="font-size:24px">${otp}</strong></p><p>Expires in 30 minutes.</p>`,
        });
      } catch (err) {
        console.error("Failed to resend verification email:", err.message);
        return res.status(502).json({ error: "Could not send email. Try again later." });
      }
      return res.json({ message: "A new code was sent to your email. Check inbox and Spam." });
    }

    // Dev mode without email config
    res.json({ ...genericMsg, otp });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to resend code" });
  }
});

// ---------- Login ----------
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await one("SELECT * FROM users WHERE email = $1", [
      (email || "").toLowerCase().trim(),
    ]);

    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    if (!user.verified) {
      return res.status(403).json({
        error: "Please verify your email with the 6-digit code before logging in.",
        unverified: true,
      });
    }

    const token = jwt.sign(
      { id: user.id, name: user.name, role: user.role, roll_no: user.roll_no },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        register_no: user.register_no,
        roll_no: user.roll_no,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

// ---------- Forgot password ----------
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    const user = await one("SELECT * FROM users WHERE email = $1", [
      (email || "").toLowerCase().trim(),
    ]);

    const genericMsg = { message: "If that email is registered, a reset code has been sent." };
    if (!user) return res.json(genericMsg);

    const code = makeResetCode();
    const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    await query("UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3", [
      code,
      expires,
      user.id,
    ]);

    console.log(`\n======== PASSWORD RESET CODE for ${email}: ${code} ========\n`);

    if (EMAIL_CONFIGURED) {
      try {
        await sendMail({
          to: email,
          subject: "Password reset code - Lost & Found",
          html: `<p>Your password reset code is: <strong style="font-size:24px">${code}</strong></p><p>Expires in 30 minutes.</p>`,
        });
      } catch (err) {
        console.error("Failed to send reset email:", err.message);
      }
      return res.json(genericMsg);
    }

    res.json({ ...genericMsg, resetCode: code });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to process request" });
  }
});

// ---------- Reset password ----------
router.post("/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ error: "Code and new password are required" });
    }
    if (!isValidPassword(password)) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const user = await one(
      "SELECT * FROM users WHERE reset_token = $1 AND reset_token_expires > NOW()",
      [String(token).trim().toUpperCase()]
    );

    if (!user) {
      return res.status(400).json({ error: "Invalid or expired reset code" });
    }

    const hash = bcrypt.hashSync(password, 10);
    await query(
      "UPDATE users SET password = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2",
      [hash, user.id]
    );

    res.json({ message: "Password updated successfully. You can now log in." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Password reset failed" });
  }
});

// ---------- Change email (logged-in) ----------
// Step 1: request — send OTP to the NEW email
router.post("/change-email", requireAuth, async (req, res) => {
  try {
    const { newEmail } = req.body;
    if (!newEmail || !isValidEmail(newEmail)) {
      return res.status(400).json({ error: "Enter a valid new email address" });
    }
    if (isDisposableEmail(newEmail)) {
      return res.status(400).json({ error: "Temporary/disposable emails are not allowed." });
    }

    const clean = newEmail.toLowerCase().trim();
    const existing = await one("SELECT id FROM users WHERE email = $1", [clean]);
    if (existing) {
      return res.status(409).json({ error: "That email is already used by another account." });
    }

    const otp = makeOtp();
    const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    // Store pending change on the user row (reuse verify_token fields while verified=1)
    await query(
      "UPDATE users SET verify_token = $1, verify_token_expires = $2 WHERE id = $3",
      [`change:${clean}:${otp}`, expires, req.user.id]
    );

    console.log(`\n======== CHANGE EMAIL OTP for ${clean}: ${otp} ========\n`);

    if (EMAIL_CONFIGURED) {
      try {
        await sendMail({
          to: clean,
          subject: "Confirm your new email - Lost & Found",
          html: `<p>Your code to confirm the new email is:</p>
                 <p style="font-size:28px;font-weight:bold;letter-spacing:4px">${otp}</p>
                 <p>Expires in 30 minutes.</p>`,
        });
      } catch (err) {
        console.error("Change-email send failed:", err.message);
        return res.status(502).json({ error: "Could not send code to that email. Check the address." });
      }
      return res.json({ message: `Code sent to ${clean}. Check inbox and Spam.`, emailSent: true });
    }

    // Dev without email config
    res.json({ message: `Use this code to confirm: ${otp}`, otp, emailSent: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to start email change" });
  }
});

// Step 2: confirm with OTP
router.post("/confirm-change-email", requireAuth, async (req, res) => {
  try {
    const { newEmail, code } = req.body;
    if (!newEmail || !code) {
      return res.status(400).json({ error: "New email and code are required" });
    }

    const clean = newEmail.toLowerCase().trim();
    const user = await one("SELECT * FROM users WHERE id = $1", [req.user.id]);
    if (!user) return res.status(404).json({ error: "User not found" });

    const expected = `change:${clean}:${String(code).trim()}`;
    if (user.verify_token !== expected) {
      return res.status(400).json({ error: "Invalid code or email mismatch" });
    }
    if (new Date(user.verify_token_expires) < new Date()) {
      return res.status(400).json({ error: "Code expired. Request a new one." });
    }

    const taken = await one("SELECT id FROM users WHERE email = $1 AND id != $2", [clean, user.id]);
    if (taken) {
      return res.status(409).json({ error: "That email was just taken by another account." });
    }

    await query(
      "UPDATE users SET email = $1, verify_token = NULL, verify_token_expires = NULL WHERE id = $2",
      [clean, user.id]
    );

    const token = jwt.sign(
      { id: user.id, name: user.name, role: user.role, roll_no: user.roll_no },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.json({
      message: "Email updated successfully.",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: clean,
        role: user.role,
        register_no: user.register_no,
        roll_no: user.roll_no,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to confirm email change" });
  }
});

module.exports = router;
