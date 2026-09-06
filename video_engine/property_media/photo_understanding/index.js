/**
 * Ponto de Entrada do Módulo Photo Understanding (Fase 4B.2)
 * Bali Imóveis — Video Engine V2
 */

const schema = require('./photo_analysis_schema');
const evaluator = require('./quality_evaluator');
const reconciler = require('./crm_category_reconciler');
const service = require('./photo_media_understanding_service');
const BasePhotoUnderstandingProvider = require('./providers/base_photo_understanding_provider');
const MockPhotoUnderstandingProvider = require('./providers/mock_photo_understanding_provider');
const OpenAIPhotoUnderstandingProvider = require('./providers/openai_photo_understanding_provider');

module.exports = {
  ...schema,
  ...evaluator,
  ...reconciler,
  ...service,
  BasePhotoUnderstandingProvider,
  MockPhotoUnderstandingProvider,
  OpenAIPhotoUnderstandingProvider
};
