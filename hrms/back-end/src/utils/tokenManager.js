exports.rotateUserToken = async (UserModel, userId, newToken, options = {}) => {
  const globalLimit = Number(process.env.TOKEN_LIST_LIMIT || 10);
  const organizationId = options.organizationId || null;
  const maxActiveLoginsPerUser = Number(options.maxActiveLoginsPerUser || 1);

  try {
    const user = await UserModel.findById(userId).select("tokenList");
    if (!user) {
      throw new Error("User not found while rotating token");
    }

    const nextTokenEntry = {
      token: newToken,
      organizationId,
      loginTimestamp: new Date().toISOString(),
      status: "active"
    };

    const existingTokens = Array.isArray(user.tokenList) ? user.tokenList : [];
    const sameOrgTokens = [];
    const otherTokens = [];

    existingTokens.forEach((entry) => {
      const entryOrgId = entry?.organizationId ? String(entry.organizationId) : null;
      if (organizationId && entryOrgId === String(organizationId)) {
        sameOrgTokens.push(entry);
      } else {
        otherTokens.push(entry);
      }
    });

    const trimmedSameOrgTokens = [nextTokenEntry, ...sameOrgTokens]
      .slice(0, Math.max(1, maxActiveLoginsPerUser));
    const nextTokenList = [...trimmedSameOrgTokens, ...otherTokens].slice(0, globalLimit);

    const result = await UserModel.updateOne(
      { _id: userId },
      {
        $set: {
          tokenList: nextTokenList,
          lastLoginAt: new Date()
        }
      }
    );

    if (result.matchedCount === 0) {
      throw new Error("User not found while rotating token");
    }

    return true;
  } catch (err) {
    console.error("❌ rotateUserToken failed:", err);
    throw err;
  }
};
