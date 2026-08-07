const { AppError } = require("../lib/app-error");

const validate = (schema) => (req, _res, next) => {
  const { value, error } = schema.validate(
    { body: req.body, params: req.params, query: req.query },
    { abortEarly: false, stripUnknown: true, convert: true }
  );
  if (error) {
    return next(new AppError(422, "VALIDATION_ERROR", "The request contains invalid data.",
      error.details.map((item) => ({ field: item.path.slice(1).join("."), message: item.message }))));
  }
  req.validated = value;
  return next();
};

module.exports = { validate };
