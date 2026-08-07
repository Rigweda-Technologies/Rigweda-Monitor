const crypto = require("node:crypto");

const createFieldEncryption = (secret) => {
  const key = crypto.createHash("sha256").update(secret).digest();
  return {
    protect(value) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
      const authTag = cipher.getAuthTag();
      const visible = String(value).replace(/\s+/g, "");
      return {ciphertext, iv, authTag, maskedValue: `${"•".repeat(Math.max(0, visible.length - 4))}${visible.slice(-4)}`};
    }
  };
};

module.exports = {createFieldEncryption};
