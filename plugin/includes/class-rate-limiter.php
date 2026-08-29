<?php
/**
 * Rate Limiter
 *
 * @package InspectAfrica_Bridge
 */

if (!defined('ABSPATH')) {
    exit;
}

class IAB_Rate_Limiter {

    /** @var int */
    private $max_requests;

    /** @var int */
    private $window_seconds;

    /**
     * Constructor
     */
    public function __construct(?int $max = null, ?int $window = null) {
        $this->max_requests = $max ?? (int) IAB_Database::get_setting('rate_limit_max', 100);
        $this->window_seconds = $window ?? (int) IAB_Database::get_setting('rate_limit_window', 3600);
    }

    /**
     * Check if IP is within rate limit
     */
    public function check(string $ip): bool|WP_Error {
        global $wpdb;

        // Check if blocked first
        if (IAB_Auth::is_ip_blocked($ip)) {
            return new WP_Error(
                'ip_blocked',
                'Your IP has been blocked due to too many requests',
                ['status' => 403]
            );
        }

        $transient_key = 'iab_rate_' . md5($ip);
        $requests = (int) get_transient($transient_key);

        if ($requests >= $this->max_requests) {
            // Log the block
            $this->log_block($ip, $requests);

            return new WP_Error(
                'rate_limit_exceeded',
                sprintf('Rate limit exceeded. Max %d requests per %d seconds.', $this->max_requests, $this->window_seconds),
                ['status' => 429]
            );
        }

        // Increment counter
        set_transient($transient_key, $requests + 1, $this->window_seconds);

        return true;
    }

    /**
     * Log rate limit block
     */
    private function log_block(string $ip, int $attempts): void {
        global $wpdb;
        $table = IAB_Database::table('api_activity');

        $wpdb->insert($table, [
            'request_id' => IAB_Database::generate_request_id(),
            'endpoint' => 'rate_limit',
            'method' => 'BLOCKED',
            'ip_address' => $ip,
            'result' => 'blocked',
            'response_code' => 429,
            'error_message' => "Exceeded {$attempts} requests",
        ]);

        // Auto-block if too many blocks
        $block_count = $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM $table WHERE ip_address = %s AND result = 'blocked' AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)",
            $ip
        ));

        if ($block_count >= 5) {
            IAB_Auth::block_ip($ip, 'Auto-blocked: repeated rate limit violations', date('Y-m-d H:i:s', strtotime('+24 hours')));
        }
    }

    /**
     * Get remaining requests for IP
     */
    public function get_remaining(string $ip): int {
        $transient_key = 'iab_rate_' . md5($ip);
        $requests = (int) get_transient($transient_key);

        return max(0, $this->max_requests - $requests);
    }

    /**
     * Reset counter for IP
     */
    public function reset(string $ip): bool {
        $transient_key = 'iab_rate_' . md5($ip);
        return delete_transient($transient_key);
    }
}
