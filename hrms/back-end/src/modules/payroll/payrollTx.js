exports.safeRollback = async (client) => {
  if (!client) return;
  try {
    await client.query("ROLLBACK");
  } catch (_) {
    // swallow rollback errors to preserve original failure
  }
};
