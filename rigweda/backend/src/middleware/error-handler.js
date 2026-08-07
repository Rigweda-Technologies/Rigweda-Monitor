const notFound = (req, res) => res.status(404).json({
  success: false,
  error: { code: "ROUTE_NOT_FOUND", message: "The requested resource was not found." },
  requestId: req.id
});

const errorHandler = (error, req, res, _next) => {
  const status = error.statusCode || 500;
  if (status >= 500) req.log?.error({ err: error }, "Request failed");
  else req.log?.warn({ code:error.code,status }, "Request rejected");
  res.status(status).json({
    success: false,
    error: {
      code: error.code || "INTERNAL_ERROR",
      message: status === 500 ? "An unexpected error occurred." : error.message,
      ...(error.details ? { details: error.details } : {})
    },
    requestId: req.id
  });
};

module.exports = { notFound, errorHandler };
