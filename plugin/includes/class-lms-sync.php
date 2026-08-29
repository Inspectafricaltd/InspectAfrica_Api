<?php
/**
 * LearnPress LMS Integration
 *
 * @package InspectAfrica_Bridge
 */

if (!defined('ABSPATH')) {
    exit;
}

class IAB_LMS_Sync {

    /**
     * Reconciliation sync — catches any user who has passed every required
     * course but, for whatever reason (hook didn't fire, plugin was
     * updated mid-course, etc), never got an ACHI cert issued in real time.
     * Not a bulk "update everyone" pass — issuance already happens live via
     * check_required_courses_completion(); this is a backfill safety net,
     * reusing the exact same issue_certificate() path so behavior (role
     * promotion, webhook, email) is identical either way.
     */
    public static function sync_all(): array {
        global $wpdb;

        $result = [
            'synced' => 0,
            'created' => 0,
            'updated' => 0,
            'errors' => [],
        ];

        if (!class_exists('LP_Course')) {
            $result['errors'][] = 'LearnPress not active';
            return $result;
        }

        $course_ids = self::get_required_course_ids();
        if (empty($course_ids)) {
            $result['errors'][] = 'No required courses configured';
            return $result;
        }

        $placeholders = implode(',', array_fill(0, count($course_ids), '%d'));
        $required_count = count($course_ids);

        // Users who have passed every required course
        $candidate_user_ids = $wpdb->get_col($wpdb->prepare(
            "SELECT user_id FROM {$wpdb->prefix}learnpress_user_items
             WHERE item_id IN ($placeholders)
               AND item_type = 'lp_course'
               AND status = 'finished'
               AND graduation = 'passed'
             GROUP BY user_id
             HAVING COUNT(DISTINCT item_id) >= %d",
            ...array_merge($course_ids, [$required_count])
        ));

        foreach ($candidate_user_ids as $user_id) {
            $user_id = (int) $user_id;

            $existing_cert = $wpdb->get_var($wpdb->prepare(
                "SELECT id FROM " . IAB_Database::table('achi_certificates') . " WHERE user_id = %d",
                $user_id
            ));

            if ($existing_cert) {
                continue; // already certified, nothing to backfill
            }

            $cert = self::issue_certificate($user_id, $course_ids[0]);

            if (is_wp_error($cert)) {
                $result['errors'][] = "Failed to create cert for user $user_id: " . $cert->get_error_message();
            } else {
                $result['created']++;
            }

            $result['synced']++;
        }

        IAB_Database::update_setting('last_sync_at', current_time('mysql'));

        return $result;
    }

    /**
     * Check if a user has passed every course in the required certification
     * set. Called after every course completion — issues the ACHI cert the
     * moment all required courses are passed, per the original agreement
     * (completion of all courses triggers the certificate — no purchase
     * gate). This is the sole production certification trigger — the old
     * single-course shortcut has been retired.
     */
    public static function check_required_courses_completion(int $user_id): void {
        $course_ids = self::get_required_course_ids();
        if (empty($course_ids)) {
            return;
        }

        // Skip if user already has a certificate
        global $wpdb;
        $existing = $wpdb->get_var($wpdb->prepare(
            "SELECT id FROM " . IAB_Database::table('achi_certificates') . " WHERE user_id = %d",
            $user_id
        ));
        if ($existing) {
            return;
        }

        $placeholders = implode(',', array_fill(0, count($course_ids), '%d'));
        $args = array_merge([$user_id], $course_ids);

        $passed = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$wpdb->prefix}learnpress_user_items
             WHERE user_id = %d
               AND item_id IN ($placeholders)
               AND item_type = 'lp_course'
               AND status = 'finished'
               AND graduation = 'passed'",
            ...$args
        ));

        if ($passed >= count($course_ids)) {
            self::issue_certificate($user_id, $course_ids[0]);
        }
    }

    /**
     * The list of course IDs required for ACHI certification — stored as a
     * comma-separated setting so it can be updated without a code change
     * (e.g. once the 3 draft courses are finished and added).
     */
    public static function get_required_course_ids(): array {
        $raw = IAB_Database::get_setting('lms_certification_required_courses', '');
        if (empty($raw)) {
            return [];
        }
        return array_values(array_filter(array_map('intval', array_map('trim', explode(',', $raw)))));
    }

    /**
     * Bulk-set LearnPress evaluation mode + passing grade on a set of
     * courses (defaults to the required-course list). Shared by the REST
     * endpoint and the wp-admin UI action so both stay in sync.
     */
    public static function bulk_set_evaluation_mode(string $mode, int $passing, ?array $course_ids = null): array {
        $course_ids = $course_ids ?? self::get_required_course_ids();

        if (empty($course_ids)) {
            return ['error' => 'No courses configured', 'updated' => [], 'errors' => []];
        }

        $updated = [];
        $errors  = [];

        foreach ($course_ids as $course_id) {
            $course_id = (int) $course_id;
            update_post_meta($course_id, '_lp_course_result', $mode);
            update_post_meta($course_id, '_lp_passing_condition', $passing);
            self::resync_learnpress_course_cache($course_id);

            // update_post_meta() returns false both on real failure and on a
            // no-op (value already matches) — verify actual state instead of
            // trusting the return value.
            $now_mode    = get_post_meta($course_id, '_lp_course_result', true);
            $now_passing = (int) get_post_meta($course_id, '_lp_passing_condition', true);

            if ($now_mode === $mode && $now_passing === $passing) {
                $updated[] = $course_id;
            } else {
                $errors[] = $course_id;
            }
        }

        return ['updated' => $updated, 'errors' => $errors];
    }

    /**
     * Bulk-set price on a set of courses (defaults to the required-course
     * list). Price 0 makes a course free (LearnPress swaps Add to Cart for
     * Enroll Now). Shared by the REST endpoint and the wp-admin UI action.
     */
    public static function bulk_set_course_price(float $price, ?array $course_ids = null): array {
        $course_ids = $course_ids ?? self::get_required_course_ids();

        if (empty($course_ids)) {
            return ['error' => 'No courses configured', 'updated' => [], 'errors' => []];
        }

        $price_str = (string) $price;
        $updated = [];
        $errors  = [];

        foreach ($course_ids as $course_id) {
            $course_id = (int) $course_id;
            update_post_meta($course_id, '_lp_price', $price_str);
            update_post_meta($course_id, '_lp_regular_price', $price_str);
            update_post_meta($course_id, '_lp_sale_price', '');
            self::resync_learnpress_course_cache($course_id);

            $now_price = get_post_meta($course_id, '_lp_price', true);

            if ($now_price === $price_str) {
                $updated[] = $course_id;
            } else {
                $errors[] = $course_id;
            }
        }

        return ['updated' => $updated, 'errors' => $errors];
    }

    /**
     * LearnPress caches a full JSON snapshot of every course in its own
     * wp_learnpress_courses table, and reads from that snapshot BEFORE
     * postmeta on every course lookup (CourseModel::find(), used by the
     * wp-admin edit screen and course pages) — regardless of any
     * "check_cache" flag, which only controls a separate, ephemeral
     * WP object-cache layer on top. Raw update_post_meta() writes (the
     * only mechanism LearnPress itself exposes for bulk price/evaluation
     * updates) update the real source of truth but leave that JSON
     * snapshot stale indefinitely — so the edit screen keeps showing old
     * values forever, surviving even a hard browser refresh, because the
     * staleness is server-side, not a browser cache.
     *
     * Fix: delete the stale snapshot row so the next lookup is forced to
     * fall back to fresh postmeta, then immediately re-save through
     * LearnPress's own model so it regenerates a correct snapshot and
     * clears its own object cache. Requires LearnPress 4.2.6.9+ (the
     * CourseModel/JSON-snapshot architecture) — silently no-ops on older
     * versions that don't have this class, since they don't have this
     * caching layer to begin with.
     */
    private static function resync_learnpress_course_cache(int $course_id): void {
        if (!class_exists('\LearnPress\Models\CourseModel')) {
            return;
        }

        global $wpdb;
        $wpdb->delete("{$wpdb->prefix}learnpress_courses", ['ID' => $course_id]);

        try {
            $course_model = \LearnPress\Models\CourseModel::find($course_id, false);
            if ($course_model instanceof \LearnPress\Models\CourseModel) {
                $course_model->save(true);
            }
        } catch (\Throwable $e) {
            error_log('IAB: failed to resync LearnPress course cache for course ' . $course_id . ': ' . $e->getMessage());
        }
    }

    /**
     * Issue certificate to user
     */
    private static function issue_certificate(int $user_id, int $course_id): array|WP_Error {
        global $wpdb;

        $user = get_user_by('id', $user_id);
        if (!$user) {
            return new WP_Error('user_not_found', 'User not found');
        }

        // Check for existing certificate
        $existing = $wpdb->get_var($wpdb->prepare(
            "SELECT id FROM " . IAB_Database::table('achi_certificates') . " WHERE user_id = %d",
            $user_id
        ));

        if ($existing) {
            return new WP_Error('already_exists', 'Certificate already exists');
        }

        $achi_number = self::generate_achi_number();
        $issued_at = date('Y-m-d');
        $expires_at = date('Y-m-d', strtotime('+1 year'));

        $cert = IAB_Cert_Manager::create([
            'achi_number' => $achi_number,
            'user_id' => $user_id,
            'full_name' => $user->display_name,
            'email' => $user->user_email,
            'phone' => get_user_meta($user_id, 'phone', true) ?: null,
            'certification_type' => 'Home Inspector',
            'issued_at' => $issued_at,
            'expires_at' => $expires_at,
            'status' => 'active',
            'lms_course_id' => $course_id,
        ]);

        if (!is_wp_error($cert)) {
            // Write the ACHI number to the user's own profile meta — the
            // signed proposal says "written to user profile," and the
            // custom achi_certificates table alone doesn't satisfy that
            // literally (not visible from wp-admin's user-edit screen or
            // any other WP-native tooling without our own DB access).
            update_user_meta($user_id, 'achi_number', $achi_number);
            update_user_meta($user_id, 'achi_status', 'active');

            // Promote user role to Certified
            IAB_Roles::promote_to_certified($user_id);

            // Send webhook to Fastify
            IAB_Webhook_Handler::send('cert_issued', $cert);

            // Send email to user
            self::send_certificate_email($cert);
        }

        return $cert;
    }

    /**
     * Generate unique ACHI number
     */
    private static function generate_achi_number(): string {
        global $wpdb;
        $table = IAB_Database::table('achi_certificates');

        do {
            $number = 'ACHI-' . date('Y') . '-' . str_pad(mt_rand(1, 99999), 5, '0', STR_PAD_LEFT);
            $exists = $wpdb->get_var($wpdb->prepare(
                "SELECT id FROM $table WHERE achi_number = %s",
                $number
            ));
        } while ($exists);

        return $number;
    }

    /**
     * Send certificate email
     */
    private static function send_certificate_email(array $cert): bool {
        $subject = 'Your ACHI Certificate Has Been Issued';
        $message = sprintf(
            "Congratulations %s!\n\nYour ACHI Certificate has been issued.\n\nACHI Number: %s\nIssued: %s\nExpires: %s\n\nYou can now use your ACHI number to register on the InspectAfrica platform.",
            $cert['full_name'],
            $cert['achi_number'],
            $cert['issued_at'],
            $cert['expires_at']
        );

        // Generate the personalized certificate image and attach it —
        // a failure here should never block the email itself from sending,
        // just skip the attachment and log it.
        $attachments = [];
        $cert_image = IAB_Certificate_Generator::generate($cert['full_name'], $cert['achi_number'], $cert['issued_at']);
        if (is_wp_error($cert_image)) {
            error_log('IAB: certificate image generation failed for ' . $cert['achi_number'] . ': ' . $cert_image->get_error_message());
        } else {
            $attachments[] = $cert_image;
        }

        return wp_mail($cert['email'], $subject, $message, [], $attachments);
    }
}
