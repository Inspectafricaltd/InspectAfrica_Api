<?php
/**
 * Admin Dashboard
 *
 * @package InspectAfrica_Bridge
 */

if (!defined('ABSPATH')) {
    exit;
}

class IAB_Admin {

    /** @var string */
    private static $plugin_page = 'inspect-africa-bridge';

    /**
     * Add admin menu
     */
    public static function add_menu(): void {
        add_menu_page(
            'InspectAfrica Bridge',
            'InspectAfrica',
            'manage_options',
            self::$plugin_page,
            [self::class, 'render_dashboard'],
            'dashicons-clipboard',
            30
        );
    }

    /**
     * Enqueue admin assets
     */
    public static function enqueue_assets(string $hook): void {
        if ($hook !== 'toplevel_page_' . self::$plugin_page) {
            return;
        }

        $version = iab_plugin()->get_version();

        wp_enqueue_style(
            'iab-admin',
            IAB_PLUGIN_URL . 'admin/css/admin.css',
            [],
            $version
        );

        wp_enqueue_style(
            'iab-material-icons',
            'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0',
            [],
            null
        );

        wp_enqueue_script(
            'iab-admin',
            IAB_PLUGIN_URL . 'admin/js/admin.js',
            ['jquery'],
            $version,
            true
        );

        wp_localize_script('iab-admin', 'iabData', [
            'ajaxUrl' => admin_url('admin-ajax.php'),
            'nonce' => wp_create_nonce('iab_admin_nonce'),
            'restUrl' => rest_url('inspectafrica/v1'),
            'apiKey' => IAB_Database::get_setting('api_key'),
        ]);
    }

    /**
     * Render dashboard
     */
    public static function render_dashboard(): void {
        $active_tab = isset($_GET['tab']) ? sanitize_text_field($_GET['tab']) : 'overview';
        $tabs = [
            'overview' => 'Overview',
            'activity' => 'API Activity',
            'inspectors' => 'Inspectors',
            'settings' => 'Settings',
        ];

        include IAB_PLUGIN_DIR . 'admin/views/dashboard.php';
    }

    /**
     * Render tab content
     */
    public static function render_tab(string $tab): void {
        $file = IAB_PLUGIN_DIR . "admin/views/tab-{$tab}.php";

        if (file_exists($file)) {
            include $file;
        }
    }

    /**
     * Handle AJAX: Get stats
     */
    public static function ajax_get_stats(): void {
        check_ajax_referer('iab_admin_nonce', 'nonce');

        $stats = IAB_Cert_Manager::get_stats();
        $activity = IAB_Activity_Logger::get_stats('7d');

        wp_send_json_success([
            'certificates' => $stats,
            'activity' => $activity,
        ]);
    }

    /**
     * Handle AJAX: Get activity log
     */
    public static function ajax_get_activity(): void {
        check_ajax_referer('iab_admin_nonce', 'nonce');

        $page = (int) ($_POST['page'] ?? 1);
        $per_page = (int) ($_POST['per_page'] ?? 20);

        $filters = [
            'achi_number' => sanitize_text_field($_POST['achi_number'] ?? ''),
            'result' => sanitize_text_field($_POST['result'] ?? ''),
            'date_from' => sanitize_text_field($_POST['date_from'] ?? ''),
            'date_to' => sanitize_text_field($_POST['date_to'] ?? ''),
        ];

        $result = IAB_Activity_Logger::get_recent($page, $per_page, array_filter($filters));

        wp_send_json_success($result);
    }

    /**
     * Handle AJAX: Get inspectors
     */
    public static function ajax_get_inspectors(): void {
        check_ajax_referer('iab_admin_nonce', 'nonce');

        $page = (int) ($_POST['page'] ?? 1);
        $per_page = (int) ($_POST['per_page'] ?? 20);
        $status = sanitize_text_field($_POST['status'] ?? '');

        $result = IAB_Cert_Manager::get_all($page, $per_page, $status ?: null);

        wp_send_json_success($result);
    }

    /**
     * Handle AJAX: suspend, reinstate, or otherwise change a certificate's
     * status. This was previously only reachable via the REST API
     * (PATCH /certificates/:id) with no wp-admin button — the underlying
     * IAB_Cert_Manager::update() already fires the full role/email/webhook
     * chain on any status change, so this handler just exposes that same
     * call from the dashboard, gated by the normal nonce + capability check
     * instead of an API key.
     */
    public static function ajax_update_certificate_status(): void {
        check_ajax_referer('iab_admin_nonce', 'nonce');

        if (!current_user_can('manage_options')) {
            wp_send_json_error('Permission denied');
        }

        $id = (int) ($_POST['id'] ?? 0);
        $status = sanitize_text_field($_POST['status'] ?? '');

        if (!$id || !in_array($status, ['active', 'suspended', 'expired'], true)) {
            wp_send_json_error(['message' => 'Invalid certificate ID or status']);
        }

        $result = IAB_Cert_Manager::update($id, ['status' => $status]);

        if (is_wp_error($result)) {
            wp_send_json_error(['message' => $result->get_error_message()]);
        }

        wp_send_json_success($result);
    }

    /**
     * Handle AJAX: Update settings
     */
    public static function ajax_update_settings(): void {
        check_ajax_referer('iab_admin_nonce', 'nonce');

        if (!current_user_can('manage_options')) {
            wp_send_json_error('Permission denied');
        }

        // Comma-separated course IDs — sanitize down to digits/commas only,
        // then normalize (dedupe, drop empties) before storing.
        $required_courses_raw = sanitize_text_field($_POST['lms_certification_required_courses'] ?? '');
        $required_courses_ids = array_values(array_unique(array_filter(array_map(
            'intval',
            array_map('trim', explode(',', $required_courses_raw))
        ))));

        $settings = [
            'fastify_webhook_url' => esc_url_raw($_POST['fastify_webhook_url'] ?? ''),
            'rate_limit_max' => (int) ($_POST['rate_limit_max'] ?? 100),
            'rate_limit_window' => (int) ($_POST['rate_limit_window'] ?? 3600),
            'lms_certification_required_courses' => implode(',', $required_courses_ids),
            'auto_sync_enabled' => (int) ($_POST['auto_sync_enabled'] ?? 0),
        ];

        foreach ($settings as $key => $value) {
            IAB_Database::update_setting($key, $value, get_current_user_id());
        }

        wp_send_json_success(['message' => 'Settings saved']);
    }

    /**
     * Handle AJAX: Regenerate API key
     */
    public static function ajax_regenerate_key(): void {
        check_ajax_referer('iab_admin_nonce', 'nonce');

        if (!current_user_can('manage_options')) {
            wp_send_json_error('Permission denied');
        }

        $new_key = IAB_Auth::regenerate_api_key();

        wp_send_json_success(['api_key' => $new_key]);
    }

    /**
     * Handle AJAX: Sync certificates
     */
    public static function ajax_sync_certificates(): void {
        check_ajax_referer('iab_admin_nonce', 'nonce');

        if (!current_user_can('manage_options')) {
            wp_send_json_error('Permission denied');
        }

        $result = IAB_Cron::trigger_sync();

        wp_send_json_success($result);
    }

    /**
     * Handle AJAX: Block/Unblock IP
     */
    public static function ajax_toggle_ip_block(): void {
        check_ajax_referer('iab_admin_nonce', 'nonce');

        if (!current_user_can('manage_options')) {
            wp_send_json_error('Permission denied');
        }

        $ip = sanitize_text_field($_POST['ip'] ?? '');
        $action_type = sanitize_text_field($_POST['action_type'] ?? '');

        if ($action_type === 'block') {
            $reason = sanitize_text_field($_POST['reason'] ?? 'Manual block');
            IAB_Auth::block_ip($ip, $reason);
        } else {
            IAB_Auth::unblock_ip($ip, get_current_user_id());
        }

        wp_send_json_success(['message' => "IP {$action_type}ed"]);
    }

    /**
     * Handle AJAX: bulk-set evaluation mode on the required-course list
     */
    public static function ajax_set_evaluation_mode(): void {
        check_ajax_referer('iab_admin_nonce', 'nonce');

        if (!current_user_can('manage_options')) {
            wp_send_json_error('Permission denied');
        }

        $passing = (int) ($_POST['passing_grade'] ?? 80);
        $result = IAB_LMS_Sync::bulk_set_evaluation_mode('evaluate_quiz', $passing);

        if (isset($result['error'])) {
            wp_send_json_error(['message' => $result['error']]);
        }

        wp_send_json_success([
            'updated' => count($result['updated']),
            'updated_ids' => $result['updated'],
            'errors' => $result['errors'],
        ]);
    }

    /**
     * Handle AJAX: bulk-set price on the required-course list
     */
    public static function ajax_set_course_price(): void {
        check_ajax_referer('iab_admin_nonce', 'nonce');

        if (!current_user_can('manage_options')) {
            wp_send_json_error('Permission denied');
        }

        $price = (float) ($_POST['price'] ?? 0);
        $result = IAB_LMS_Sync::bulk_set_course_price($price);

        if (isset($result['error'])) {
            wp_send_json_error(['message' => $result['error']]);
        }

        wp_send_json_success([
            'updated' => count($result['updated']),
            'updated_ids' => $result['updated'],
            'errors' => $result['errors'],
        ]);
    }

    /**
     * Handle AJAX: get recent outbound webhook delivery log
     */
    public static function ajax_get_webhook_log(): void {
        check_ajax_referer('iab_admin_nonce', 'nonce');

        if (!current_user_can('manage_options')) {
            wp_send_json_error('Permission denied');
        }

        $limit = min(50, max(1, (int) ($_POST['limit'] ?? 15)));
        $rows = IAB_Webhook_Handler::get_recent($limit);

        wp_send_json_success(['count' => count($rows), 'webhooks' => $rows]);
    }
}

// Register AJAX handlers
add_action('wp_ajax_iab_get_stats', [IAB_Admin::class, 'ajax_get_stats']);
add_action('wp_ajax_iab_get_activity', [IAB_Admin::class, 'ajax_get_activity']);
add_action('wp_ajax_iab_get_inspectors', [IAB_Admin::class, 'ajax_get_inspectors']);
add_action('wp_ajax_iab_update_certificate_status', [IAB_Admin::class, 'ajax_update_certificate_status']);
add_action('wp_ajax_iab_update_settings', [IAB_Admin::class, 'ajax_update_settings']);
add_action('wp_ajax_iab_regenerate_key', [IAB_Admin::class, 'ajax_regenerate_key']);
add_action('wp_ajax_iab_sync_certificates', [IAB_Admin::class, 'ajax_sync_certificates']);
add_action('wp_ajax_iab_toggle_ip_block', [IAB_Admin::class, 'ajax_toggle_ip_block']);
add_action('wp_ajax_iab_set_evaluation_mode', [IAB_Admin::class, 'ajax_set_evaluation_mode']);
add_action('wp_ajax_iab_set_course_price', [IAB_Admin::class, 'ajax_set_course_price']);
add_action('wp_ajax_iab_get_webhook_log', [IAB_Admin::class, 'ajax_get_webhook_log']);
