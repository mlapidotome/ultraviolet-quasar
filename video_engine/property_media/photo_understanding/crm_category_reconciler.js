/**
 * Reconciliador e Normalizador de Categorias do CRM — Photo Media Understanding (Fase 4B.2)
 * Bali Imóveis — Video Engine V2
 */

const CRM_CATEGORY_MAPPER_VERSION = '1.0.0';

const VAGUE_CRM_CATEGORIES = new Set([
  'unidade',
  'geral',
  'outros',
  'fotos',
  'diversas',
  'imovel',
  'imóvel',
  'padrao',
  'padrão',
  ''
]);

const SPECIFIC_CRM_CATEGORY_MAP = Object.freeze({
  'quarto': 'bedroom',
  'quartos': 'bedroom',
  'dormitorio': 'bedroom',
  'dormitório': 'bedroom',
  'dormitorios': 'bedroom',
  'dormitórios': 'bedroom',
  'dorm': 'bedroom',
  'suite': 'suite',
  'suíte': 'suite',
  'suites': 'suite',
  'suítes': 'suite',
  'sala': 'living_room',
  'salas': 'living_room',
  'living': 'living_room',
  'estar': 'living_room',
  'sala de estar': 'living_room',
  'sala de tv': 'living_room',
  'sala de jantar': 'dining_room',
  'jantar': 'dining_room',
  'cozinha': 'kitchen',
  'cozinhas': 'kitchen',
  'copa': 'kitchen',
  'banheiro': 'bathroom',
  'banheiros': 'bathroom',
  'lavabo': 'bathroom',
  'wc': 'bathroom',
  'sacada': 'balcony',
  'sacadas': 'balcony',
  'varanda': 'balcony',
  'varandas': 'balcony',
  'terraço': 'balcony',
  'terraco': 'balcony',
  'fachada': 'facade',
  'fachadas': 'facade',
  'garagem': 'garage',
  'garagens': 'garage',
  'vaga': 'garage',
  'vagas': 'garage',
  'lazer': 'leisure',
  'piscina': 'leisure',
  'churrasqueira': 'leisure',
  'playground': 'leisure',
  'academia': 'leisure',
  'salao de festas': 'leisure',
  'salão de festas': 'leisure',
  'área de serviço': 'laundry',
  'area de servico': 'laundry',
  'lavanderia': 'laundry',
  'corredor': 'hallway',
  'hall': 'hallway',
  'hall de entrada': 'hallway',
  'jardim': 'exterior',
  'quintal': 'exterior',
  'exterior': 'exterior',
  'vista': 'city_view',
  'panoramica': 'city_view',
  'panorâmica': 'city_view'
});

class CrmCategoryReconciler {
  /**
   * Normaliza a categoria livre do CRM
   */
  static normalizeCrmCategory(rawCategory) {
    if (!rawCategory || typeof rawCategory !== 'string') {
      return {
        raw_crm_category: rawCategory || null,
        normalized_crm_room_hint: null,
        comparable: false
      };
    }

    const clean = rawCategory.toLowerCase().trim();
    if (VAGUE_CRM_CATEGORIES.has(clean)) {
      return {
        raw_crm_category: rawCategory,
        normalized_crm_room_hint: null,
        comparable: false
      };
    }

    const mapped = SPECIFIC_CRM_CATEGORY_MAP[clean];
    if (mapped) {
      return {
        raw_crm_category: rawCategory,
        normalized_crm_room_hint: mapped,
        comparable: true
      };
    }

    // Se categoria textual específica não mapeada, tratar como não-comparável para evitar falso positivo
    return {
      raw_crm_category: rawCategory,
      normalized_crm_room_hint: null,
      comparable: false
    };
  }

  /**
   * Avalia reconciliação semântica entre CRM e predição visual do VLM
   */
  static reconcileSemanticMatch(crmNorm, semantic = {}) {
    if (!crmNorm.comparable || !crmNorm.normalized_crm_room_hint) {
      return {
        divergence_detected: false,
        divergence_reason: 'crm_category_not_comparable'
      };
    }

    const hint = crmNorm.normalized_crm_room_hint;
    const primary = semantic.primary_room_type || null;
    const secondaries = Array.isArray(semantic.secondary_room_types) ? semantic.secondary_room_types : [];

    if (hint === primary || secondaries.includes(hint)) {
      return {
        divergence_detected: false,
        divergence_reason: null
      };
    }

    return {
      divergence_detected: true,
      divergence_reason: 'crm_hint_mismatch'
    };
  }

  /**
   * Projeção em Runtime de PropertyPhotoSemanticView
   * Combina o asset da propriedade com o GlobalPhotoAnalysis sem contaminar o cache global.
   */
  static projectSemanticView(propertyPhotoAsset, globalPhotoAnalysis) {
    if (!propertyPhotoAsset || !globalPhotoAnalysis) {
      throw new Error('[RECONCILER_ERROR] propertyPhotoAsset e globalPhotoAnalysis são obrigatórios');
    }

    const rawCategory = propertyPhotoAsset.metadata?.categoria ||
                        propertyPhotoAsset.metadata?.category ||
                        propertyPhotoAsset.categoria ||
                        null;

    const crmNorm = this.normalizeCrmCategory(rawCategory);
    const reconciliation = this.reconcileSemanticMatch(crmNorm, globalPhotoAnalysis.semantic);

    return {
      asset_id: propertyPhotoAsset.asset_id || propertyPhotoAsset.id,
      property_ref: String(propertyPhotoAsset.property_ref || ''),
      physical_file_hash: globalPhotoAnalysis.physical_file_hash,
      photo_analysis_key: globalPhotoAnalysis.photo_analysis_key,
      crm_context: {
        crm_photo_id: propertyPhotoAsset.metadata?.crm_photo_id || null,
        crm_sources: propertyPhotoAsset.metadata?.crm_sources || [],
        raw_crm_category: crmNorm.raw_crm_category,
        normalized_crm_room_hint: crmNorm.normalized_crm_room_hint,
        comparable: crmNorm.comparable
      },
      semantic_reconciliation: {
        divergence_detected: reconciliation.divergence_detected,
        divergence_reason: reconciliation.divergence_reason,
        crm_category_mapper_version: CRM_CATEGORY_MAPPER_VERSION
      },
      semantic: globalPhotoAnalysis.semantic,
      quality: globalPhotoAnalysis.quality,
      analyzer_provenance: globalPhotoAnalysis.analyzer_provenance
    };
  }
}

module.exports = {
  CrmCategoryReconciler,
  CRM_CATEGORY_MAPPER_VERSION,
  VAGUE_CRM_CATEGORIES,
  SPECIFIC_CRM_CATEGORY_MAP
};
