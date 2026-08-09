const resolvePositiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const getDefaultMaxActiveLoginsPerUser = () =>
  resolvePositiveInteger(process.env.MAX_ACTIVE_LOGINS_PER_USER_DEFAULT, 1);

module.exports = {
  getDefaultMaxActiveLoginsPerUser
};
