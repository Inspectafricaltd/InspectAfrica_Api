<?php
/**
 * API Activity Logger
 *
 * @package InspectAfrica_Bridge
 */

if (!defined('ABSPATH')) {
    exit;
}

class IAB_Activity_Logger {

    /**
     * Log API request
     */
    public static function log(array $data): int|false {
        global $wpdb;
        $table = IAB_Database::table('api_activity');

        return $wpdb->insert($table, [
            'request_id' => IAB_Database::generate_request_id(),
            'endpoint' => $data['endpoint'],
            'method' => $data['method'] ?? 'GET',
            'achi_number' => $data['achi_number'] ?? null,
            'inspector_id' => $data['inspector_id'] ?? null,
            'ip_address' => $data['ip_address'],
            'user_agent' => $data['user_agent'] ?? null,
            'result' => $data['result'],
            'response_code' => $data['response_code'] ?? 200,
            'response_time_ms' => $data['response_time_ms'] ?? null,
            'error_message' => $data['error_message'] ?? null,
            'request_payload' => isset($data['request_payload']) ? json_encode($data['request_payload']) : null,
        ]);
    }

    /**
     * Get recent activity
     */
    public static function get_recent(int $page = 1, int $per_page = 50, array $filters = []): array {
        global $wpdb;
        $table = IAB_Database::table('api_activity');

        $where = '1=1';
        $params = [];

        if (!empty($filters['achi_number'])) {
            $where .= ' AND achi_number = %s';
            $params[] = $filters['achi_number'];
        }

        if (!empty($filters['result'])) {
            $where .= ' AND result = %s';
            $params[] = $filters['result'];
        }

        if (!empty($filters['date_from'])) {
            $where .= ' AND created_at >= %s';
            $params[] = $filters['date_from'] . ' 00:00:00';
        }

        if (!empty($filters['date_to'])) {
            $where .= ' AND created_at <= %s';
            $params[] = $filters['date_to'] . ' 23:59:59';
        }

        $offset = ($page - 1) * $per_page;

        $total = $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM $table WHERE $where",
            ...$params
        ));

        $params[] = $per_page;
        $params[] = $offset;

        $logs = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM $table WHERE $where ORDER BY created_at DESC LIMIT %d OFFSET %d",
            ...$params
        ), ARRAY_A);

        return [
            'logs' => $logs,
            'pagination' => [
                'total' => (int) $total,
                'page' => $page,
                'per_page' => $per_page,
                'total_pages' => ceil($total / $per_page),
            ],
        ];
    }

    /**
     * Get activity statistics
     */
    public static function get_stats(string $period = '7d'): array {
        global $wpdb;
        $table = IAB_Database::table('api_activity');

        $interval = match($period) {
            '24h' => '1 DAY',
            '7d' => '7 DAY',
            '30d' => '30 DAY',
            default => '7 DAY',
        };

        $stats = $wpdb->get_row($wpdb->prepare(
            "SELECT 
                COUNT(*) as total_requests,
                SUM(CASE WHEN result = 'success' THEN 1 ELSE 0 END) as successful,
                SUM(CASE WHEN result = 'expired' THEN 1 ELSE 0 END) as expired,
                SUM(CASE WHEN result = 'blocked' THEN 1 ELSE 0 END) as blocked,
                SUM(CASE WHEN result = 'invalid' THEN 1 ELSE 0 END) as invalid,
                SUM(CASE WHEN result = 'error' THEN 1 ELSE 0 END) as errors,
                AVG(response_time_ms) as avg_response_time,
                MAX(response_time_ms) as max_response_time
            FROM $table
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL $interval)",
        ), ARRAY_A);

        // Get top endpoints
        $endpoints = $wpdb->get_results(
            "SELECT endpoint, COUNT(*) as count
            FROM $table
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL $interval)
            GROUP BY endpoint
            ORDER BY count DESC
            LIMIT 10",
            ARRAY_A
        );

        // Get daily breakdown
        $daily = $wpdb->get_results(
            "SELECT 
                DATE(created_at) as date,
                COUNT(*) as total,
                SUM(CASE WHEN result = 'success' THEN 1 ELSE 0 END) as successful
            FROM $table
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL $interval)
            GROUP BY DATE(created_at)
            ORDER BY date DESC",
            ARRAY_A
        );

        return [
            'period' => $period,
            'stats' => $stats,
            'top_endpoints' => $endpoints,
            'daily' => $daily,
        ];
    }

    /**
     * Clean old logs
     */
    public static function cleanup(int $days_to_keep = 90): int {
        global $wpdb;
        $table = IAB_Database::table('api_activity');

        return $wpdb->query($wpdb->prepare(
            "DELETE FROM $table WHERE created_at < DATE_SUB(NOW(), INTERVAL %d DAY)",
            $days_to_keep
        ));
    }
}
