<?php
/**
 * REST API Endpoints
 *
 * @package InspectAfrica_Bridge
 */

if (!defined('ABSPATH')) {
    exit;
}

class IAB_REST_API {

    /** @var string */
    private $namespace = 'inspectafrica/v1';

    /**
     * Allow cross-origin requests (with our custom headers) to this namespace only.
     * Needed because the PWA runs on a different origin than the WordPress site.
     */
    public function add_cors_support(): void {
        remove_filter('rest_pre_serve_request', 'rest_send_cors_headers');

        add_filter('rest_pre_serve_request', function ($value) {
            header('Access-Control-Allow-Origin: *');
            header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
            header('Access-Control-Allow-Headers: Content-Type, Authorization, X-IA-API-Key');
            return $value;
        });

        // The headers above are set on rest_pre_serve_request, which fires AFTER
        // route dispatch — including the permission_callback. A browser's
        // preflight OPTIONS request never carries the real X-IA-API-Key value
        // (only announces it via Access-Control-Request-Headers), so any route
        // gated by IAB_Auth::verify_api_key() rejects the preflight itself with
        // a 401 before the CORS headers above are ever reached. The browser then
        // treats that as a CORS failure and never sends the real request — this
        // affected the test panel and would affect any future browser-based
        // admin UI. Short-circuit OPTIONS at rest_pre_dispatch, before permission
        // checks run, scoped to our namespace only.
        add_filter('rest_pre_dispatch', function ($result, $server, $request) {
            if ($request->get_method() === 'OPTIONS' && strpos($request->get_route(), '/' . $this->namespace) === 0) {
                return new WP_REST_Response(null, 200);
            }
            return $result;
        }, 10, 3);
    }

    /**
     * Register all REST routes
     */
    public function register_routes(): void {
        $this->add_cors_support();

        // Certificate verification (public, rate-limited).
        // Accepts both GET (query param, ?achi_number=...) and POST (JSON
        // body, {achi_number}) — the signed proposal specifies POST, and
        // apps/api calls it that way; GET is kept for the browser test
        // panel and any other existing callers. WP_REST_Request::get_param()
        // reads both query and body params transparently, so one callback
        // serves both methods with no branching.
        register_rest_route($this->namespace, '/verify-cert', [
            'methods' => WP_REST_Server::READABLE . ', ' . WP_REST_Server::CREATABLE,
            'callback' => [$this, 'verify_certificate'],
            'permission_callback' => [$this, 'public_permission'],
            'args' => [
                'achi_number' => [
                    'required' => true,
                    'validate_callback' => [$this, 'validate_achi_number'],
                ],
            ],
        ]);

        // Sync certificates (API key required)
        register_rest_route($this->namespace, '/sync-certificates', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'sync_certificates'],
            'permission_callback' => [IAB_Auth::class, 'verify_api_key'],
        ]);

        // Get all certificates (API key required)
        register_rest_route($this->namespace, '/certificates', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'get_certificates'],
            'permission_callback' => [IAB_Auth::class, 'verify_api_key'],
        ]);

        // Get single certificate
        register_rest_route($this->namespace, '/certificates/(?P<id>\d+)', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'get_certificate'],
            'permission_callback' => [IAB_Auth::class, 'verify_api_key'],
        ]);

        // Create certificate
        register_rest_route($this->namespace, '/certificates', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'create_certificate'],
            'permission_callback' => [IAB_Auth::class, 'verify_api_key'],
        ]);

        // Update certificate
        register_rest_route($this->namespace, '/certificates/(?P<id>\d+)', [
            'methods' => WP_REST_Server::EDITABLE,
            'callback' => [$this, 'update_certificate'],
            'permission_callback' => [IAB_Auth::class, 'verify_api_key'],
        ]);

        // Delete certificate
        register_rest_route($this->namespace, '/certificates/(?P<id>\d+)', [
            'methods' => WP_REST_Server::DELETABLE,
            'callback' => [$this, 'delete_certificate'],
            'permission_callback' => [IAB_Auth::class, 'verify_api_key'],
        ]);

        // Health check
        register_rest_route($this->namespace, '/health', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'health_check'],
            'permission_callback' => '__return_true',
        ]);

        // Activity log
        register_rest_route($this->namespace, '/activity', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'get_activity'],
            'permission_callback' => [IAB_Auth::class, 'verify_api_key'],
        ]);

        // JWT: issue token
        register_rest_route($this->namespace, '/auth/token', [
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'auth_token'],
            'permission_callback' => '__return_true',
            'args' => [
                'email'    => ['required' => true, 'sanitize_callback' => 'sanitize_email'],
                'password' => ['required' => true],
            ],
        ]);

        // JWT: get current user + cert status
        register_rest_route($this->namespace, '/auth/me', [
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => [$this, 'auth_me'],
            'permission_callback' => '__return_true',
        ]);

        // Debug: inspect the collection setting + raw post_parent query results
        register_rest_route($this->namespace, '/admin/debug-collection', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'debug_collection'],
            'permission_callback' => [IAB_Auth::class, 'verify_api_key'],
        ]);

        // Bulk update course evaluation mode across the certification collection
        register_rest_route($this->namespace, '/admin/set-evaluation-mode', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'set_evaluation_mode'],
            'permission_callback' => [IAB_Auth::class, 'verify_api_key'],
            'args' => [
                'mode' => [
                    'required' => true,
                    'validate_callback' => fn($v) => in_array($v, ['evaluate_quiz', 'evaluate_lesson', 'evaluate_final_quiz'], true),
                ],
                'passing_grade' => [
                    'default' => 80,
                    'validate_callback' => fn($v) => is_numeric($v) && (int)$v >= 0 && (int)$v <= 100,
                ],
            ],
        ]);

        // Bulk update course price across the certification collection
        register_rest_route($this->namespace, '/admin/set-course-price', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'set_course_price'],
            'permission_callback' => [IAB_Auth::class, 'verify_api_key'],
            'args' => [
                'price' => [
                    'default' => 0,
                    'validate_callback' => fn($v) => is_numeric($v) && (float)$v >= 0,
                ],
            ],
        ]);

        // Debug: list every quiz in a course with its passing grade
        register_rest_route($this->namespace, '/admin/course-quizzes', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'get_course_quizzes'],
            'permission_callback' => [IAB_Auth::class, 'verify_api_key'],
            'args' => [
                'course_id' => [
                    'default' => 5668,
                    'validate_callback' => fn($v) => is_numeric($v) && (int)$v > 0,
                ],
            ],
        ]);

        // Testing: mark a user as having passed a course, then run the real
        // cert-issuance path — for exercising the flow without manually
        // completing every quiz.
        register_rest_route($this->namespace, '/admin/mock-pass-course', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'mock_pass_course'],
            'permission_callback' => [IAB_Auth::class, 'verify_api_key'],
            'args' => [
                'user_id' => [
                    'required' => true,
                    'validate_callback' => fn($v) => is_numeric($v) && (int)$v > 0,
                ],
                'course_id' => [
                    'default' => 5668,
                    'validate_callback' => fn($v) => is_numeric($v) && (int)$v > 0,
                ],
            ],
        ]);

        // Reconcile the outbound-webhook credentials with apps/api, without
        // needing a WP admin login session (API-key gated, same as the other
        // admin endpoints).
        register_rest_route($this->namespace, '/admin/set-webhook-config', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'set_webhook_config'],
            'permission_callback' => [IAB_Auth::class, 'verify_api_key'],
            'args' => [
                // Outbound: sent as X-WP-API-Key to apps/api. Must NOT be
                // confused with the inbound 'api_key' setting used to
                // authenticate requests INTO this site — they were once the
                // same setting and changing one broke the other.
                'outbound_api_key' => ['required' => false],
                'fastify_webhook_url' => ['required' => false],
                // Only for recovering from the inbound/outbound key mixup —
                // restores the key clients (this test panel, etc) must send
                // as X-IA-API-Key to authenticate into this site's own API.
                'inbound_api_key' => ['required' => false],
            ],
        ]);

        // Debug: see the real HTTP result of recent outbound webhook deliveries
        register_rest_route($this->namespace, '/admin/webhook-log', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'get_webhook_log'],
            'permission_callback' => [IAB_Auth::class, 'verify_api_key'],
            'args' => [
                'limit' => [
                    'default' => 10,
                    'validate_callback' => fn($v) => is_numeric($v) && (int)$v > 0 && (int)$v <= 50,
                ],
            ],
        ]);

        // Set/replace the list of course IDs required for ACHI certification
        register_rest_route($this->namespace, '/admin/set-required-courses', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'set_required_courses'],
            'permission_callback' => [IAB_Auth::class, 'verify_api_key'],
            'args' => [
                'course_ids' => [
                    'required' => true,
                    'validate_callback' => fn($v) => is_array($v) && count($v) > 0,
                ],
            ],
        ]);

        // Read back the current required-course list + each course's title/status
        register_rest_route($this->namespace, '/admin/required-courses', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'get_required_courses'],
            'permission_callback' => [IAB_Auth::class, 'verify_api_key'],
        ]);

        // One-time backfill: write achi_number/achi_status user meta for
        // certificates issued before v1.0.33 added that write on issuance.
        register_rest_route($this->namespace, '/admin/backfill-achi-user-meta', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'backfill_achi_user_meta'],
            'permission_callback' => [IAB_Auth::class, 'verify_api_key'],
        ]);

        // QA tool: render a certificate with arbitrary test data and return
        // the raw JPEG directly (viewable via <img src="..."> or a browser
        // tab) — for confirming GD/FreeType renders correctly on this
        // specific server before trusting it in real issuance emails.
        register_rest_route($this->namespace, '/admin/preview-certificate', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'preview_certificate'],
            'permission_callback' => [IAB_Auth::class, 'verify_api_key'],
            'args' => [
                'name' => ['default' => 'Jane Doe'],
                'achi_number' => ['default' => 'ACHI-2026-00000'],
                'date' => ['default' => null],
            ],
        ]);

        // Diagnostic: read the actual live WooCommerce/LearnPress settings
        // that control whether a guest can add a course to cart / must log
        // in first — so we're reading real config, not guessing from docs.
        register_rest_route($this->namespace, '/admin/debug-checkout-settings', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'debug_checkout_settings'],
            'permission_callback' => [IAB_Auth::class, 'verify_api_key'],
        ]);

        // Diagnostic: actually attempt to send a test email via wp_mail()
        // and capture whether the underlying mailer failed, rather than
        // guessing from wp_mail()'s uninformative boolean return value.
        register_rest_route($this->namespace, '/admin/test-email', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'test_email'],
            'permission_callback' => [IAB_Auth::class, 'verify_api_key'],
            'args' => [
                'to' => ['required' => true],
            ],
        ]);

        // Diagnostic: confirm whether course "products" are actually treated
        // as virtual (no shipping fields) by WooCommerce, since courses and
        // shop hardware share one checkout via learnpress-woo-payment.
        register_rest_route($this->namespace, '/admin/debug-course-virtual-status', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'debug_course_virtual_status'],
            'permission_callback' => [IAB_Auth::class, 'verify_api_key'],
        ]);
    }

    /**
     * Report the WooCommerce/LearnPress options that govern guest cart access,
     * guest checkout, and account creation at checkout.
     */
    public function debug_checkout_settings(WP_REST_Request $request): WP_REST_Response {
        global $wpdb;

        $woocommerce_keys = [
            'woocommerce_enable_guest_checkout',
            'woocommerce_enable_checkout_login_reminder',
            'woocommerce_enable_signup_and_login_from_checkout',
            'woocommerce_enable_myaccount_registration',
            'woocommerce_registration_generate_username',
            'woocommerce_registration_generate_password',
        ];

        $woocommerce_settings = [];
        foreach ($woocommerce_keys as $key) {
            $woocommerce_settings[$key] = get_option($key, null);
        }

        // Any LearnPress option that looks related to login/guest/account
        // requirements — searched rather than guessed, since exact key names
        // vary across LearnPress versions.
        $learnpress_settings = $wpdb->get_results(
            "SELECT option_name, option_value FROM {$wpdb->options}
             WHERE option_name LIKE 'learn_press_%'
               AND (option_name LIKE '%login%' OR option_name LIKE '%guest%' OR option_name LIKE '%account%' OR option_name LIKE '%register%')",
            ARRAY_A
        );

        $active_plugins = get_option('active_plugins', []);
        $relevant_plugins = array_values(array_filter($active_plugins, function ($p) {
            return stripos($p, 'woocommerce') !== false || stripos($p, 'learnpress') !== false;
        }));

        return new WP_REST_Response([
            'woocommerce_settings' => $woocommerce_settings,
            'learnpress_login_related_settings' => $learnpress_settings,
            'active_woocommerce_learnpress_plugins' => $relevant_plugins,
        ], 200);
    }

    /**
     * Send a real test email via wp_mail() and report whether it actually
     * succeeded — wp_mail()'s own return value only means "PHPMailer's send()
     * didn't throw," which is true even when the receiving mail server
     * silently rejects the message. Hooking wp_mail_failed catches real
     * SMTP/PHPMailer errors (auth failure, connection refused, etc).
     */
    public function test_email(WP_REST_Request $request): WP_REST_Response {
        $to = sanitize_email($request->get_param('to'));

        if (!is_email($to)) {
            return new WP_REST_Response(['error' => 'Invalid email address'], 400);
        }

        $captured_error = null;
        $error_handler = function ($wp_error) use (&$captured_error) {
            $captured_error = $wp_error->get_error_message();
        };
        add_action('wp_mail_failed', $error_handler);

        $sent = wp_mail(
            $to,
            'InspectAfrica — test email (' . current_time('mysql') . ')',
            "This is a test email from the InspectAfrica Bridge plugin's /admin/test-email endpoint.\n\nIf you received this, wp_mail() and the site's mail delivery are working correctly."
        );

        remove_action('wp_mail_failed', $error_handler);

        // Report which mailer WordPress is actually using — if no SMTP
        // plugin is active, this falls back to PHP's mail(), which many
        // hosts silently drop or spam-filter without ever erroring.
        global $phpmailer;
        $mailer_type = 'unknown';
        if ($phpmailer instanceof PHPMailer\PHPMailer\PHPMailer) {
            $mailer_type = $phpmailer->Mailer; // 'mail', 'smtp', or 'sendmail'
        }

        return new WP_REST_Response([
            'sent' => $sent,
            'error' => $captured_error,
            'mailer' => $mailer_type,
            'note' => $sent && !$captured_error
                ? 'wp_mail() reported success and no PHPMailer error was raised. If the email still never arrives, the receiving server (or the sending mail() transport) is silently dropping it — check spam folder first, then consider installing a proper SMTP plugin (WP Mail SMTP, Post SMTP) connected to a real provider (SendGrid, Mailgun, SES, etc).'
                : 'A real failure was captured — see the error field above.',
        ], 200);
    }

    /**
     * Confirm whether course "products" are treated as virtual (no shipping
     * fields) by WooCommerce. Checks both integration modes:
     *  - Default mode: LearnPress wraps each course in an in-memory
     *    WC_Product_LP_Course object at cart/checkout time. Its is_virtual()
     *    hardcodes true unless a filter overrides it — instantiate the real
     *    class and call it directly, rather than trusting the source alone,
     *    since a filter could change the answer at runtime.
     *  - "Buy courses via Product" mode: courses are assigned to real WC
     *    Product posts via postmeta '_lp_woo_courses_assigned' — those posts
     *    have their own '_virtual'/'_downloadable' meta to check directly.
     */
    public function debug_course_virtual_status(WP_REST_Request $request): WP_REST_Response {
        global $wpdb;

        $result = [
            'wc_product_lp_course_class_exists' => class_exists('WC_Product_LP_Course'),
            'default_mode_sample' => [],
            'buy_via_product_mode' => [],
        ];

        // Default mode: instantiate the real wrapper class against actual
        // required courses and call is_virtual()/is_downloadable() live.
        if (class_exists('WC_Product_LP_Course')) {
            $course_ids = IAB_LMS_Sync::get_required_course_ids();
            $sample_ids = array_slice($course_ids, 0, 5);

            foreach ($sample_ids as $course_id) {
                $wc_course_product = new WC_Product_LP_Course((int) $course_id);
                $result['default_mode_sample'][] = [
                    'course_id' => (int) $course_id,
                    'title' => get_the_title($course_id),
                    'is_virtual' => $wc_course_product->is_virtual(),
                    'is_downloadable' => $wc_course_product->is_downloadable(),
                ];
            }
        }

        // "Buy via Product" mode: real WC Product posts with courses assigned.
        $assigned_product_ids = $wpdb->get_col(
            "SELECT DISTINCT post_id FROM {$wpdb->postmeta}
             WHERE meta_key = '_lp_woo_courses_assigned'"
        );

        foreach ($assigned_product_ids as $product_id) {
            $product_id = (int) $product_id;
            $result['buy_via_product_mode'][] = [
                'product_id' => $product_id,
                'title' => get_the_title($product_id),
                'is_virtual_meta' => get_post_meta($product_id, '_virtual', true),
                'is_downloadable_meta' => get_post_meta($product_id, '_downloadable', true),
                'assigned_course_ids' => get_post_meta($product_id, '_lp_woo_courses_assigned', true),
            ];
        }

        // Also surface the actual toggle value, searched rather than guessed.
        $buy_via_product_setting = $wpdb->get_results(
            "SELECT option_name, option_value FROM {$wpdb->options}
             WHERE option_name LIKE '%buy_course_via_product%'",
            ARRAY_A
        );
        $result['buy_via_product_setting_raw'] = $buy_via_product_setting;

        return new WP_REST_Response($result, 200);
    }

    /**
     * Render a certificate image with test data and stream it back directly
     * (not JSON) — lets you actually see the rendered output in a browser.
     */
    public function preview_certificate(WP_REST_Request $request) {
        $name = sanitize_text_field($request->get_param('name'));
        $achi_number = sanitize_text_field($request->get_param('achi_number'));
        $date = $request->get_param('date') ?: current_time('mysql');

        $filepath = IAB_Certificate_Generator::generate($name, $achi_number, $date);

        if (is_wp_error($filepath)) {
            return new WP_REST_Response(['error' => $filepath->get_error_message()], 500);
        }

        header('Content-Type: image/jpeg');
        header('Content-Length: ' . filesize($filepath));
        readfile($filepath);
        exit;
    }

    /**
     * Backfill achi_number/achi_status user meta for existing certificates
     * that predate v1.0.33 (when issuance started writing these directly).
     * Safe to run repeatedly — just overwrites with current DB values.
     */
    public function backfill_achi_user_meta(WP_REST_Request $request): WP_REST_Response {
        global $wpdb;

        $certs = $wpdb->get_results(
            "SELECT user_id, achi_number, status FROM " . IAB_Database::table('achi_certificates') . " WHERE user_id IS NOT NULL",
            ARRAY_A
        );

        $updated = [];
        foreach ($certs as $cert) {
            $user_id = (int) $cert['user_id'];
            update_user_meta($user_id, 'achi_number', $cert['achi_number']);
            update_user_meta($user_id, 'achi_status', $cert['status']);
            $updated[] = $user_id;
        }

        $this->log_admin_activity($request, '/admin/backfill-achi-user-meta', 'success', [
            'request_payload' => ['updated_count' => count($updated)],
        ]);

        return new WP_REST_Response([
            'success' => true,
            'updated' => count($updated),
            'user_ids' => $updated,
        ], 200);
    }

    /**
     * Set the list of course IDs required for ACHI certification.
     */
    public function set_required_courses(WP_REST_Request $request): WP_REST_Response {
        $course_ids = array_values(array_unique(array_map('intval', (array) $request->get_param('course_ids'))));

        IAB_Database::update_setting('lms_certification_required_courses', implode(',', $course_ids));

        $this->log_admin_activity($request, '/admin/set-required-courses', 'success', [
            'request_payload' => ['course_ids' => $course_ids, 'count' => count($course_ids)],
        ]);

        return new WP_REST_Response([
            'success' => true,
            'count' => count($course_ids),
            'course_ids' => $course_ids,
        ], 200);
    }

    /**
     * Read back the current required-course list with titles/status, so
     * it's easy to confirm the right courses are configured.
     */
    public function get_required_courses(WP_REST_Request $request): WP_REST_Response {
        global $wpdb;

        $course_ids = IAB_LMS_Sync::get_required_course_ids();

        $courses = [];
        if (!empty($course_ids)) {
            $placeholders = implode(',', array_fill(0, count($course_ids), '%d'));
            $courses = $wpdb->get_results($wpdb->prepare(
                "SELECT ID, post_title, post_status FROM {$wpdb->posts} WHERE ID IN ($placeholders)",
                ...$course_ids
            ), ARRAY_A);
        }

        return new WP_REST_Response([
            'count' => count($course_ids),
            'course_ids' => $course_ids,
            'courses' => $courses,
        ], 200);
    }

    /**
     * Most recent outbound webhook attempts, with the actual response
     * apps/api sent back — for confirming delivery succeeded, not just that
     * WordPress attempted to send it.
     */
    public function get_webhook_log(WP_REST_Request $request): WP_REST_Response {
        $limit = (int) $request->get_param('limit');
        $rows = IAB_Webhook_Handler::get_recent($limit);

        return new WP_REST_Response(['count' => count($rows), 'webhooks' => $rows], 200);
    }

    /**
     * Set the outbound webhook key/base URL used to call apps/api, and
     * optionally restore the separate inbound api_key. Only updates
     * whichever param is actually provided.
     */
    public function set_webhook_config(WP_REST_Request $request): WP_REST_Response {
        $updated = [];

        $outbound_key = $request->get_param('outbound_api_key');
        if ($outbound_key !== null && $outbound_key !== '') {
            IAB_Database::update_setting('wp_outbound_api_key', sanitize_text_field($outbound_key));
            $updated[] = 'wp_outbound_api_key';
        }

        $base_url = $request->get_param('fastify_webhook_url');
        if ($base_url !== null && $base_url !== '') {
            IAB_Database::update_setting('fastify_webhook_url', esc_url_raw(rtrim($base_url, '/')));
            $updated[] = 'fastify_webhook_url';
        }

        $inbound_key = $request->get_param('inbound_api_key');
        if ($inbound_key !== null && $inbound_key !== '') {
            IAB_Database::update_setting('api_key', sanitize_text_field($inbound_key));
            $updated[] = 'api_key';
        }

        $this->log_admin_activity($request, '/admin/set-webhook-config', 'success', ['request_payload' => ['updated' => $updated]]);

        return new WP_REST_Response([
            'success' => true,
            'updated' => $updated,
            'current' => [
                'api_key (inbound)' => IAB_Database::get_setting('api_key'),
                'wp_outbound_api_key (outbound)' => IAB_Database::get_setting('wp_outbound_api_key'),
                'fastify_webhook_url' => IAB_Database::get_setting('fastify_webhook_url'),
            ],
        ], 200);
    }

    /**
     * Force a user's LearnPress course record to finished/passed, then run
     * the same completion handlers a real quiz pass would trigger.
     */
    public function mock_pass_course(WP_REST_Request $request): WP_REST_Response {
        global $wpdb;

        $user_id   = (int) $request->get_param('user_id');
        $course_id = (int) $request->get_param('course_id');

        $user = get_user_by('id', $user_id);
        if (!$user) {
            return new WP_REST_Response(['error' => 'User not found'], 404);
        }

        $table = "{$wpdb->prefix}learnpress_user_items";

        $existing_id = $wpdb->get_var($wpdb->prepare(
            "SELECT user_item_id FROM $table WHERE user_id = %d AND item_id = %d AND item_type = 'lp_course'",
            $user_id,
            $course_id
        ));

        if ($existing_id) {
            $wpdb->update(
                $table,
                ['status' => 'finished', 'graduation' => 'passed', 'end_time' => current_time('mysql')],
                ['user_item_id' => $existing_id]
            );
        } else {
            $wpdb->insert($table, [
                'user_id'    => $user_id,
                'item_id'    => $course_id,
                'item_type'  => 'lp_course',
                'status'     => 'finished',
                'graduation' => 'passed',
                'start_time' => current_time('mysql'),
                'end_time'   => current_time('mysql'),
            ]);
        }

        // Run the real completion path — same code a genuine quiz pass triggers
        IAB_LMS_Sync::handle_course_completion($course_id, $user_id);
        IAB_LMS_Sync::handle_course_pass($course_id, $user_id);

        $cert = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM " . IAB_Database::table('achi_certificates') . " WHERE user_id = %d ORDER BY id DESC LIMIT 1",
            $user_id
        ), ARRAY_A);

        $this->log_admin_activity($request, '/admin/mock-pass-course', 'success', [
            'inspector_id' => $cert['id'] ?? null,
            'achi_number' => $cert['achi_number'] ?? null,
            'request_payload' => ['user_id' => $user_id, 'course_id' => $course_id, 'cert_issued' => (bool) $cert],
        ]);

        return new WP_REST_Response([
            'success'   => true,
            'user_id'   => $user_id,
            'course_id' => $course_id,
            'cert_issued' => (bool) $cert,
            'certificate' => $cert,
        ], 200);
    }

    /**
     * List every quiz in a course along with its own passing grade
     * (_lp_passing_grade), plus the course's overall evaluation mode and
     * passing condition. Quizzes belong to sections, sections belong to
     * the course via section_course_id.
     */
    public function get_course_quizzes(WP_REST_Request $request): WP_REST_Response {
        global $wpdb;

        $course_id = (int) $request->get_param('course_id');

        $section_ids = $wpdb->get_col($wpdb->prepare(
            "SELECT section_id FROM {$wpdb->prefix}learnpress_sections WHERE section_course_id = %d",
            $course_id
        ));

        $quizzes = [];

        if (!empty($section_ids)) {
            $placeholders = implode(',', array_fill(0, count($section_ids), '%d'));

            $quiz_ids = $wpdb->get_col($wpdb->prepare(
                "SELECT item_id FROM {$wpdb->prefix}learnpress_section_items
                 WHERE section_id IN ($placeholders) AND item_type = 'lp_quiz'",
                ...$section_ids
            ));

            foreach ($quiz_ids as $quiz_id) {
                $quiz_id = (int) $quiz_id;
                $quizzes[] = [
                    'quiz_id' => $quiz_id,
                    'title' => get_the_title($quiz_id),
                    'status' => get_post_status($quiz_id),
                    'passing_grade' => get_post_meta($quiz_id, '_lp_passing_grade', true),
                ];
            }
        }

        return new WP_REST_Response([
            'course_id' => $course_id,
            'course_evaluation_mode' => get_post_meta($course_id, '_lp_course_result', true),
            'course_passing_condition' => get_post_meta($course_id, '_lp_passing_condition', true),
            'section_count' => count($section_ids),
            'quiz_count' => count($quizzes),
            'quizzes' => $quizzes,
        ], 200);
    }

    /**
     * Course IDs to apply bulk admin actions to (evaluation mode, price) —
     * the same required-course list the completion tracker uses
     * (IAB_LMS_Sync::get_required_course_ids()). Previously this read a
     * separate "collection" concept that was abandoned; kept as one shared
     * source of truth so config changes here always match what actually
     * gates certification.
     */
    private function get_configured_collection_course_ids(): array {
        return IAB_LMS_Sync::get_required_course_ids();
    }

    /**
     * Public permission check (rate limit only)
     */
    public function public_permission(WP_REST_Request $request): bool|WP_Error {
        $ip = $this->get_client_ip($request);

        // Check if blocked
        if (IAB_Auth::is_ip_blocked($ip)) {
            return new WP_Error('ip_blocked', 'Your IP has been blocked', ['status' => 403]);
        }

        // Check rate limit
        return IAB_Auth::check_rate_limit($ip);
    }

    /**
     * Verify ACHI certificate
     */
    public function verify_certificate(WP_REST_Request $request): WP_REST_Response {
        $start_time = microtime(true);
        $achi_number = sanitize_text_field($request->get_param('achi_number'));
        $ip = $this->get_client_ip($request);

        $result = IAB_Cert_Manager::verify($achi_number);
        $response_time = round((microtime(true) - $start_time) * 1000);

        // Log activity
        IAB_Activity_Logger::log([
            'endpoint' => '/verify-cert',
            'method' => $request->get_method(),
            'achi_number' => $achi_number,
            'ip_address' => $ip,
            'user_agent' => $request->get_header('User-Agent'),
            'result' => $result['valid'] ? 'success' : ($result['status'] === 'expired' ? 'expired' : 'invalid'),
            'response_code' => 200,
            'response_time_ms' => $response_time,
        ]);

        return new WP_REST_Response($result, 200);
    }

    /**
     * Sync certificates from LMS
     */
    public function sync_certificates(WP_REST_Request $request): WP_REST_Response {
        $result = IAB_LMS_Sync::sync_all();

        $this->log_admin_activity($request, '/sync-certificates', empty($result['errors']) ? 'success' : 'error', [
            'request_payload' => $result,
        ]);

        return new WP_REST_Response([
            'success' => true,
            'synced' => $result['synced'],
            'errors' => $result['errors'],
        ], 200);
    }

    /**
     * Get all certificates
     */
    public function get_certificates(WP_REST_Request $request): WP_REST_Response {
        $page = (int) $request->get_param('page') ?: 1;
        $per_page = (int) $request->get_param('per_page') ?: 20;
        $status = $request->get_param('status');

        $result = IAB_Cert_Manager::get_all($page, $per_page, $status);

        return new WP_REST_Response($result, 200);
    }

    /**
     * Get single certificate
     */
    public function get_certificate(WP_REST_Request $request): WP_REST_Response {
        $id = (int) $request->get_param('id');
        $cert = IAB_Cert_Manager::get($id);

        if (!$cert) {
            return new WP_REST_Response([
                'error' => 'Certificate not found',
            ], 404);
        }

        return new WP_REST_Response($cert, 200);
    }

    /**
     * Create certificate
     */
    public function create_certificate(WP_REST_Request $request): WP_REST_Response {
        $data = [
            'achi_number' => sanitize_text_field($request->get_param('achi_number')),
            'user_id' => (int) $request->get_param('user_id') ?: null,
            'full_name' => sanitize_text_field($request->get_param('full_name')),
            'email' => sanitize_email($request->get_param('email')),
            'phone' => sanitize_text_field($request->get_param('phone')),
            'certification_type' => sanitize_text_field($request->get_param('certification_type')) ?: 'Home Inspector',
            'issued_at' => sanitize_text_field($request->get_param('issued_at')),
            'expires_at' => sanitize_text_field($request->get_param('expires_at')),
            'status' => sanitize_text_field($request->get_param('status')) ?: 'active',
            'lms_course_id' => (int) $request->get_param('lms_course_id') ?: null,
        ];

        $result = IAB_Cert_Manager::create($data);

        if (is_wp_error($result)) {
            $this->log_admin_activity($request, '/certificates', 'error', ['error_message' => $result->get_error_message()]);
            return new WP_REST_Response([
                'error' => $result->get_error_message(),
            ], 400);
        }

        // Trigger webhook
        IAB_Webhook_Handler::send('cert_issued', $result);

        $this->log_admin_activity($request, '/certificates', 'success', [
            'achi_number' => $result['achi_number'],
            'inspector_id' => $result['id'],
        ]);

        return new WP_REST_Response($result, 201);
    }

    /**
     * Update certificate
     */
    public function update_certificate(WP_REST_Request $request): WP_REST_Response {
        $id = (int) $request->get_param('id');

        $data = [];
        $fields = ['full_name', 'email', 'phone', 'status', 'expires_at', 'certification_type'];

        foreach ($fields as $field) {
            if ($request->has_param($field)) {
                $data[$field] = sanitize_text_field($request->get_param($field));
            }
        }

        $result = IAB_Cert_Manager::update($id, $data);

        if (is_wp_error($result)) {
            $this->log_admin_activity($request, "/certificates/$id", 'error', ['error_message' => $result->get_error_message()]);
            return new WP_REST_Response([
                'error' => $result->get_error_message(),
            ], 400);
        }

        $this->log_admin_activity($request, "/certificates/$id", 'success', [
            'achi_number' => $result['achi_number'] ?? null,
            'inspector_id' => $id,
            'request_payload' => $data,
        ]);

        return new WP_REST_Response($result, 200);
    }

    /**
     * Delete certificate
     */
    public function delete_certificate(WP_REST_Request $request): WP_REST_Response {
        $id = (int) $request->get_param('id');
        $result = IAB_Cert_Manager::delete($id);

        if (is_wp_error($result)) {
            $this->log_admin_activity($request, "/certificates/$id", 'error', ['error_message' => $result->get_error_message()]);
            return new WP_REST_Response([
                'error' => $result->get_error_message(),
            ], 400);
        }

        $this->log_admin_activity($request, "/certificates/$id", 'success', ['inspector_id' => $id]);

        return new WP_REST_Response([
            'success' => true,
            'deleted' => $id,
        ], 200);
    }

    /**
     * Health check endpoint
     */
    public function health_check(WP_REST_Request $request): WP_REST_Response {
        return new WP_REST_Response([
            'status'      => 'ok',
            'version'     => IAB_PLUGIN_VERSION,
            'timestamp'   => current_time('mysql'),
            'php_version' => PHP_VERSION,
            'wp_version'  => get_bloginfo('version'),
        ], 200);
    }

    /**
     * POST /auth/token — authenticate with email + password, receive JWT
     */
    public function auth_token(WP_REST_Request $request): WP_REST_Response {
        $email    = $request->get_param('email');
        $password = $request->get_param('password');

        $user = get_user_by('email', $email);

        if (!$user || !wp_check_password($password, $user->data->user_pass, $user->ID)) {
            return new WP_REST_Response(
                ['error' => 'Invalid email or password'],
                401
            );
        }

        $token = IAB_JWT::issue($user->ID);
        $cert  = $this->get_user_cert_data($user->ID);

        return new WP_REST_Response([
            'token'      => $token,
            'expires_in' => 7 * DAY_IN_SECONDS,
            'user'       => [
                'id'          => $user->ID,
                'email'       => $user->user_email,
                'name'        => $user->display_name,
                'role'        => IAB_Roles::get_achi_role($user->ID),
                'achi_number' => $cert['achi_number'] ?? null,
                'cert_status' => $cert['status'] ?? null,
                'cert_expiry' => $cert['expires_at'] ?? null,
            ],
        ], 200);
    }

    /**
     * GET /auth/me — return current user data from JWT
     */
    public function auth_me(WP_REST_Request $request): WP_REST_Response {
        $payload = IAB_JWT::from_request($request);

        if (is_wp_error($payload)) {
            return new WP_REST_Response(
                ['error' => $payload->get_error_message()],
                $payload->get_error_data()['status'] ?? 401
            );
        }

        $user = get_user_by('id', $payload['sub']);

        if (!$user) {
            return new WP_REST_Response(['error' => 'User not found'], 404);
        }

        $cert = $this->get_user_cert_data($user->ID);

        return new WP_REST_Response([
            'id'          => $user->ID,
            'email'       => $user->user_email,
            'name'        => $user->display_name,
            'role'        => IAB_Roles::get_achi_role($user->ID),
            'achi_number' => $cert['achi_number'] ?? null,
            'cert_status' => $cert['status'] ?? null,
            'cert_expiry' => $cert['expires_at'] ?? null,
            'token_exp'   => $payload['exp'],
        ], 200);
    }

    /**
     * Get a user's active certificate data.
     */
    private function get_user_cert_data(int $user_id): array {
        global $wpdb;

        $cert = $wpdb->get_row($wpdb->prepare(
            "SELECT achi_number, status, expires_at FROM " . IAB_Database::table('achi_certificates') .
            " WHERE user_id = %d ORDER BY id DESC LIMIT 1",
            $user_id
        ), ARRAY_A);

        return $cert ?: [];
    }

    /**
     * Debug: show what the collection lookup actually sees in the DB.
     */
    public function debug_collection(WP_REST_Request $request): WP_REST_Response {
        global $wpdb;

        $collection_id = (int) IAB_Database::get_setting('lms_certification_collection_id');

        $strict = $wpdb->get_results($wpdb->prepare(
            "SELECT ID, post_title, post_type, post_status, post_parent FROM {$wpdb->posts}
             WHERE post_parent = %d AND post_type = 'lp_course' AND post_status = 'publish'",
            $collection_id
        ), ARRAY_A);

        $any_status = $wpdb->get_results($wpdb->prepare(
            "SELECT ID, post_title, post_type, post_status, post_parent FROM {$wpdb->posts}
             WHERE post_parent = %d AND post_type = 'lp_course'",
            $collection_id
        ), ARRAY_A);

        $any_parent_match = $wpdb->get_results($wpdb->prepare(
            "SELECT ID, post_title, post_type, post_status, post_parent FROM {$wpdb->posts}
             WHERE post_parent = %d",
            $collection_id
        ), ARRAY_A);

        $collection_post = $wpdb->get_row($wpdb->prepare(
            "SELECT ID, post_title, post_type, post_status FROM {$wpdb->posts} WHERE ID = %d",
            $collection_id
        ), ARRAY_A);

        // Dump all postmeta on the collection post itself — the course list is
        // likely stored here (serialized array) rather than via post_parent.
        $collection_meta = $wpdb->get_results($wpdb->prepare(
            "SELECT meta_key, meta_value FROM {$wpdb->postmeta} WHERE post_id = %d",
            $collection_id
        ), ARRAY_A);

        // Also check for a dedicated collection-course relationship table
        // (some LearnPress addons create their own join tables).
        $related_tables = $wpdb->get_col(
            "SHOW TABLES LIKE '{$wpdb->prefix}learnpress_%collection%'"
        );

        return new WP_REST_Response([
            'collection_id_setting'  => $collection_id,
            'collection_post'        => $collection_post,
            'collection_postmeta'    => $collection_meta,
            'related_tables'         => $related_tables,
            'strict_match_count'     => count($strict),
            'strict_match'           => $strict,
            'any_status_count'       => count($any_status),
            'any_status'             => $any_status,
            'any_parent_match_count' => count($any_parent_match),
            'any_parent_match_sample' => array_slice($any_parent_match, 0, 5),
        ], 200);
    }

    /**
     * Bulk-set evaluation mode on all courses in the certification collection
     */
    public function set_evaluation_mode(WP_REST_Request $request): WP_REST_Response {
        $mode    = $request->get_param('mode');
        $passing = (int) $request->get_param('passing_grade');

        $course_ids = null;
        if ($request->get_param('course_ids')) {
            $course_ids = array_map('intval', (array) $request->get_param('course_ids'));
        }

        $result = IAB_LMS_Sync::bulk_set_evaluation_mode($mode, $passing, $course_ids);

        if (isset($result['error'])) {
            return new WP_REST_Response(['error' => $result['error']], 400);
        }

        $this->log_admin_activity($request, '/admin/set-evaluation-mode', empty($result['errors']) ? 'success' : 'error', [
            'request_payload' => ['mode' => $mode, 'passing_grade' => $passing, 'updated_ids' => $result['updated'], 'errors' => $result['errors']],
        ]);

        return new WP_REST_Response([
            'success'       => true,
            'mode'          => $mode,
            'passing_grade' => $passing,
            'updated'       => count($result['updated']),
            'updated_ids'   => $result['updated'],
            'errors'        => $result['errors'],
        ], 200);
    }

    /**
     * Bulk-set price on all courses in the certification collection.
     * Price 0 makes a course free (LearnPress swaps Add to Cart for Enroll Now).
     */
    public function set_course_price(WP_REST_Request $request): WP_REST_Response {
        $price = (float) $request->get_param('price');

        $course_ids = null;
        if ($request->get_param('course_ids')) {
            $course_ids = array_map('intval', (array) $request->get_param('course_ids'));
        }

        $result = IAB_LMS_Sync::bulk_set_course_price($price, $course_ids);

        if (isset($result['error'])) {
            return new WP_REST_Response(['error' => $result['error']], 400);
        }

        $this->log_admin_activity($request, '/admin/set-course-price', empty($result['errors']) ? 'success' : 'error', [
            'request_payload' => ['price' => $price, 'updated_ids' => $result['updated'], 'errors' => $result['errors']],
        ]);

        return new WP_REST_Response([
            'success'     => true,
            'price'       => $price,
            'updated'     => count($result['updated']),
            'updated_ids' => $result['updated'],
            'errors'      => $result['errors'],
        ], 200);
    }

    /**
     * Get activity log
     */
    public function get_activity(WP_REST_Request $request): WP_REST_Response {
        $page = (int) $request->get_param('page') ?: 1;
        $per_page = (int) $request->get_param('per_page') ?: 50;
        $result = IAB_Activity_Logger::get_recent($page, $per_page);

        return new WP_REST_Response($result, 200);
    }

    /**
     * Validate ACHI number format
     */
    public function validate_achi_number($value): bool {
        return (bool) preg_match('/^ACHI-\d{4}-\d{5}$/', $value);
    }

    /**
     * Get client IP address
     */
    private function get_client_ip(WP_REST_Request $request): string {
        $ip = $request->get_header('X_Real_IP');
        
        if (empty($ip)) {
            $ip = $request->get_header('X_Forwarded_For');
            if (!empty($ip)) {
                $ip = explode(',', $ip)[0];
            }
        }

        if (empty($ip)) {
            $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
        }

        return sanitize_text_field($ip);
    }

    /**
     * Log an admin/API-key-gated endpoint call to the activity log. Shared
     * by all the /admin/* and CRUD endpoints so admin actions are as
     * auditable as public verify-cert traffic.
     */
    private function log_admin_activity(WP_REST_Request $request, string $endpoint, string $result, array $extra = []): void {
        IAB_Activity_Logger::log(array_merge([
            'endpoint' => $endpoint,
            'method' => $request->get_method(),
            'ip_address' => $this->get_client_ip($request),
            'result' => $result,
        ], $extra));
    }
}
