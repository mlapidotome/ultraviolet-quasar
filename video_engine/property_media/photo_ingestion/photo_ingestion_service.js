/**
 * Módulo de Ingestão e Materialização de Fotos do CRM — Video Engine V2
 * Bali Imóveis (Fase 4B.1)
 * 
 * Responsabilidades:
 * 1. Orquestração end-to-end do pipeline de fotos do CRM:
 *    CRM fotos -> Download seguro -> Validação física -> Full decode -> SHA-256 -> Content-Addressed Blob -> video_assets
 * 2. Preservação de proveniência completa do CRM (crm_sources array)
 * 3. Separação formal de identidades (Property-Scoped Asset ID vs Global Physical Blob Hash)
 * 4. Deduplicação segura e re-uso físico com validação de integridade O(N)
 * 5. Exposição de fotos no Property Media Pool
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getPool } = require('../../db');
const jobService = require('../../job_service');
const { downloadPhotoToStaging, DEFAULT_ALLOWED_HOSTS } = require('./photo_downloader');
const { validatePhotoImage } = require('./photo_validator');
const {
  computeFileHashStream,
  computePropertyPhotoAssetId,
  publishCanonicalBlobNoClobber,
  verifyCanonicalBlobIntegrity,
  PHOTO_BLOBS_DIR
} = require('./photo_blob_store');

class PhotoIngestionService {
  constructor(options = {}) {
    this.allowedHosts = options.allowedHosts || DEFAULT_ALLOWED_HOSTS;
    this.minShortEdgePx = options.minShortEdgePx || 480;
    this.maxAspectRatio = options.maxAspectRatio || 3.0;
    this.downloadTimeoutMs = options.downloadTimeoutMs || 15000;
    this.maxSizeMb = options.maxSizeMb || 25;
  }

  /**
   * Chave determinística de geração / discovery para video_assets
   * @param {string|number} propertyRef
   * @param {string} physicalFileHash
   * @returns {string}
   */
  computeGenerationKey(propertyRef, physicalFileHash) {
    const raw = `pimg:${String(propertyRef).trim()}:${String(physicalFileHash).trim()}`;
    return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
  }

  /**
   * Ingestão completa de fotos do imóvel a partir do CRM
   * 
   * @param {string|number} propertyRef Código/referência do imóvel no CRM
   * @param {Object} options Configurações adicionais
   * @returns {Promise<Object>} Relatório detalhado da ingestão
   */
  async ingestPropertyPhotos(propertyRef, options = {}) {
    if (!propertyRef) {
      throw new Error('[PHOTO_INGESTION_SERVICE] propertyRef é obrigatório');
    }

    const cleanRef = String(propertyRef).trim().replace(/\D/g, '');
    if (!cleanRef) {
      throw new Error(`[PHOTO_INGESTION_SERVICE] propertyRef inválido: ${propertyRef}`);
    }

    const pool = getPool();
    const token = options.token || `ingest_${cleanRef}_${Date.now()}`;

    // 1. Obter dados oficiais do imóvel no CRM
    const imovel = await jobService.fetchImovelData(cleanRef);
    const rawFotos = imovel?.fotos || [];

    if (!Array.isArray(rawFotos) || rawFotos.length === 0) {
      return {
        property_ref: cleanRef,
        total_crm_photos: 0,
        accepted_count: 0,
        rejected_count: 0,
        dedup_hits: 0,
        unique_blobs: 0,
        property_assets_count: 0,
        crm_photos: [],
        results: [],
        assets: []
      };
    }

    // Registro inicial do CRM para auditoria
    const crmDiscoveryList = rawFotos.map((f, idx) => {
      const url = typeof f === 'string' ? f : (f.url || f.link || f.url_menor);
      const urlMenor = typeof f === 'object' ? f.url_menor : null;
      let host = 'invalid';
      try { host = new URL(url).hostname; } catch (e) {}

      return {
        crm_index: idx + 1,
        crm_photo_id: typeof f === 'object' ? (f.id || f.crm_photo_id || null) : null,
        categoria: typeof f === 'object' ? (f.categoria || 'Unidade') : 'Unidade',
        posicao: typeof f === 'object' ? (f.posicao !== undefined ? f.posicao : idx + 1) : idx + 1,
        destaque: typeof f === 'object' ? Boolean(f.destaque) : (idx === 0),
        url,
        url_menor: urlMenor,
        host
      };
    });

    const results = [];
    const assetsByHash = new Map();
    let acceptedCount = 0;
    let rejectedCount = 0;
    let dedupHits = 0;
    let totalBytesDownloaded = 0;

    for (const item of crmDiscoveryList) {
      const itemResult = {
        crm_index: item.crm_index,
        crm_photo_id: item.crm_photo_id,
        host: item.host,
        categoria: item.categoria,
        posicao: item.posicao,
        destaque: item.destaque,
        url: item.url,
        url_menor: item.url_menor,
        status_download: 'pending',
        bytes: 0,
        width: 0,
        height: 0,
        format: '',
        short_edge: 0,
        aspect_ratio: 0,
        accepted: false,
        rejection_reason: null,
        physical_hash: null,
        asset_id: null,
        dedupe_hit: false,
        storage_path: null
      };

      try {
        if (!item.url) {
          throw new Error('URL_NOT_PROVIDED');
        }

        // 2. Download seguro para staging isolado
        const downloadRes = await downloadPhotoToStaging(item.url, {
          token,
          allowedHosts: this.allowedHosts,
          timeoutMs: this.downloadTimeoutMs,
          maxSizeMb: this.maxSizeMb
        });

        itemResult.status_download = 'success';
        itemResult.bytes = downloadRes.bytesDownloaded;
        totalBytesDownloaded += downloadRes.bytesDownloaded;

        // 3. Hashing físico streaming dos bytes reais
        const physicalFileHash = await computeFileHashStream(downloadRes.stagingPath);
        itemResult.physical_hash = physicalFileHash;

        // 4. Validação física estrutural + FFmpeg full decode + Thresholds
        const validation = await validatePhotoImage(downloadRes.stagingPath, {
          minShortEdgePx: this.minShortEdgePx,
          maxAspectRatio: this.maxAspectRatio
        });

        itemResult.width = validation.width;
        itemResult.height = validation.height;
        itemResult.format = validation.format;
        itemResult.short_edge = validation.short_edge;
        itemResult.aspect_ratio = validation.aspect_ratio;

        // 5. Publicação No-Clobber no content-addressed blob store
        const pubResult = await publishCanonicalBlobNoClobber(
          downloadRes.stagingPath,
          physicalFileHash,
          validation.normalized_ext
        );

        itemResult.dedupe_hit = pubResult.dedup_hit;
        itemResult.storage_path = pubResult.canonicalPath;
        if (pubResult.dedup_hit) dedupHits++;

        // 6. Property-Scoped Asset Identity
        const assetId = computePropertyPhotoAssetId(cleanRef, physicalFileHash);
        itemResult.asset_id = assetId;

        // 7. Proveniência CRM completa
        const crmSourceMeta = {
          crm_photo_id: item.crm_photo_id,
          posicao: item.posicao,
          destaque: item.destaque,
          categoria: item.categoria,
          url: item.url,
          url_menor: item.url_menor,
          host: item.host,
          discovered_at: new Date().toISOString()
        };

        const specs = {
          width: validation.width,
          height: validation.height,
          format: validation.format,
          codec: validation.codec,
          aspect_ratio: validation.aspect_ratio,
          short_edge: validation.short_edge,
          file_size_bytes: validation.file_size_bytes,
          normalized_ext: validation.normalized_ext
        };

        const genKey = this.computeGenerationKey(cleanRef, physicalFileHash);

        // 8. Registro/Upsert Atômico no Catálogo de Assets (video_assets)
        // Se este mesmo hash físico já apareceu nesta propriedade, unificamos crm_sources
        if (assetsByHash.has(physicalFileHash)) {
          const existingAsset = assetsByHash.get(physicalFileHash);
          existingAsset.metadata.crm_sources.push(crmSourceMeta);

          await pool.query(
            `UPDATE video_assets 
             SET metadata = $2, updated_at = NOW() 
             WHERE id = $1`,
            [assetId, JSON.stringify(existingAsset.metadata)]
          );
        } else {
          const initialMetadata = {
            property_ref: cleanRef,
            crm_photo_id: item.crm_photo_id,
            categoria: item.categoria,
            posicao: item.posicao,
            destaque: item.destaque,
            crm_sources: [crmSourceMeta],
            ingestion_token: token,
            thresholds_used: {
              min_short_edge_px: this.minShortEdgePx,
              max_aspect_ratio: this.maxAspectRatio
            }
          };

          // Query atômica com ON CONFLICT (id) DO UPDATE para concorrência segura
          const insertQuery = `
            INSERT INTO video_assets (
              id,
              property_ref,
              asset_type,
              storage_type,
              storage_path,
              file_hash,
              generation_key,
              status,
              specs,
              metadata,
              created_at,
              updated_at
            ) VALUES ($1, $2, 'property_photo', 'local_file', $3, $4, $5, 'ready', $6, $7, NOW(), NOW())
            ON CONFLICT (id) DO UPDATE 
            SET storage_path = EXCLUDED.storage_path,
                file_hash = EXCLUDED.file_hash,
                status = 'ready',
                specs = EXCLUDED.specs,
                metadata = EXCLUDED.metadata,
                updated_at = NOW()
            RETURNING *;
          `;

          const dbRes = await pool.query(insertQuery, [
            assetId,
            cleanRef,
            pubResult.canonicalPath,
            physicalFileHash,
            genKey,
            JSON.stringify(specs),
            JSON.stringify(initialMetadata)
          ]);

          assetsByHash.set(physicalFileHash, dbRes.rows[0]);
        }

        itemResult.accepted = true;
        acceptedCount++;
      } catch (err) {
        itemResult.accepted = false;
        itemResult.rejection_reason = err.message;
        rejectedCount++;
      }

      results.push(itemResult);
    }

    const uniqueAssets = Array.from(assetsByHash.values());

    return {
      property_ref: cleanRef,
      total_crm_photos: rawFotos.length,
      accepted_count: acceptedCount,
      rejected_count: rejectedCount,
      dedup_hits: dedupHits,
      unique_blobs: uniqueAssets.length,
      property_assets_count: uniqueAssets.length,
      total_bytes_downloaded: totalBytesDownloaded,
      crm_photos: crmDiscoveryList,
      results,
      assets: uniqueAssets
    };
  }

  /**
   * Consulta e validação de fotos prontas da propriedade
   * @param {string|number} propertyRef
   * @returns {Promise<Array<Object>>}
   */
  async getReadyPropertyPhotos(propertyRef) {
    if (!propertyRef) return [];
    const cleanRef = String(propertyRef).trim().replace(/\D/g, '');
    if (!cleanRef) return [];

    const pool = getPool();
    const query = `
      SELECT * FROM video_assets 
      WHERE property_ref = $1 
        AND asset_type = 'property_photo' 
        AND status = 'ready' 
      ORDER BY created_at ASC;
    `;

    const res = await pool.query(query, [cleanRef]);
    const validPhotos = [];

    for (const row of res.rows) {
      const integrity = await verifyCanonicalBlobIntegrity(row.storage_path, row.file_hash);
      if (integrity.valid) {
        validPhotos.push({
          asset_id: row.id,
          asset_type: 'property_photo',
          role: 'property_photo',
          property_ref: row.property_ref,
          storage_path: row.storage_path,
          file_hash: row.file_hash,
          specs: row.specs || {},
          metadata: row.metadata || {}
        });
      } else {
        console.warn(`[PHOTO_INGESTION_SERVICE] Photo asset ${row.id} ignorado por falha física: ${integrity.reason}`);
      }
    }

    return validPhotos;
  }
}

module.exports = {
  PhotoIngestionService,
  defaultPhotoIngestionService: new PhotoIngestionService()
};
