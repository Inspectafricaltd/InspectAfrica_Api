<?php
/**
 * Webhook Handler - Send events to Fastify API
 *
 * @package InspectAfrica_Bridge
 */

if (!defined('ABSPATH')) {
    exit;
}

class IAB_Webhook_Handler {

    /** @var string|null */
    private static $base_url;

    /**
     * Map internal event types to apps/api's per-event route paths
     * (apps/api/src/routes/wordpress.ts, mounted at /api/v1/wordpress).
     * Events not in this map have no receiving route and are skipped.
     */
    private const EVENT_ROUTES = [
        'cert_issued'   => '/webhook/cert-issued',
        'cert_expired'  => '/webhook/cert-expired', // also used for suspension, via 'reason' field
        'cert_updated'  => '/webhook/cert-updated',
        'user_enrolled' => '/webhook/user-enrolled',
    ];

    /**
     * Fields that must be sent as JSON numbers, not strings. wpdb returns
     * every column as a PHP string, and apps/api's zod schemas use
     * z.number() (no string coercion) — sending "9" instead of 9 fails
     * validation there.
     */
    private const NUMERIC_FIELDS = ['user_id', 'lms_course_id', 'id'];

    /**
     * Get the configured base URL for apps/api
     * (e.g. https://inspect-africa-api.up.railway.app/api/v1/wordpress).
     */
    private static function get_base_url(): string {
        if (self::$base_url === null) {
            self::$base_url = rtrim(IAB_Database::get_setting('fastify_webhook_url', ''), '/');
        }
        return self::$base_url;
    }

    /**
     * Send webhook event to apps/api, at the correct per-event route,
     * with the payload unwrapped at the request body root (matching
     * apps/api's zod schemas — no {event, timestamp, data} envelope).
     */
    public static function send(string $event_type, array $payload): bool|array {
        if (!isset(self::EVENT_ROUTES[$event_type])) {
            // No receiving route for this event on apps/api — skip silently
            // rather than queue a webhook that will only ever 404.
            return ['success' => false, 'error' => "No route configured for event '$event_type'", 'skipped' => true];
        }

        $base_url = self::get_base_url();
        if (empty($base_url)) {
            return ['success' => false, 'error' => 'Webhook base URL not configured'];
        }

        $url = $base_url . self::EVENT_ROUTES[$event_type];
        $payload = self::coerce_numeric_fields($payload);

        // Log the webhook (store the exact payload we're sending, unwrapped)
        $log_id = self::log_webhook($event_type, $payload, $url);

        $response = wp_remote_post($url, [
            'method' => 'POST',
            'headers' => [
                'Content-Type' => 'application/json',
                'X-WP-API-Key' => IAB_Database::get_setting('wp_outbound_api_key'),
            ],
            'body' => json_encode($payload),
            'timeout' => 30,
        ]);

        if (is_wp_error($response)) {
            self::update_webhook_log($log_id, [
                'status' => 'failed',
                'error_message' => $response->get_error_message(),
            ]);
            return ['success' => false, 'error' => $response->get_error_message()];
        }

        $response_code = wp_remote_retrieve_response_code($response);
        $response_body = wp_remote_retrieve_body($response);

        $status = $response_code >= 200 && $response_code < 300 ? 'delivered' : 'failed';

        self::update_webhook_log($log_id, [
            'status' => $status,
            'response_code' => $response_code,
            'response_body' => $response_body,
            'delivered_at' => current_time('mysql'),
        ]);

        return [
            'success' => $status === 'delivered',
            'response_code' => $response_code,
            'response' => json_decode($response_body, true),
        ];
    }

    /**
     * Cast known numeric fields from wpdb's string form to actual int,
     * so json_encode() emits JSON numbers instead of JSON strings.
     */
    private static function coerce_numeric_fields(array $payload): array {
        foreach (self::NUMERIC_FIELDS as $field) {
            if (isset($payload[$field]) && $payload[$field] !== null && $payload[$field] !== '') {
                $payload[$field] = (int) $payload[$field];
            }
        }
        return $payload;
    }

    /**
     * Log webhook event
     */
    private static function log_webhook(string $event_type, array $payload, string $url): int {
        global $wpdb;
        $table = IAB_Database::table('webhook_events');

        $result = $wpdb->insert($table, [
            'event_type' => $event_type,
            'payload' => json_encode($payload),
            'endpoint_url' => $url,
            'status' => 'pending',
        ]);

        // $wpdb->insert_id is NOT reset on failure — it can still hold a
        // stale, non-zero ID from a previous successful insert. Return an
        // unambiguous -1 on failure rather than trusting it.
        return $result === false ? -1 : (int) $wpdb->insert_id;
    }

    /**
     * Update webhook log
     */
    private static function update_webhook_log(int $id, array $data): bool {
        global $wpdb;
        $table = IAB_Database::table('webhook_events');

        return (bool) $wpdb->update($table, $data, ['id' => $id]);
    }

    /**
     * Retry failed webhooks
     */
    public static function retry_failed(): int {
        global $wpdb;
        $table = IAB_Database::table('webhook_events');

        $failed = $wpdb->get_results(
            "SELECT * FROM $table WHERE status = 'failed' AND retry_count < 3 ORDER BY created_at ASC LIMIT 10",
            ARRAY_A
        );

        $retried = 0;
        foreach ($failed as $webhook) {
            $payload = json_decode($webhook['payload'], true);

            $response = wp_remote_post($webhook['endpoint_url'], [
                'method' => 'POST',
                'headers' => [
                    'Content-Type' => 'application/json',
                    'X-WP-API-Key' => IAB_Database::get_setting('wp_outbound_api_key'),
                ],
                'body' => json_encode($payload),
                'timeout' => 30,
            ]);

            $status = 'failed';
            if (!is_wp_error($response)) {
                $code = wp_remote_retrieve_response_code($response);
                $status = $code >= 200 && $code < 300 ? 'delivered' : 'failed';
            }

            $wpdb->update($table, [
                'status' => $status,
                'retry_count' => (int) $webhook['retry_count'] + 1,
                'delivered_at' => $status === 'delivered' ? current_time('mysql') : null,
            ], ['id' => $webhook['id']]);

            if ($status === 'delivered') {
                $retried++;
            }
        }

        return $retried;
    }

    /**
     * Get pending webhooks
     */
    public static function get_pending(): array {
        global $wpdb;
        $table = IAB_Database::table('webhook_events');

        return $wpdb->get_results(
            "SELECT * FROM $table WHERE status IN ('pending', 'failed') ORDER BY created_at ASC",
            ARRAY_A
        );
    }

    /**
     * Most recent outbound webhook attempts, with the actual response
     * apps/api sent back. Shared by the REST endpoint and the wp-admin UI.
     */
    public static function get_recent(int $limit = 10): array {
        global $wpdb;
        $table = IAB_Database::table('webhook_events');

        return $wpdb->get_results($wpdb->prepare(
            "SELECT id, event_type, endpoint_url, status, response_code, response_body, error_message, retry_count, created_at, delivered_at
             FROM $table ORDER BY created_at DESC LIMIT %d",
            $limit
        ), ARRAY_A);
    }
}
