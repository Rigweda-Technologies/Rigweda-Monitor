exports.throwIfNotFound = (entity, message = "Not found") => {
  if (!entity) {
    throw { code: 404, message };
  }
};

exports.throwIfExists = (entity, message = "Already exists") => {
  if (entity) {
    throw { code: 400, message };
  }
};

exports.paginate = ({ page = 1, limit = 10 }) => {
  page = Number(page);
  limit = Number(limit);
  return {
    skip: (page - 1) * limit,
    limit,
    page
  };
};
