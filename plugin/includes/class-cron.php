<?php
/**
 * Cron Jobs
 *
 * @package InspectAfrica_Bridge
 */

if (!defined('ABSPATH')) {
    exit;
}

class IAB_Cron {

    /**
     * Initialize cron hooks
     */
    public static function init(): void {
        add_action('iab_daily_sync', [self::class, 'run_daily_sync']);
        add_action('iab_expiry_check', [self::class, 'run_expiry_check']);
        add_action('iab_cleanup_logs', [self::class, 'run_cleanup']);
        add_action('iab_retry_webhooks', [self::class, 'run_webhook_retry']);
    }

    /**
     * Schedule cron events
     */
    public static function schedule_events(): void {
        if (!wp_next_scheduled('iab_daily_sync')) {
            wp_schedule_event(time(), 'daily', 'iab_daily_sync');
        }

        if (!wp_next_scheduled('iab_expiry_check')) {
            wp_schedule_event(time(), 'daily', 'iab_expiry_check');
        }

        if (!wp_next_scheduled('iab_cleanup_logs')) {
            wp_schedule_event(time(), 'weekly', 'iab_cleanup_logs');
        }

        if (!wp_next_scheduled('iab_retry_webhooks')) {
            wp_schedule_event(time(), 'hourly', 'iab_retry_webhooks');
        }
    }

    /**
     * Clear scheduled events
     */
    public static function clear_scheduled_events(): void {
        wp_clear_scheduled_hook('iab_daily_sync');
        wp_clear_scheduled_hook('iab_expiry_check');
        wp_clear_scheduled_hook('iab_cleanup_logs');
        wp_clear_scheduled_hook('iab_retry_webhooks');
    }

    /**
     * Daily sync from LMS
     */
    public static function run_daily_sync(): void {
        if (IAB_Database::get_setting('auto_sync_enabled', '0') !== '1') {
            return;
        }

        $result = IAB_LMS_Sync::sync_all();

        // Log result
        error_log(sprintf(
            'InspectAfrica Sync: %d synced, %d created, %d updated, %d errors',
            $result['synced'],
            $result['created'],
            $result['updated'],
            count($result['errors'])
        ));
    }

    /**
     * Check for expiring certificates
     */
    public static function run_expiry_check(): void {
        global $wpdb;
        $cert_table = IAB_Database::table('achi_certificates');
        $notif_table = IAB_Database::table('expiry_notifications');

        // Check 30-day expiry
        $expiring_30 = $wpdb->get_results(
            "SELECT * FROM $cert_table 
            WHERE status = 'active' 
            AND expires_at BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)
            AND id NOT IN (
                SELECT inspector_id FROM $notif_table 
                WHERE notification_type = '30_day' 
                AND sent_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
            )"
        );

        foreach ($expiring_30 as $cert) {
            self::send_expiry_notification($cert, '30_day');
        }

        // Check 7-day expiry
        $expiring_7 = $wpdb->get_results(
            "SELECT * FROM $cert_table 
            WHERE status = 'active' 
            AND expires_at BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
            AND id NOT IN (
                SELECT inspector_id FROM $notif_table 
                WHERE notification_type = '7_day' 
                AND sent_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
            )"
        );

        foreach ($expiring_7 as $cert) {
            self::send_expiry_notification($cert, '7_day');
        }

        // Mark expired certificates — go through IAB_Cert_Manager::update() one
        // at a time (not a bulk query) so each expiry triggers the role
        // demotion, notification email, and webhook via iab_cert_status_changed.
        $newly_expired = $wpdb->get_results(
            "SELECT id FROM $cert_table WHERE status = 'active' AND expires_at < CURDATE()",
            ARRAY_A
        );

        foreach ($newly_expired as $row) {
            IAB_Cert_Manager::update((int) $row['id'], [
                'status' => 'expired',
                'is_active' => 0,
            ]);
        }
    }

    /**
     * Send expiry notification
     */
    private static function send_expiry_notification(object $cert, string $type): void {
        global $wpdb;
        $notif_table = IAB_Database::table('expiry_notifications');

        $days = $type === '7_day' ? 7 : 30;

        $subject = "Your ACHI Certificate Expires in {$days} Days";
        $message = sprintf(
            "Dear %s,\n\nYour ACHI Certificate (%s) will expire on %s.\n\nPlease complete your renewal to maintain your certification.\n\nInspectAfrica Team",
            $cert->full_name,
            $cert->achi_number,
            $cert->expires_at
        );

        $sent = wp_mail($cert->email, $subject, $message);

        // Log notification
        $wpdb->insert($notif_table, [
            'inspector_id' => $cert->id,
            'achi_number' => $cert->achi_number,
            'notification_type' => $type,
        ]);

        // Also notify Fastify
        IAB_Webhook_Handler::send('cert_expiring', [
            'achi_number' => $cert->achi_number,
            'inspector_id' => $cert->id,
            'email' => $cert->email,
            'expires_at' => $cert->expires_at,
            'days_remaining' => $days,
        ]);
    }

    /**
     * Cleanup old logs
     */
    public static function run_cleanup(): void {
        $days = (int) IAB_Database::get_setting('log_retention_days', 90);

        $deleted = IAB_Activity_Logger::cleanup($days);

        error_log("InspectAfrica Cleanup: Deleted $deleted old log entries");
    }

    /**
     * Retry failed webhooks
     */
    public static function run_webhook_retry(): void {
        $retried = IAB_Webhook_Handler::retry_failed();

        if ($retried > 0) {
            error_log("InspectAfrica Webhooks: Retried $retried failed webhooks");
        }
    }

    /**
     * Manually trigger sync
     */
    public static function trigger_sync(): array {
        self::run_daily_sync();
        return IAB_LMS_Sync::sync_all();
    }
}
