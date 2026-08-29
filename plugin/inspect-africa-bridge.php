<?php
/**
 * Plugin Name: InspectAfrica Bridge
 * Plugin URI: https://inspectafrica.org
 * Description: Bridge plugin for ACHI certification verification with InspectAfrica Standard™ platform. Connects LearnPress LMS with the InspectAfrica PWA.
 * Version: 1.0.39
 * Author: InspectAfrica
 * Author URI: https://inspectafrica.org
 * License: GPL v2 or later
 * Text Domain: inspect-africa-bridge
 */

// Prevent direct access
if (!defined('ABSPATH')) {
    exit;
}

// Plugin constants
define('IAB_PLUGIN_FILE', __FILE__);
define('IAB_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('IAB_PLUGIN_URL', plugin_dir_url(__FILE__));
define('IAB_PLUGIN_VERSION', '1.0.39');

// Load main plugin class
require_once IAB_PLUGIN_DIR . 'includes/class-plugin.php';

// Load LMS hooks (for LearnPress integration)
require_once IAB_PLUGIN_DIR . 'includes/class-lms-hooks.php';

// Initialize plugin
iab_plugin();
