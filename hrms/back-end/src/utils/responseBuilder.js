/**
 * Build success API response
 */
exports.buildSuccessResponse = ({
  code = 200,
  message = "Success",
  data = null
}) => {
  return {
    success: true,
    code,
    message,
    data,
    error: null
  };
};

/**
 * Build failure API response (optional)
 */
exports.buildFailureResponse = ({
  code = 500,
  message = "Something went wrong",
  error = null
}) => {
  return {
    success: false,
    code,
    message,
    data: null,
    error
  };
};
