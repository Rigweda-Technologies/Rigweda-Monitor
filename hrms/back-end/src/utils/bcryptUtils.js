const bcrypt = require("bcryptjs");

const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 10);

/**
 * Hash a plain text password
 * @param {string} password
 * @returns {Promise<string>}
 */
const genHashedPassword = async (password) => {
  if (!password) {
    throw new Error("Password is required for hashing");
  }
  return bcrypt.hash(password, SALT_ROUNDS);
};

/**
 * Compare plain password with hashed password
 * @param {string} password
 * @param {string} hashedPassword
 * @returns {Promise<boolean>}
 */
const checkPasswords = async (password, hashedPassword) => {
  if (!password || !hashedPassword) {
    return false;
  }
  return bcrypt.compare(password, hashedPassword);
};

module.exports = {
  genHashedPassword,
  checkPasswords
};
