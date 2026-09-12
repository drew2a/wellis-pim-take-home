/**
 * Stamped on every import run and normalisation record (ADR-0004). Bump when a mapping rule
 * changes: ADR-0008 counts records per (rule_code, importer_version), and a later version that
 * maps the same raw value elsewhere adds a row instead of editing one.
 */
export const IMPORTER_VERSION = '1.0.0';
