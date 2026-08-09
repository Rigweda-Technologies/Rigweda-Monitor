const Agent = require("./agent.model");

exports.getCurrentAgent = async (req) => {
  const profile = await Agent.findCurrentAgentProfile({
    userId: req.user.userId,
    organizationId: req.user.organizationId
  });

  if (!profile) {
    throw { code: 404, message: "Agent profile not found" };
  }

  return profile;
};
