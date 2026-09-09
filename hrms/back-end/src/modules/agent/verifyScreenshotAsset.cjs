const { v2: cloudinary } = require('cloudinary');
// Retrieve the expected asset using this organization's server credentials.
module.exports = async function verifyScreenshotAsset(settings, row) {
  const fail = () => Object.assign(new Error('Screenshot upload could not be verified. Retry completion.'), { code: 503, statusCode: 503 });
  if (!settings?.apiSecret || !row.cloudinary_public_id) throw fail();
  const folder = String(row.cloudinary_folder || '').replace(/^\/+|\/+$/g, '');
  const stored = row.cloudinary_public_id;
  const publicId = folder && !stored.startsWith(`${folder}/`) ? `${folder}/${stored}` : stored;
  let asset;
  try {
    asset = await cloudinary.api.resource(publicId, {
      cloud_name: settings.cloudName, api_key: settings.apiKey, api_secret: settings.apiSecret,
      resource_type: 'image', type: 'authenticated', timeout: 10000,
    });
  } catch { throw fail(); }
  if (asset.public_id !== publicId || asset.resource_type !== 'image' || !asset.asset_id
      || !Number.isInteger(asset.version) || !asset.secure_url?.startsWith('https://')
      || !Number.isFinite(asset.bytes) || asset.bytes <= 0) throw fail();
  return {
    cloudinaryAssetId: asset.asset_id, cloudinaryVersion: asset.version,
    cloudinaryFormat: asset.format, cloudinaryUrl: asset.secure_url, sizeBytes: asset.bytes,
  };
};
