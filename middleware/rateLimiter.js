const rateLimit = require("express-rate-limit");

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many attempts. Please try again in a few minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { authLimiter };
