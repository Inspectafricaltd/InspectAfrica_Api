<?php
/**
 * Main Plugin Class (Singleton)
 *
 * @package InspectAfrica_Bridge
 */

if (!defined('ABSPATH')) {
    exit;
}

class InspectAfrica_Bridge_Plugin {

    /** @var self|null */
    private static $instance = null;

    /** @var string */
    private $version = '1.0.39';

    /** @var string */
    private $plugin_name = 'inspect-africa-bridge';

    /**
     * Get singleton instance
     */
    public static function get_instance(): self {
        if (null === self::$instance) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    /**
     * Constructor
     */
    private function __construct() {
        $this->load_dependencies();
        $this->define_hooks();
    }

    /**
     * Load required files
     */
    private function load_dependencies(): void {
        $includes_dir = IAB_PLUGIN_DIR . 'includes/';

        require_once $includes_dir . 'class-database.php';
        require_once $includes_dir . 'class-auth.php';
        require_once $includes_dir . 'class-rest-api.php';
        require_once $includes_dir . 'class-cert-manager.php';
        require_once $includes_dir . 'class-activity-logger.php';
        require_once $includes_dir . 'class-rate-limiter.php';
        require_once $includes_dir . 'class-webhook-handler.php';
        require_once $includes_dir . 'class-certificate-generator.php';
        require_once $includes_dir . 'class-lms-sync.php';
        require_once $includes_dir . 'class-cron.php';
        require_once $includes_dir . 'class-roles.php';
        require_once $includes_dir . 'class-jwt.php';
        require_once $includes_dir . 'class-woo-integration.php';

        if (is_admin()) {
            require_once IAB_PLUGIN_DIR . 'admin/class-admin.php';
        }
    }

    /**
     * Register WordPress hooks
     */
    private function define_hooks(): void {
        // Activation/Deactivation
        register_activation_hook(IAB_PLUGIN_FILE, [$this, 'activate']);
        register_deactivation_hook(IAB_PLUGIN_FILE, [$this, 'deactivate']);

        // REST API
        add_action('rest_api_init', [$this, 'init_rest_api']);

        // Roles — register on init so new roles are created after a plugin update
        // without requiring manual deactivate/reactivate
        add_action('init', [$this, 'maybe_register_roles']);

        // Cron
        add_action('init', [$this, 'init_cron']);

        // Admin menu
        if (is_admin()) {
            add_action('admin_menu', [IAB_Admin::class, 'add_menu']);
            add_action('admin_enqueue_scripts', [IAB_Admin::class, 'enqueue_assets']);
        }
    }

    /**
     * Plugin activation
     */
    public function activate(): void {
        IAB_Database::create_tables();
        IAB_Database::seed_default_settings();
        IAB_Roles::register();
        IAB_Cron::schedule_events();

        flush_rewrite_rules();
    }

    /**
     * Plugin deactivation
     */
    public function deactivate(): void {
        IAB_Cron::clear_scheduled_events();
        flush_rewrite_rules();
    }

    /**
     * Initialize REST API
     */
    public function init_rest_api(): void {
        $rest_api = new IAB_REST_API();
        $rest_api->register_routes();
    }

    /**
     * Register roles if any are missing (runs on every init, no-ops if all present)
     */
    public function maybe_register_roles(): void {
        IAB_Roles::register();
    }

    /**
     * Initialize Cron
     */
    public function init_cron(): void {
        IAB_Cron::init();
    }

    /**
     * Get plugin version
     */
    public function get_version(): string {
        return $this->version;
    }

    /**
     * Get plugin name
     */
    public function get_plugin_name(): string {
        return $this->plugin_name;
    }
}

/**
 * Helper function to get plugin instance
 */
function iab_plugin(): InspectAfrica_Bridge_Plugin {
    return InspectAfrica_Bridge_Plugin::get_instance();
}
