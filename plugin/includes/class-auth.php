<?php
/**
 * API Key Authentication
 *
 * @package InspectAfrica_Bridge
 */

if (!defined('ABSPATH')) {
    exit;
}

class IAB_Auth {

    /**
     * Verify API key from request
     */
    public static function verify_api_key(WP_REST_Request $request): bool|WP_Error {
        $api_key = $request->get_header('X_IA_API_Key');
        
        if (empty($api_key)) {
            $api_key = $request->get_param('api_key');
        }

        if (empty($api_key)) {
            return new WP_Error(
                'missing_api_key',
                'API key is required',
                ['status' => 401]
            );
        }

        $stored_key = IAB_Database::get_setting('api_key');

        if (!hash_equals($stored_key, $api_key)) {
            return new WP_Error(
                'invalid_api_key',
                'Invalid API key',
                ['status' => 403]
            );
        }

        return true;
    }

    /**
     * Check rate limit for IP
     */
    public static function check_rate_limit(string $ip): bool|WP_Error {
        $rate_limiter = new IAB_Rate_Limiter();
        return $rate_limiter->check($ip);
    }

    /**
     * Check if IP is blocked
     */
    public static function is_ip_blocked(string $ip): bool {
        global $wpdb;
        $table = IAB_Database::table('blocked_ips');

        $blocked = $wpdb->get_var($wpdb->prepare(
            "SELECT id FROM $table WHERE ip_address = %s AND is_active = 1 AND (expires_at IS NULL OR expires_at > NOW())",
            $ip
        ));

        return (bool) $blocked;
    }

    /**
     * Block an IP address
     */
    public static function block_ip(string $ip, string $reason, ?string $expires = null): bool {
        global $wpdb;
        $table = IAB_Database::table('blocked_ips');

        $data = [
            'ip_address' => $ip,
            'reason' => $reason,
            'is_active' => 1,
        ];

        if ($expires) {
            $data['expires_at'] = $expires;
        }

        $existing = $wpdb->get_var($wpdb->prepare(
            "SELECT id FROM $table WHERE ip_address = %s",
            $ip
        ));

        if ($existing) {
            return (bool) $wpdb->update($table, $data, ['ip_address' => $ip]);
        }

        return (bool) $wpdb->insert($table, $data);
    }

    /**
     * Unblock an IP address
     */
    public static function unblock_ip(string $ip, int $admin_user_id): bool {
        global $wpdb;
        $table = IAB_Database::table('blocked_ips');

        return (bool) $wpdb->update(
            $table,
            [
                'is_active' => 0,
                'unblocked_at' => current_time('mysql'),
                'unblocked_by' => $admin_user_id,
            ],
            ['ip_address' => $ip]
        );
    }

    /**
     * Generate new API key
     */
    public static function regenerate_api_key(): string {
        $new_key = wp_generate_password(32, false);
        IAB_Database::update_setting('api_key', $new_key, get_current_user_id());
        return $new_key;
    }
}
