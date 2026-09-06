/**
 * Ponto de entrada do módulo Photo Ingestion — Video Engine V2
 * Bali Imóveis (Fase 4B.1)
 */

const {
  downloadPhotoToStaging,
  isIpBlocked,
  isHostAllowed,
  validateUrl,
  createSecureAgent,
  DEFAULT_ALLOWED_HOSTS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_SIZE_MB
} = require('./photo_downloader');

const {
  validatePhotoImage,
  probeImageStructure,
  fullDecodeImage,
  normalizeCanonicalExtension,
  DEFAULT_MIN_SHORT_EDGE_PX,
  DEFAULT_MAX_ASPECT_RATIO
} = require('./photo_validator');

const {
  PHOTO_BLOBS_DIR,
  computeFileHashStream,
  computePropertyPhotoAssetId,
  isPathContained,
  publishCanonicalBlobNoClobber,
  verifyCanonicalBlobIntegrity
} = require('./photo_blob_store');

const {
  PhotoIngestionService,
  defaultPhotoIngestionService
} = require('./photo_ingestion_service');

module.exports = {
  // Service
  PhotoIngestionService,
  defaultPhotoIngestionService,
  // Downloader
  downloadPhotoToStaging,
  isIpBlocked,
  isHostAllowed,
  validateUrl,
  createSecureAgent,
  DEFAULT_ALLOWED_HOSTS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_SIZE_MB,
  // Validator
  validatePhotoImage,
  probeImageStructure,
  fullDecodeImage,
  normalizeCanonicalExtension,
  DEFAULT_MIN_SHORT_EDGE_PX,
  DEFAULT_MAX_ASPECT_RATIO,
  // Blob Store
  PHOTO_BLOBS_DIR,
  computeFileHashStream,
  computePropertyPhotoAssetId,
  isPathContained,
  publishCanonicalBlobNoClobber,
  verifyCanonicalBlobIntegrity
};
