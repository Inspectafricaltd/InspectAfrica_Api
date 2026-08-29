<?php
/**
 * Certificate CRUD Operations
 *
 * @package InspectAfrica_Bridge
 */

if (!defined('ABSPATH')) {
    exit;
}

class IAB_Cert_Manager {

    /**
     * Verify ACHI certificate by number
     */
    public static function verify(string $achi_number): array {
        global $wpdb;
        $table = IAB_Database::table('achi_certificates');

        $cert = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM $table WHERE achi_number = %s",
            $achi_number
        ), ARRAY_A);

        if (!$cert) {
            return [
                'valid' => false,
                'error' => 'Certificate not found',
                'achi_number' => $achi_number,
            ];
        }

        // Check status
        if ($cert['status'] === 'suspended') {
            return [
                'valid' => false,
                'status' => 'suspended',
                'error' => 'Certificate is suspended',
                'achi_number' => $achi_number,
                'full_name' => $cert['full_name'],
            ];
        }

        // Check expiry
        $expires_at = new DateTime($cert['expires_at']);
        $now = new DateTime();

        if ($expires_at < $now) {
            // Route through update() (not a raw query) so role sync, the
            // expiry email, and the webhook fire even when expiry is first
            // discovered via a live verification rather than the cron.
            if ($cert['status'] !== 'expired') {
                self::update((int) $cert['id'], ['status' => 'expired', 'is_active' => 0]);
            }

            return [
                'valid' => false,
                'status' => 'expired',
                'error' => 'Certificate has expired',
                'achi_number' => $achi_number,
                'full_name' => $cert['full_name'],
                'expired_at' => $cert['expires_at'],
            ];
        }

        // Update verification count
        $wpdb->query($wpdb->prepare(
            "UPDATE $table SET 
                app_verification_count = app_verification_count + 1,
                app_verified_at = %s
            WHERE id = %d",
            current_time('mysql'),
            $cert['id']
        ));

        return [
            'valid' => true,
            'status' => $cert['status'],
            'achi_number' => $achi_number,
            'full_name' => $cert['full_name'],
            'email' => $cert['email'],
            'certification_type' => $cert['certification_type'],
            'issued_at' => $cert['issued_at'],
            'expires_at' => $cert['expires_at'],
            'verification_count' => (int) $cert['app_verification_count'] + 1,
        ];
    }

    /**
     * Get all certificates with pagination
     */
    public static function get_all(int $page = 1, int $per_page = 20, ?string $status = null): array {
        global $wpdb;
        $table = IAB_Database::table('achi_certificates');

        $where = '1=1';
        $params = [];

        if ($status) {
            $where .= ' AND status = %s';
            $params[] = $status;
        }

        $offset = ($page - 1) * $per_page;

        $total = $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM $table WHERE $where",
            ...$params
        ));

        $params[] = $per_page;
        $params[] = $offset;

        $certs = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM $table WHERE $where ORDER BY created_at DESC LIMIT %d OFFSET %d",
            ...$params
        ), ARRAY_A);

        return [
            'certificates' => $certs,
            'pagination' => [
                'total' => (int) $total,
                'page' => $page,
                'per_page' => $per_page,
                'total_pages' => ceil($total / $per_page),
            ],
        ];
    }

    /**
     * Get single certificate by ID
     */
    public static function get(int $id): ?array {
        global $wpdb;
        $table = IAB_Database::table('achi_certificates');

        $cert = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM $table WHERE id = %d",
            $id
        ), ARRAY_A);

        return $cert ?: null;
    }

    /**
     * Create new certificate
     */
    public static function create(array $data): array|WP_Error {
        global $wpdb;
        $table = IAB_Database::table('achi_certificates');

        // Check for duplicate ACHI number
        $exists = $wpdb->get_var($wpdb->prepare(
            "SELECT id FROM $table WHERE achi_number = %s",
            $data['achi_number']
        ));

        if ($exists) {
            return new WP_Error('duplicate', 'ACHI number already exists');
        }

        $result = $wpdb->insert($table, [
            'achi_number' => $data['achi_number'],
            'user_id' => $data['user_id'] ?? null,
            'full_name' => $data['full_name'],
            'email' => $data['email'],
            'phone' => $data['phone'] ?? null,
            'certification_type' => $data['certification_type'] ?? 'Home Inspector',
            'issued_at' => $data['issued_at'],
            'expires_at' => $data['expires_at'],
            'status' => $data['status'] ?? 'active',
            'is_active' => 1,
            'lms_course_id' => $data['lms_course_id'] ?? null,
        ]);

        if ($result === false) {
            return new WP_Error('db_error', 'Failed to create certificate');
        }

        return self::get($wpdb->insert_id);
    }

    /**
     * Update certificate
     */
    public static function update(int $id, array $data): array|WP_Error {
        global $wpdb;
        $table = IAB_Database::table('achi_certificates');

        $cert = self::get($id);
        if (!$cert) {
            return new WP_Error('not_found', 'Certificate not found');
        }

        $update_data = [];
        foreach ($data as $key => $value) {
            if (in_array($key, ['full_name', 'email', 'phone', 'status', 'expires_at', 'certification_type', 'is_active'])) {
                $update_data[$key] = $value;
            }
        }

        if (empty($update_data)) {
            return $cert;
        }

        $result = $wpdb->update($table, $update_data, ['id' => $id]);

        if ($result === false) {
            return new WP_Error('db_error', 'Failed to update certificate');
        }

        // Fire the status-changed event so role sync / emails / webhooks
        // stay consistent no matter which code path changed the status
        // (admin API, cron expiry check, etc).
        if (isset($update_data['status']) && $update_data['status'] !== $cert['status']) {
            do_action('iab_cert_status_changed', $cert['achi_number'], $cert['status'], $update_data['status']);
        }

        return self::get($id);
    }

    /**
     * Delete certificate
     */
    public static function delete(int $id): bool|WP_Error {
        global $wpdb;
        $table = IAB_Database::table('achi_certificates');

        $cert = self::get($id);
        if (!$cert) {
            return new WP_Error('not_found', 'Certificate not found');
        }

        $result = $wpdb->delete($table, ['id' => $id]);

        return $result !== false;
    }

    /**
     * Get certificates expiring soon
     */
    public static function get_expiring(int $days = 30): array {
        global $wpdb;
        $table = IAB_Database::table('achi_certificates');

        return $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM $table 
            WHERE status = 'active' 
            AND expires_at BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL %d DAY)
            ORDER BY expires_at ASC",
            $days
        ), ARRAY_A);
    }

    /**
     * Get statistics
     */
    public static function get_stats(): array {
        global $wpdb;
        $table = IAB_Database::table('achi_certificates');

        $stats = $wpdb->get_row(
            "SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
                SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired,
                SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) as suspended,
                SUM(CASE WHEN status = 'candidate' THEN 1 ELSE 0 END) as candidates,
                SUM(CASE WHEN expires_at < DATE_ADD(CURDATE(), INTERVAL 30 DAY) AND status = 'active' THEN 1 ELSE 0 END) as expiring_30_days
            FROM $table",
            ARRAY_A
        );

        return $stats;
    }
}
