const { v2: cloudinary } = require('cloudinary');
// Retrieve the expected asset using this organization's server credentials.
module.exports = async function verifyScreenshotAsset(settings, row) {
  const fail = () => Object.assign(new Error('Screenshot upload could not be verified. Retry completion.'), { code: 503, statusCode: 503 });
  if (!settings?.apiSecret || !row.cloudinary_public_id) throw fail();
  const folder = String(row.cloudinary_folder || '').replace(/^\/+|\/+$/g, '');
  const stored = row.cloudinary_public_id;
  const publicId = folder && !stored.startsWith(`${folder}/`) ? `${folder}/${stored}` : stored;
  let asset;
  let verifiedPublicId = publicId;
  let lastError;
  const publicIdCandidates = [...new Set([publicId, stored].filter(Boolean))];
  // Cloudinary can accept an upload just before its Admin API can retrieve it.
  // Retry briefly so a normal propagation delay does not make the desktop
  // upload the same file again.
  for (const delayMs of [0, 400, 1_000, 2_000]) {
    if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
    for (const candidate of publicIdCandidates) {
      // Existing installations may contain either authenticated or standard
      // upload assets. Both are safe to verify because the public ID came from
      // the server-created upload session, not from the desktop client.
      for (const type of ['authenticated', 'upload']) {
        try {
          asset = await cloudinary.api.resource(candidate, {
            cloud_name: settings.cloudName, api_key: settings.apiKey, api_secret: settings.apiSecret,
            resource_type: 'image', type, timeout: 10000,
          });
          verifiedPublicId = candidate;
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (asset) break;
    }
    if (asset) break;
  }
  if (!asset) {
    console.warn('Cloudinary screenshot verification failed.', {
      publicIdCandidates,
      providerCode: lastError?.http_code || lastError?.code,
      providerMessage: lastError?.message
    });
    throw fail();
  }
  if (asset.public_id !== verifiedPublicId || asset.resource_type !== 'image' || !asset.asset_id
      || !Number.isInteger(asset.version) || !asset.secure_url?.startsWith('https://')
      || !Number.isFinite(asset.bytes) || asset.bytes <= 0) throw fail();
  return {
    cloudinaryAssetId: asset.asset_id, cloudinaryVersion: asset.version,
    cloudinaryFormat: asset.format, cloudinaryUrl: asset.secure_url, sizeBytes: asset.bytes,
  };
};
