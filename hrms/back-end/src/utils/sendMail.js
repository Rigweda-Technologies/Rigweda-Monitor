const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
// const logger = require("../logger/logger");

// Create transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: process.env.SMTP_PORT || 587,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

/**
 * Load and render template
 */
const renderTemplate = (template, data = {}, ext = "html") => {
  const filePath = path.join(
    __dirname,
    "..",
    "templates",
    `${template}.${ext}`
  );

  if (!fs.existsSync(filePath)) return null;

  let content = fs.readFileSync(filePath, "utf8");

  Object.keys(data).forEach(key => {
    const regex = new RegExp(`{{${key}}}`, "g");
    content = content.replace(regex, data[key]);
  });

  return content;
};

/**
 * Send email utility (extended, backward compatible)
 *
 * @param {string} template - otp | user-created | reset-password | etc.
 * @param {string} toName
 * @param {string} subject
 * @param {string|object} content - string (old) OR data object (new)
 * @param {string} toEmail
 */
module.exports = async (template, toName, subject, content, toEmail) => {
  try {
    let html = "";
    let text = "";

    /**
     * 🔹 OTP (OLD FLOW – UNTOUCHED)
     */
    if (template === "otp") {
      html = `
        <p>Hello ${toName || "User"},</p>
        <p>Your OTP is:</p>
        <h2>${content}</h2>
        <p>This OTP is valid for 10 minutes.</p>
      `;
      text = `Your OTP is: ${content}`;
    }

    /**
     * 🔹 TEMPLATE-BASED EMAIL (NEW)
     */
    else if (typeof content === "object") {
      html = renderTemplate(template, content, "html");
      text = renderTemplate(template, content, "txt");

      if (!html) {
        throw new Error(`Email template not found: ${template}`);
      }
    }

    /**
     * 🔹 FALLBACK (OLD BEHAVIOR)
     */
    else {
      html = `<p>${content}</p>`;
      text = content;
    }

    await transporter.sendMail({
      from: process.env.SMTP_USER || "HRMS <no-reply@luvetha.com>",
      to: toEmail,
      subject,
      html,
      text
    });

    // logger.info("Email sent", { template, toEmail });
    return true;
  } catch (err) {
    console.log(err,"------");
    
    // logger.error("Failed to send email", {
    //   error: err.message,
    //   template,
    //   toEmail
    // });

    // ❗ Do not break app for email failure
    return false;
  }
};
