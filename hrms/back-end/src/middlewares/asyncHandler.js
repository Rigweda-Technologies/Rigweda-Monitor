// module.exports = (fn) => (req, res, next) =>
//   Promise.resolve(fn(req, res, next)).catch(next);

module.exports = (fn) => {
  if (typeof fn !== "function") {
    console.error("❌ asyncHandler received:", fn);
    throw new Error("asyncHandler expects a function");
  }

  return (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
};
