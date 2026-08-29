<?php
/**
 * JWT Authentication
 * HS256 tokens signed with WordPress SECURE_AUTH_KEY.
 *
 * @package InspectAfrica_Bridge
 */

if (!defined('ABSPATH')) {
    exit;
}

class IAB_JWT {

    const ALGORITHM  = 'HS256';
    const EXPIRY_SEC = 7 * DAY_IN_SECONDS;

    /**
     * Issue a JWT for a verified WordPress user.
     */
    public static function issue(int $user_id): string {
        $issued_at = time();
        $expires   = $issued_at + self::EXPIRY_SEC;

        $header  = self::base64_url_encode(json_encode(['typ' => 'JWT', 'alg' => self::ALGORITHM]));
        $payload = self::base64_url_encode(json_encode([
            'iss' => get_site_url(),
            'iat' => $issued_at,
            'exp' => $expires,
            'sub' => $user_id,
        ]));

        $signature = self::base64_url_encode(
            hash_hmac('sha256', "$header.$payload", self::secret(), true)
        );

        return "$header.$payload.$signature";
    }

    /**
     * Validate a JWT and return the payload, or WP_Error on failure.
     */
    public static function validate(string $token): array|WP_Error {
        $parts = explode('.', $token);

        if (count($parts) !== 3) {
            return new WP_Error('jwt_malformed', 'Malformed token', ['status' => 401]);
        }

        [$header, $payload, $signature] = $parts;

        // Verify signature
        $expected = self::base64_url_encode(
            hash_hmac('sha256', "$header.$payload", self::secret(), true)
        );

        if (!hash_equals($expected, $signature)) {
            return new WP_Error('jwt_invalid_signature', 'Invalid token signature', ['status' => 401]);
        }

        $data = json_decode(self::base64_url_decode($payload), true);

        if (!$data) {
            return new WP_Error('jwt_malformed', 'Cannot decode token payload', ['status' => 401]);
        }

        if (empty($data['exp']) || time() > $data['exp']) {
            return new WP_Error('jwt_expired', 'Token has expired', ['status' => 401]);
        }

        if (empty($data['sub'])) {
            return new WP_Error('jwt_invalid', 'Token missing subject', ['status' => 401]);
        }

        return $data;
    }

    /**
     * Extract and validate a Bearer token from a REST request.
     */
    public static function from_request(WP_REST_Request $request): array|WP_Error {
        $auth = $request->get_header('Authorization');

        if (empty($auth) || !str_starts_with($auth, 'Bearer ')) {
            return new WP_Error('jwt_missing', 'Authorization Bearer token required', ['status' => 401]);
        }

        return self::validate(substr($auth, 7));
    }

    private static function secret(): string {
        return defined('SECURE_AUTH_KEY') ? SECURE_AUTH_KEY : wp_salt('secure_auth');
    }

    private static function base64_url_encode(string $data): string {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    private static function base64_url_decode(string $data): string {
        return base64_decode(strtr($data, '-_', '+/'));
    }
}
