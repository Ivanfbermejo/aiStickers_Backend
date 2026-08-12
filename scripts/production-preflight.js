#!/usr/bin/env node
/**
 * Non-destructive production configuration gate.
 *
 * This script validates configuration shape and safety only. It never connects
 * to PostgreSQL, Redis or object storage and it never prints configuration
 * values. Runtime connectivity belongs to the Docker smoke and readiness
 * checks.
 */

import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { loadConfig, validateEnv } from '../src/config/env.js';
import { isValidSentryDsn } from '../src/infrastructure/observability/sentry-dsn.js';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const NODE_ENGINE = packageJson.engines?.node || 'unspecified';
const minimumNodeMatch = String(NODE_ENGINE).match(/>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
const MINIMUM_NODE_VERSION = minimumNodeMatch
  ? [Number(minimumNodeMatch[1]), Number(minimumNodeMatch[2] || 0), Number(minimumNodeMatch[3] || 0)]
  : null;

const DISABLED_RELEASE_FLAGS = [
  'HMAC_LEGACY_V1_ENABLED',
  'ENABLE_TEST_JWTS',
  'ENABLE_APPLE_PAYMENTS',
  'ENABLE_TELEGRAM',
  'ENABLE_WHATSAPP_EXPORT'
];

const EXTERNAL_URL_VARIABLES = [
  'ASSET_STORAGE_ENDPOINT'
];

function addError(errors, message) {
  if (!errors.includes(message)) errors.push(message);
}

function parseNodeVersion(value) {
  const match = String(value || '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function isNodeVersionCompatible(version = process.versions.node) {
  const actual = parseNodeVersion(version);
  if (!actual || !MINIMUM_NODE_VERSION) return false;
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] > MINIMUM_NODE_VERSION[index]) return true;
    if (actual[index] < MINIMUM_NODE_VERSION[index]) return false;
  }
  return true;
}

function parseExternalUrl(value, name) {
  if (!value || value.trim() === '') return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return `${name} must be a valid HTTPS URL`;
  }
  if (parsed.protocol !== 'https:') {
    return `${name} must use HTTPS in production`;
  }
  if (!parsed.hostname || parsed.username || parsed.password) {
    return `${name} must not contain credentials`;
  }
  return null;
}

function validateExternalUrls(rawEnv, config, errors) {
  for (const name of EXTERNAL_URL_VARIABLES) {
    const error = parseExternalUrl(rawEnv[name], name);
    if (error) addError(errors, error);
  }

  const sentryDsn = rawEnv.SENTRY_DSN;
  if (sentryDsn && sentryDsn.trim() !== '' && !isValidSentryDsn(sentryDsn)) {
    addError(errors, 'SENTRY_DSN must be a valid HTTPS Sentry DSN without a password');
  }

  const origins = Array.isArray(config?.CORS_ORIGINS) ? config.CORS_ORIGINS : [];
  for (const origin of origins) {
    const error = parseExternalUrl(origin, 'CORS_ORIGINS');
    if (error) addError(errors, error);
  }
}

function validateReleaseFlags(config, errors) {
  for (const name of DISABLED_RELEASE_FLAGS) {
    if (config?.[name] === true) {
      addError(errors, `${name} must be false for this production release`);
    }
  }

  if (config?.ENABLE_EXTERNAL_IMAGE_URLS !== false) {
    addError(errors, 'ENABLE_EXTERNAL_IMAGE_URLS must be false for this production release');
  }
}

function rejectUnsafePlaceholders(rawEnv, errors) {
  if (Object.values(rawEnv).some(value => typeof value === 'string' && value.includes('CHANGE_ME'))) {
    addError(errors, 'production environment values must not contain CHANGE_ME');
  }
}

/**
 * Validate a production environment without performing external I/O.
 * Returns structured errors so unit tests and deployment tooling can consume
 * the result without parsing console output.
 */
export function validateProductionEnvironment(rawEnv = process.env, { nodeVersion = process.versions.node } = {}) {
  const errors = [];
  let config;

  if (rawEnv.NODE_ENV !== 'production') {
    addError(errors, 'NODE_ENV must be exactly production');
  }
  if (!isNodeVersionCompatible(nodeVersion)) {
    addError(errors, `Node.js ${nodeVersion} is incompatible; project requires ${NODE_ENGINE}`);
  }
  rejectUnsafePlaceholders(rawEnv, errors);

  try {
    config = loadConfig(rawEnv);
  } catch (error) {
    addError(errors, error?.message || 'invalid production configuration');
    return { ok: false, config: null, errors };
  }

  try {
    validateEnv(config);
  } catch (error) {
    addError(errors, error?.message || 'production configuration is incomplete');
  }

  validateReleaseFlags(config, errors);
  validateExternalUrls(rawEnv, config, errors);

  if (config.GENERATION_QUEUE_ENABLED !== true) {
    addError(errors, 'GENERATION_QUEUE_ENABLED must be true for backend and worker');
  }

  if (!config.REDIS_URL) {
    addError(errors, 'REDIS_URL is required for backend and worker');
  }

  return { ok: errors.length === 0, config, errors };
}

/**
 * Redact values defensively before a validation error is displayed. The
 * validator itself only emits variable names, but this also protects against
 * future parser errors that include a URL or environment value.
 */
export function sanitizePreflightError(error, rawEnv = process.env) {
  let message = String(error?.message || error || 'production preflight failed');
  const values = Object.entries(rawEnv)
    .filter(([name, value]) => {
      if (typeof value !== 'string' || value.length < 4) return false;
      return /SECRET|TOKEN|PASSWORD|KEY|ACCOUNT|DATABASE_URL|REDIS_URL|DSN/i.test(name)
        || value.includes('://')
        || value.length >= 24;
    })
    .map(([, value]) => value)
    .sort((left, right) => right.length - left.length);
  for (const value of values) {
    message = message.split(value).join('[redacted]');
  }
  message = message.replace(/(https?:\/\/)[^\s/]+:[^\s/@]+@/gi, '$1[redacted]@');
  message = message.replace(/(postgres(?:ql)?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@');
  return message;
}

export function runProductionPreflight(rawEnv = process.env) {
  const result = validateProductionEnvironment(rawEnv);
  if (result.ok) {
    console.log('Production preflight passed.');
    return result;
  }

  console.error('Production preflight failed:');
  for (const error of result.errors) {
    console.error(`- ${sanitizePreflightError(error, rawEnv)}`);
  }
  return result;
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const result = runProductionPreflight();
  if (!result.ok) process.exitCode = 1;
}
