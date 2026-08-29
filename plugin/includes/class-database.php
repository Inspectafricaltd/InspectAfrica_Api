<?php
/**
 * Database Operations
 *
 * @package InspectAfrica_Bridge
 */

if (!defined('ABSPATH')) {
    exit;
}

class IAB_Database {

    /** @var string */
    private static $table_prefix = 'iab_';

    /**
     * Get table name with WP prefix
     */
    public static function table(string $name): string {
        global $wpdb;
        return $wpdb->prefix . self::$table_prefix . $name;
    }

    /**
     * Create all plugin tables
     */
    public static function create_tables(): void {
        global $wpdb;

        $charset_collate = $wpdb->get_charset_collate();

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';

        // Certificates table
        $certificates_table = self::table('achi_certificates');
        $sql_certificates = "CREATE TABLE $certificates_table (
            id bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            achi_number varchar(50) NOT NULL,
            user_id bigint(20) UNSIGNED,
            full_name varchar(255) NOT NULL,
            email varchar(255) NOT NULL,
            phone varchar(50),
            certification_type varchar(100) DEFAULT 'Home Inspector',
            issued_at date NOT NULL,
            expires_at date NOT NULL,
            status enum('active','suspended','expired','candidate') DEFAULT 'active',
            is_active tinyint(1) DEFAULT 1,
            lms_course_id bigint(20),
            last_synced_at datetime,
            app_verified_at datetime,
            app_verification_count int DEFAULT 0,
            created_at datetime DEFAULT CURRENT_TIMESTAMP,
            updated_at datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY achi_number (achi_number),
            KEY idx_status (status),
            KEY idx_expires (expires_at),
            KEY idx_user (user_id),
            KEY idx_synced (last_synced_at)
        ) $charset_collate;";

        dbDelta($sql_certificates);

        // API Activity Log
        $activity_table = self::table('api_activity');
        $sql_activity = "CREATE TABLE $activity_table (
            id bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            request_id varchar(50) NOT NULL,
            endpoint varchar(255) NOT NULL,
            method varchar(10) NOT NULL,
            achi_number varchar(50),
            inspector_id bigint(20) UNSIGNED,
            ip_address varchar(45) NOT NULL,
            user_agent text,
            result enum('success','expired','blocked','invalid','error') NOT NULL,
            response_code smallint,
            response_time_ms int,
            error_message text,
            request_payload json,
            created_at datetime DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY request_id (request_id),
            KEY idx_created (created_at),
            KEY idx_achi (achi_number),
            KEY idx_result (result),
            KEY idx_ip (ip_address),
            KEY idx_endpoint (endpoint)
        ) $charset_collate;";

        dbDelta($sql_activity);

        // Blocked IPs
        $blocked_table = self::table('blocked_ips');
        $sql_blocked = "CREATE TABLE $blocked_table (
            id bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            ip_address varchar(45) NOT NULL,
            reason varchar(100) NOT NULL,
            attempts int DEFAULT 0,
            blocked_at datetime DEFAULT CURRENT_TIMESTAMP,
            expires_at datetime,
            unblocked_at datetime,
            unblocked_by bigint(20) UNSIGNED,
            is_active tinyint(1) DEFAULT 1,
            PRIMARY KEY (id),
            UNIQUE KEY ip_address (ip_address),
            KEY idx_active (is_active),
            KEY idx_expires (expires_at)
        ) $charset_collate;";

        dbDelta($sql_blocked);

        // Webhook Events
        $webhook_table = self::table('webhook_events');
        $sql_webhook = "CREATE TABLE $webhook_table (
            id bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            event_type varchar(50) NOT NULL,
            payload json NOT NULL,
            endpoint_url varchar(500) NOT NULL,
            response_code smallint,
            response_body text,
            delivered_at datetime,
            retry_count tinyint DEFAULT 0,
            status enum('pending','delivered','failed') DEFAULT 'pending',
            created_at datetime DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_status (status),
            KEY idx_event (event_type),
            KEY idx_created (created_at)
        ) $charset_collate;";

        dbDelta($sql_webhook);

        // Settings
        $settings_table = self::table('settings');
        $sql_settings = "CREATE TABLE $settings_table (
            id bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            setting_key varchar(100) NOT NULL,
            setting_value longtext,
            setting_group varchar(50),
            is_encrypted tinyint(1) DEFAULT 0,
            updated_at datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            updated_by bigint(20) UNSIGNED,
            PRIMARY KEY (id),
            UNIQUE KEY setting_key (setting_key),
            KEY idx_group (setting_group)
        ) $charset_collate;";

        dbDelta($sql_settings);

        // Expiry Notifications
        $expiry_table = self::table('expiry_notifications');
        $sql_expiry = "CREATE TABLE $expiry_table (
            id bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            inspector_id bigint(20) UNSIGNED NOT NULL,
            achi_number varchar(50) NOT NULL,
            notification_type enum('7_day','30_day') NOT NULL,
            sent_at datetime DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY unique_notification (inspector_id, notification_type, sent_at),
            KEY idx_inspector (inspector_id)
        ) $charset_collate;";

        dbDelta($sql_expiry);
    }

    /**
     * Seed default settings
     */
    public static function seed_default_settings(): void {
        global $wpdb;
        $table = self::table('settings');

        $defaults = [
            // Inbound: what clients (PWA test panel, admin tools) must send as
            // X-IA-API-Key to authenticate INTO this WordPress site's REST API.
            ['setting_key' => 'api_key', 'setting_value' => wp_generate_password(32, false), 'setting_group' => 'api', 'is_encrypted' => 1],
            // Outbound: what this site sends as X-WP-API-Key when it calls OUT
            // to apps/api's webhook routes — must match apps/api's WP_API_KEY.
            // Deliberately a separate setting from 'api_key' above (they were
            // conflated once already and it broke inbound auth when changed).
            ['setting_key' => 'wp_outbound_api_key', 'setting_value' => '', 'setting_group' => 'webhook'],
            ['setting_key' => 'fastify_webhook_url', 'setting_value' => '', 'setting_group' => 'webhook'],
            ['setting_key' => 'rate_limit_max', 'setting_value' => '100', 'setting_group' => 'rate_limit'],
            ['setting_key' => 'rate_limit_window', 'setting_value' => '3600', 'setting_group' => 'rate_limit'],
            // The real 27 published ACHI courses (confirmed via DB export
            // 2026-07-03) — completing all of these triggers ACHI
            // certification immediately, per the original signed proposal.
            // Excludes the 3 still-draft courses and WP's own junk
            // auto-draft/trash rows.
            ['setting_key' => 'lms_certification_required_courses', 'setting_value' => '15,169,429,3619,3748,3878,4006,4144,4147,4150,4278,4281,4292,4296,4300,4304,4308,4315,4316,4321,4324,4326,4333,4337,4338,4343,4346', 'setting_group' => 'lms'],
            ['setting_key' => 'cert_expiry_days', 'setting_value' => '365', 'setting_group' => 'cert'],
            ['setting_key' => 'auto_sync_enabled', 'setting_value' => '1', 'setting_group' => 'sync'],
            ['setting_key' => 'sync_interval', 'setting_value' => 'daily', 'setting_group' => 'sync'],
        ];

        foreach ($defaults as $setting) {
            $exists = $wpdb->get_var($wpdb->prepare(
                "SELECT id FROM $table WHERE setting_key = %s",
                $setting['setting_key']
            ));

            if (!$exists) {
                $wpdb->insert($table, $setting);
            }
        }
    }

    /**
     * Get setting value
     */
    public static function get_setting(string $key, $default = null) {
        global $wpdb;
        $table = self::table('settings');

        $value = $wpdb->get_var($wpdb->prepare(
            "SELECT setting_value FROM $table WHERE setting_key = %s",
            $key
        ));

        return $value !== null ? $value : $default;
    }

    /**
     * Update setting value (upsert — inserts if key doesn't exist yet)
     */
    public static function update_setting(string $key, $value, int $user_id = 0): bool {
        global $wpdb;
        $table = self::table('settings');

        $exists = $wpdb->get_var($wpdb->prepare(
            "SELECT id FROM $table WHERE setting_key = %s",
            $key
        ));

        if ($exists) {
            $result = $wpdb->update(
                $table,
                ['setting_value' => $value, 'updated_by' => $user_id],
                ['setting_key' => $key]
            );
        } else {
            $result = $wpdb->insert($table, [
                'setting_key' => $key,
                'setting_value' => $value,
                'updated_by' => $user_id,
            ]);
        }

        return $result !== false;
    }

    /**
     * Generate unique request ID
     */
    public static function generate_request_id(): string {
        return 'IA-' . strtoupper(substr(uniqid(), -5)) . '-' . time();
    }
}
