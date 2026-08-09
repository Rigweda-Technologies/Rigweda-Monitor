const Holiday = require("./holiday.model");
const { audit } = require("../auditLogs/auditLogs.service");

exports.create = async (req) => {

    const holidayDate = new Date(req.body.date);
    const year = holidayDate.getFullYear();

    const exists = await Holiday.findOne({
        organizationId: req.user.organizationId,
        date: holidayDate,
        year
    });

    if (exists) {
        throw new Error("Holiday already exists for this year");
    }
    const holiday = await Holiday.create({
        ...req.body,
        date: holidayDate,
        year,
        organizationId: req.user.organizationId
    });

  await audit({
    req,
    module: "holidays",
    action: "CREATE",
    entityId: holiday._id,
    after: holiday.toObject()
  });

  return holiday;
};

exports.list = async (req) => {
  const year = req.query.year || new Date().getFullYear();
  return Holiday.find({
    organizationId: req.user.organizationId,
    year
  }).sort({ date: 1 });
};

exports.update = async (id, req) => {
  const holiday = await Holiday.findOneAndUpdate(
    { _id: id, organizationId: req.user.organizationId },
    req.body,
    { new: true }
  );

  if (!holiday) throw new Error("Holiday not found");

  return holiday;
};

exports.remove = async (id, req) => {
  const holiday = await Holiday.findOneAndUpdate(
    { _id: id, organizationId: req.user.organizationId },
    { isDeleted: true },
    { new: true }
  );

  if (!holiday) throw new Error("Holiday not found");

  return true;
};
