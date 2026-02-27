/**
 * Utils barrel — re-exports all utilities from one import point.
 *
 * Usage:
 *   import { safeTargetPath, scoreCredential } from '../utils/index.js';
 */

export {
  safeTargetPath,
  resolveTargetPathSync,
} from './safeTargetPath.js';

export {
  scoreCredential,
  scoreCredentials,
  rescoreAfterValidation,
} from './credentialScoring.js';

export type {
  CredentialInput,
  ScoreBreakdown,
  ScoringResult,
} from './credentialScoring.js';
