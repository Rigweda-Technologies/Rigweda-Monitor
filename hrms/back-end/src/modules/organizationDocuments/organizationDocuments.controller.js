const service = require("./organizationDocuments.service");
const { buildSuccessResponse } = require("../../utils/responseBuilder");
const https = require("https");

const pipeRemoteFile = (url, res, { fileName, disposition }) => {
  https
    .get(url, (remoteRes) => {
      if ([301, 302, 303, 307, 308].includes(remoteRes.statusCode) && remoteRes.headers.location) {
        remoteRes.resume();
        return pipeRemoteFile(remoteRes.headers.location, res, { fileName, disposition });
      }

      if (remoteRes.statusCode >= 400) {
        remoteRes.resume();
        return res.status(remoteRes.statusCode).json({
          success: false,
          code: remoteRes.statusCode,
          message: "Unable to fetch document",
          data: null,
          error: null
        });
      }

      res.setHeader("Content-Type", remoteRes.headers["content-type"] || "application/octet-stream");
      res.setHeader("Cache-Control", "private, no-store, max-age=0");
      res.setHeader(
        "Content-Disposition",
        `${disposition}; filename="${String(fileName || "document").replace(/"/g, "")}"`
      );
      remoteRes.pipe(res);
    })
    .on("error", () => {
      if (!res.headersSent) {
        res.status(502).json({
          success: false,
          code: 502,
          message: "Unable to fetch document",
          data: null,
          error: null
        });
      }
    });
};

exports.catalog = async (req, res) => {
  const data = await service.getCatalog(req);
  res.status(200).json(buildSuccessResponse({ data }));
};

exports.list = async (req, res) => {
  const data = await service.list(req);
  res.status(200).json(buildSuccessResponse({ data }));
};

exports.summary = async (req, res) => {
  const data = await service.summary(req);
  res.status(200).json(buildSuccessResponse({ data }));
};

exports.missing = async (req, res) => {
  const data = await service.missing(req);
  res.status(200).json(buildSuccessResponse({ data }));
};

exports.expiringSoon = async (req, res) => {
  const data = await service.expiringSoon(req);
  res.status(200).json(buildSuccessResponse({ data }));
};

exports.upload = async (req, res) => {
  const data = await service.uploadOrReplace(req);
  res.status(200).json(buildSuccessResponse({ message: "Document uploaded", data }));
};

exports.updateMetadata = async (req, res) => {
  const data = await service.updateMetadata(req);
  res.status(200).json(buildSuccessResponse({ message: "Document updated", data }));
};

exports.access = async (req, res) => {
  const data = await service.getSignedAccess(req);
  res.status(200).json(buildSuccessResponse({ data }));
};

exports.preview = async (req, res) => {
  const { doc, url } = await service.getDocumentStreamAccess(req);
  pipeRemoteFile(url, res, { fileName: doc.fileName, disposition: "inline" });
};

exports.download = async (req, res) => {
  req.query.download = "true";
  const { doc, url } = await service.getDocumentStreamAccess(req);
  pipeRemoteFile(url, res, { fileName: doc.fileName, disposition: "attachment" });
};

exports.deleteById = async (req, res) => {
  const data = await service.deleteById(req);
  res.status(200).json(buildSuccessResponse({ message: "Document deleted", data }));
};
