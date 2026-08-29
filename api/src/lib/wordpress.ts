/**
 * WordPress Bridge API Client
 * Connects to the InspectAfrica WordPress plugin for ACHI certification verification
 */
import { logger } from './logger.js';

export interface CertVerificationResult {
  valid: boolean;
  name?: string;
  issued?: string;
  expires?: string;
  status?: string;
}

/**
 * Raw shape returned by the WordPress plugin's /verify-cert endpoint
 * (IAB_Cert_Manager::verify()) — field names differ from our own
 * CertVerificationResult, so they need mapping, not a blind cast.
 */
interface WordPressCertResponse {
  valid: boolean;
  status?: string;
  achi_number?: string;
  full_name?: string;
  email?: string;
  issued_at?: string;
  expires_at?: string;
  verification_count?: number;
  error?: string;
}

function mapWordPressCertResponse(raw: WordPressCertResponse): CertVerificationResult {
  return {
    valid: raw.valid,
    name: raw.full_name,
    issued: raw.issued_at,
    expires: raw.expires_at,
    status: raw.status,
  };
}

const WP_BASE_URL = process.env.WP_BASE_URL || '';
const WP_API_KEY = process.env.WP_API_KEY || '';

/**
 * Verify an ACHI certificate number via WordPress bridge
 */
export async function verifyCert(achiNumber: string): Promise<CertVerificationResult> {
  if (!WP_BASE_URL || !WP_API_KEY) {
    logger.warn('WordPress bridge not configured: missing WP_BASE_URL or WP_API_KEY');
    return { valid: false, status: 'not_configured' };
  }

  try {
    const response = await fetch(
      `${WP_BASE_URL}/wp-json/inspectafrica/v1/verify-cert`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-IA-API-Key': WP_API_KEY,
        },
        body: JSON.stringify({ achi_number: achiNumber }),
        signal: AbortSignal.timeout(8000), // 8 second timeout
      }
    );

    if (!response.ok) {
      logger.error({ statusCode: response.status, achiNumber }, 'WordPress bridge error');
      return { valid: false, status: 'error' };
    }

    const result = (await response.json()) as WordPressCertResponse;
    return mapWordPressCertResponse(result);
  } catch (error) {
    logger.error({ err: error, achiNumber }, 'WordPress bridge request failed');
    return { valid: false, status: 'error' };
  }
}

/**
 * Test WordPress bridge connectivity
 */
export async function testConnection(): Promise<boolean> {
  if (!WP_BASE_URL || !WP_API_KEY) {
    return false;
  }

  try {
    const response = await fetch(
      `${WP_BASE_URL}/wp-json/inspectafrica/v1/`,
      {
        method: 'HEAD',
        headers: { 'X-IA-API-Key': WP_API_KEY },
        signal: AbortSignal.timeout(5000),
      }
    );
    return response.ok;
  } catch {
    return false;
  }
}
