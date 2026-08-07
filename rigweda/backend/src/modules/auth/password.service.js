const crypto = require("node:crypto");
const argon2 = require("argon2");

const materialize = (password, pepper) => crypto.createHmac("sha512", pepper).update(password, "utf8").digest();

const createPasswordService = (pepper) => ({
  hash: (password) => argon2.hash(materialize(password, pepper), {
    type: argon2.argon2id,
    salt: crypto.randomBytes(16),
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 1,
    hashLength: 32
  }),
  verify: async (encodedHash, password) => {
    try { return await argon2.verify(encodedHash, materialize(password, pepper)); }
    catch { return false; }
  }
});

module.exports = { createPasswordService };
