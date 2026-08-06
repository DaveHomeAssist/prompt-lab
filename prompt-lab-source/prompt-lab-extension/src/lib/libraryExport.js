import { normalizeLibrary } from './promptSchema.js';

export const NATIVE_LIBRARY_EXPORT_TYPE = 'prompt-lab-library';
export const NATIVE_LIBRARY_EXPORT_SCHEMA_VERSION = 1;

export function buildNativeLibraryExport({ library = [], collections = [], exportedAt = new Date().toISOString(), appVersion = '1.7.0' } = {}) {
  const records = normalizeLibrary(library);
  return {
    type: NATIVE_LIBRARY_EXPORT_TYPE,
    version: appVersion,
    schemaVersion: NATIVE_LIBRARY_EXPORT_SCHEMA_VERSION,
    exportedAt,
    count: records.length,
    library: records,
    collections: Array.isArray(collections) ? [...collections] : [],
  };
}

export function parseNativeLibraryExport(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Native library export must be an object.');
  }
  if (value.type && value.type !== NATIVE_LIBRARY_EXPORT_TYPE) {
    throw new Error(`Unsupported library export type: ${value.type}`);
  }
  if (!Array.isArray(value.library)) {
    throw new Error('Native library export is missing its library array.');
  }
  return {
    library: normalizeLibrary(value.library),
    collections: Array.isArray(value.collections) ? [...value.collections] : [],
  };
}
