const KEY_REGEX = /^[A-Za-z0-9:_-]{8,120}$/;

module.exports = (options = {}) => {
  const { enforce = false } = options;

  return (req, res, next) => {
    const raw = req.headers?.["idempotency-key"] || req.headers?.["x-idempotency-key"];
    const key = raw ? String(raw).trim() : "";

    if (!key) {
      if (enforce) {
        return res.status(400).json({
          success: false,
          code: 400,
          message: "Idempotency-Key header is required for this action",
          data: null,
          error: null
        });
      }
      return next();
    }

    if (!KEY_REGEX.test(key)) {
      return res.status(406).json({
        success: false,
        code: 406,
        message:
          "Invalid Idempotency-Key format. Use 8-120 chars with letters, numbers, colon, underscore or hyphen.",
        data: null,
        error: null
      });
    }

    req.idempotencyKey = key;
    return next();
  };
};
