/**
 * Módulo de Content-Addressed Blob Store para Fotos — Video Engine V2
 * Bali Imóveis (Fase 4B.1)
 * 
 * Responsabilidades:
 * 1. Armazenamento global content-addressed imutável em outputs/media_blobs/photos/
 * 2. Cálculo determinístico de streaming SHA-256 dos bytes reais (physical_file_hash)
 * 3. Publicação Atômica No-Clobber (COPYFILE_EXCL) com prevenção total de overwrite
 * 4. Deduplicação segura: Winner publica, Loser detecta EEXIST, valida hash e descarta apenas staging
 * 5. Proteção de Integridade: Em caso de hash divergente, lança CANONICAL_BLOB_INTEGRITY_ERROR
 *    e NUNCA executa unlink, truncate ou repair sobre o arquivo canônico compartilhado
 * 6. Identidade determinística de Property Asset (property-scoped: ast_pimg_<32-chars>)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OUTPUTS_BASE_DIR = path.join(__dirname, '..', '..', '..', 'outputs');
const PHOTO_BLOBS_DIR = path.join(OUTPUTS_BASE_DIR, 'media_blobs', 'photos');

// Garantir que a pasta base de blobs existe
if (!fs.existsSync(PHOTO_BLOBS_DIR)) {
  fs.mkdirSync(PHOTO_BLOBS_DIR, { recursive: true });
}

/**
 * Cálculo de Hash Físico via Streaming SHA-256 (O(N) nos bytes do arquivo)
 * @param {string} filePath
 * @returns {Promise<string>} Hex SHA-256
 */
async function computeFileHashStream(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`[PHOTO_BLOB_STORE] Arquivo físico não encontrado: ${filePath}`);
  }

  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', err => reject(err));
  });
}

/**
 * Identidade do Property Asset (Property-Scoped: 41 chars <= 64 chars)
 * @param {string|number} propertyRef
 * @param {string} physicalFileHash
 * @returns {string} ex: ast_pimg_3a7b9f...
 */
function computePropertyPhotoAssetId(propertyRef, physicalFileHash) {
  if (!propertyRef || !physicalFileHash) {
    throw new Error('[PHOTO_BLOB_STORE] propertyRef e physicalFileHash são obrigatórios para computePropertyPhotoAssetId');
  }
  const raw = `${String(propertyRef).trim()}:${String(physicalFileHash).trim()}`;
  const hash32 = crypto.createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 32);
  return `ast_pimg_${hash32}`;
}

/**
 * Validação de Path Containment dentro do Blob Store
 * @param {string} targetPath
 * @param {string} baseDir
 * @returns {boolean}
 */
function isPathContained(targetPath, baseDir = PHOTO_BLOBS_DIR) {
  if (!targetPath || !baseDir) return false;
  const rel = path.relative(path.resolve(baseDir), path.resolve(targetPath));
  return Boolean(rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Publicação Atômica No-Clobber de Staging para o Blob Canônico Global
 * 
 * Invariantes Críticos:
 * - Publicação é CREATE IF ABSENT via fs.copyFileSync com flag COPYFILE_EXCL.
 * - Em caso de sucesso: o worker remove APENAS seu arquivo de staging temporário.
 * - Em caso de EEXIST (outro worker publicou antes):
 *   - Calcula existingHash do canonicalPath.
 *   - Se existingHash === physicalFileHash: Dedup Hit! Remove APENAS staging e reutiliza o canonical.
 *   - Se existingHash !== physicalFileHash: Lança CANONICAL_BLOB_INTEGRITY_ERROR, remove APENAS staging,
 *     e NUNCA executa unlink/truncate/overwrite/repair no canonical blob compartilhado.
 * 
 * @param {string} stagingPath Caminho do arquivo temporário validado
 * @param {string} physicalFileHash Hash SHA-256 já validado dos bytes
 * @param {string} normalizedExt Extensão canônica (ex: '.jpg')
 * @returns {Promise<{ canonicalPath: string, physicalFileHash: string, dedup_hit: boolean }>}
 */
async function publishCanonicalBlobNoClobber(stagingPath, physicalFileHash, normalizedExt = '.jpg') {
  if (!stagingPath || !fs.existsSync(stagingPath)) {
    throw new Error(`[PHOTO_BLOB_STORE] Arquivo de staging inexistente: ${stagingPath}`);
  }
  if (!physicalFileHash || typeof physicalFileHash !== 'string' || physicalFileHash.length !== 64) {
    throw new Error(`[PHOTO_BLOB_STORE] physicalFileHash inválido: ${physicalFileHash}`);
  }

  const cleanExt = normalizedExt.startsWith('.') ? normalizedExt : `.${normalizedExt}`;
  const canonicalFilename = `${physicalFileHash}${cleanExt}`;
  const canonicalPath = path.join(PHOTO_BLOBS_DIR, canonicalFilename);

  if (!fs.existsSync(PHOTO_BLOBS_DIR)) {
    fs.mkdirSync(PHOTO_BLOBS_DIR, { recursive: true });
  }

  try {
    // Tentativa atômica exclusiva de cópia (NO-CLOBBER)
    fs.copyFileSync(stagingPath, canonicalPath, fs.constants.COPYFILE_EXCL);

    // Sucesso na primeira publicação (Winner)
    // Remove APENAS seu próprio arquivo temporário
    if (fs.existsSync(stagingPath)) {
      try { fs.unlinkSync(stagingPath); } catch (e) {}
    }

    return {
      canonicalPath,
      physicalFileHash,
      dedup_hit: false
    };
  } catch (err) {
    if (err.code === 'EEXIST') {
      // Destino já existe (Loser em corrida ou re-ingestão de foto conhecida)
      const existingHash = await computeFileHashStream(canonicalPath);

      if (existingHash === physicalFileHash) {
        // Idempotência segura / Deduplicação
        if (fs.existsSync(stagingPath)) {
          try { fs.unlinkSync(stagingPath); } catch (e) {}
        }

        return {
          canonicalPath,
          physicalFileHash,
          dedup_hit: true
        };
      } else {
        // Corrupção ou colisão grave no filesystem
        // Regra de Ouro: Remove APENAS staging, NUNCA executa unlink no canonicalPath
        if (fs.existsSync(stagingPath)) {
          try { fs.unlinkSync(stagingPath); } catch (e) {}
        }

        const integrityErr = new Error(`[CANONICAL_BLOB_INTEGRITY_ERROR] Canonical blob em ${canonicalPath} possui hash divergente (esperado: ${physicalFileHash}, encontrado: ${existingHash})`);
        integrityErr.code = 'CANONICAL_BLOB_INTEGRITY_ERROR';
        integrityErr.expectedHash = physicalFileHash;
        integrityErr.actualHash = existingHash;
        integrityErr.canonicalPath = canonicalPath;
        throw integrityErr;
      }
    }

    // Qualquer outro erro inesperado: limpar apenas staging e repassar erro
    if (fs.existsSync(stagingPath)) {
      try { fs.unlinkSync(stagingPath); } catch (e) {}
    }
    throw err;
  }
}

/**
 * Validação de integridade física de um blob canônico existente
 * 
 * @param {string} canonicalPath Caminho absoluto do blob
 * @param {string} expectedHash Hash SHA-256 esperado
 * @returns {Promise<{ valid: boolean, reason?: string, size_bytes?: number }>}
 */
async function verifyCanonicalBlobIntegrity(canonicalPath, expectedHash) {
  if (!canonicalPath || typeof canonicalPath !== 'string') {
    return { valid: false, reason: 'CANONICAL_PATH_EMPTY' };
  }

  if (!isPathContained(canonicalPath, PHOTO_BLOBS_DIR)) {
    return { valid: false, reason: 'PATH_TRAVERSAL_DETECTED' };
  }

  if (!fs.existsSync(canonicalPath)) {
    return { valid: false, reason: 'PHYSICAL_FILE_MISSING' };
  }

  const stat = fs.statSync(canonicalPath);
  if (stat.size === 0) {
    return { valid: false, reason: 'EMPTY_FILE' };
  }

  if (expectedHash) {
    const actualHash = await computeFileHashStream(canonicalPath);
    if (actualHash !== expectedHash) {
      return {
        valid: false,
        reason: `FILE_HASH_MISMATCH: expected ${expectedHash}, got ${actualHash}`
      };
    }
  }

  return {
    valid: true,
    size_bytes: stat.size
  };
}

module.exports = {
  PHOTO_BLOBS_DIR,
  computeFileHashStream,
  computePropertyPhotoAssetId,
  isPathContained,
  publishCanonicalBlobNoClobber,
  verifyCanonicalBlobIntegrity
};
