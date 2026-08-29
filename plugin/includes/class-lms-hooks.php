<?php
/**
 * LearnPress Hooks - Trigger webhooks on LMS events
 *
 * @package InspectAfrica_Bridge
 */

if (!defined('ABSPATH')) {
    exit;
}

class IAB_LMS_Hooks {

    /**
     * Initialize hooks
     */
    public static function init(): void {
        // Course completion hooks
        add_action('learn-press/user-course-finished', [__CLASS__, 'on_course_finished'], 10, 3);
        add_action('learn-press/user-course-passed', [__CLASS__, 'on_course_passed'], 10, 3);
        
        // User enrollment hook
        add_action('learn-press/user-enrolled-course', [__CLASS__, 'on_user_enrolled'], 10, 2);
        
        // Certificate status changes (custom)
        add_action('iab_cert_status_changed', [__CLASS__, 'on_cert_status_changed'], 10, 3);
        
        // User profile updates
        add_action('profile_update', [__CLASS__, 'on_profile_update'], 10, 2);
    }

    /**
     * Handle course completion — checks the required-course-set tracker
     * (fires once every required course has been passed). The old
     * single-legacy-course shortcut (lms_certification_course_id) has been
     * retired — it bypassed the real 27-course requirement entirely for
     * anyone who happened to pass that one placeholder course.
     */
    public static function on_course_finished(int $course_id, int $user_id, $result): void {
        IAB_Activity_Logger::log([
            'endpoint' => 'course_completed',
            'method'   => 'HOOK',
            'result'   => 'success',
            'achi_number' => null,
            'ip_address' => '0.0.0.0',
        ]);

        IAB_LMS_Sync::check_required_courses_completion($user_id);
    }

    /**
     * Handle course pass — same check as finished
     */
    public static function on_course_passed(int $course_id, int $user_id, $result): void {
        IAB_LMS_Sync::check_required_courses_completion($user_id);
    }

    /**
     * Handle user enrollment — assign Candidate role and notify backend
     */
    public static function on_user_enrolled(int $course_id, int $user_id): void {
        $user = get_user_by('id', $user_id);
        if (!$user) {
            return;
        }

        // Assign Candidate role if they don't already have an ACHI role
        if (!IAB_Roles::get_achi_role($user_id)) {
            IAB_Roles::assign($user_id, IAB_Roles::CANDIDATE);
        }

        // Send webhook to Fastify to create candidate record
        IAB_Webhook_Handler::send('user_enrolled', [
            'email'       => $user->user_email,
            'full_name'   => $user->display_name,
            'user_id'     => $user_id,
            'course_id'   => $course_id,
            'course_name' => get_the_title($course_id),
        ]);
    }

    /**
     * Handle certificate status changes — keeps WP role, notification email,
     * and webhook in sync no matter what triggered the status change
     * (admin API, cron expiry check, manual suspension, etc).
     */
    public static function on_cert_status_changed(string $achi_number, string $old_status, string $new_status): void {
        global $wpdb;

        $cert = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM " . IAB_Database::table('achi_certificates') . " WHERE achi_number = %s",
            $achi_number
        ), ARRAY_A);

        if (!$cert) {
            return;
        }

        // Log activity — must use the field names IAB_Activity_Logger::log()
        // actually expects (endpoint/result/ip_address are NOT NULL columns).
        // A previous version of this call used unrelated field names
        // (action/entity_type/metadata), which silently failed the insert
        // every time — no error, just a missing row.
        IAB_Activity_Logger::log([
            'endpoint' => 'cert_status_changed',
            'method' => 'HOOK',
            'achi_number' => $achi_number,
            'inspector_id' => $cert['id'],
            'ip_address' => '0.0.0.0',
            'result' => 'success',
            'request_payload' => [
                'old_status' => $old_status,
                'new_status' => $new_status,
            ],
        ]);

        // Keep the user-profile status meta in sync too (see issue_certificate()
        // for why this exists — the proposal specifies the ACHI data is
        // "written to user profile", not just our own custom table).
        if ($cert['user_id']) {
            update_user_meta((int) $cert['user_id'], 'achi_status', $new_status);
        }

        // Sync WP role to match the new certificate status
        if ($cert['user_id']) {
            switch ($new_status) {
                case 'active':
                    IAB_Roles::promote_to_certified((int) $cert['user_id']);
                    break;
                case 'suspended':
                    IAB_Roles::suspend((int) $cert['user_id']);
                    break;
                case 'expired':
                    // Lapsed cert — user needs to recertify, back to candidate
                    IAB_Roles::demote_to_candidate((int) $cert['user_id']);
                    break;
            }
        }

        // Send the appropriate notification email
        self::send_status_change_email($cert, $old_status, $new_status);

        // Send webhook — apps/api handles both expiry and suspension at the
        // same /webhook/cert-expired route, distinguished by 'reason'
        // (apps/api/src/routes/wordpress.ts: certExpiredSchema.reason enum).
        if ($new_status === 'expired' || $new_status === 'suspended') {
            IAB_Webhook_Handler::send('cert_expired', [
                'achi_number' => $achi_number,
                'user_id' => $cert['user_id'],
                'reason' => $new_status,
            ]);
        } else {
            IAB_Webhook_Handler::send('cert_updated', [
                'achi_number' => $achi_number,
                'user_id' => $cert['user_id'],
                'changes' => [
                    'status' => ['old' => $old_status, 'new' => $new_status],
                ],
            ]);
        }
    }

    /**
     * Send the email matching a certificate status transition.
     */
    private static function send_status_change_email(array $cert, string $old_status, string $new_status): void {
        if ($old_status === $new_status) {
            return;
        }

        switch ($new_status) {
            case 'suspended':
                $subject = 'Your ACHI Certification Has Been Suspended';
                $message = sprintf(
                    "Dear %s,\n\nYour ACHI Certificate (%s) has been suspended and is no longer valid for verification.\n\nPlease contact the InspectAfrica team if you believe this is in error.\n\nInspectAfrica Team",
                    $cert['full_name'],
                    $cert['achi_number']
                );
                break;

            case 'expired':
                $subject = 'Your ACHI Certification Has Expired';
                $message = sprintf(
                    "Dear %s,\n\nYour ACHI Certificate (%s) expired on %s.\n\nTo regain your certified status, please complete the recertification process.\n\nInspectAfrica Team",
                    $cert['full_name'],
                    $cert['achi_number'],
                    $cert['expires_at']
                );
                break;

            case 'active':
                // Only send a reinstatement email if coming back from a non-active state
                if (!in_array($old_status, ['suspended', 'expired'], true)) {
                    return;
                }
                $subject = 'Your ACHI Certification Has Been Reinstated';
                $message = sprintf(
                    "Dear %s,\n\nYour ACHI Certificate (%s) is active again and valid for verification.\n\nInspectAfrica Team",
                    $cert['full_name'],
                    $cert['achi_number']
                );
                break;

            default:
                return;
        }

        wp_mail($cert['email'], $subject, $message);
    }

    /**
     * Handle profile updates for certified inspectors
     */
    public static function on_profile_update(int $user_id, \WP_User $old_user_data): void {
        global $wpdb;

        // Check if user is a certified inspector
        $cert = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM " . IAB_Database::table('achi_certificates') . " WHERE user_id = %d AND status = 'active'",
            $user_id
        ), ARRAY_A);

        if (!$cert) {
            return;
        }

        $user = get_user_by('id', $user_id);

        // Check if email changed
        if ($user->user_email !== $old_user_data->user_email) {
            // This requires manual review - log conflict
            IAB_Webhook_Handler::send('cert_updated', [
                'achi_number' => $cert['achi_number'],
                'user_id' => $user_id,
                'changes' => [
                    'email' => ['old' => $old_user_data->user_email, 'new' => $user->user_email],
                ],
                'requires_review' => true,
            ]);
        }

        // Check if name changed
        if ($user->display_name !== $old_user_data->display_name) {
            IAB_Webhook_Handler::send('cert_updated', [
                'achi_number' => $cert['achi_number'],
                'user_id' => $user_id,
                'changes' => [
                    'full_name' => ['old' => $old_user_data->display_name, 'new' => $user->display_name],
                ],
            ]);

            // Update certificate name
            IAB_Cert_Manager::update($cert['id'], [
                'full_name' => $user->display_name,
            ]);
        }
    }
}

// Initialize hooks
IAB_LMS_Hooks::init();
