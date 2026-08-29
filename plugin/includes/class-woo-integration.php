<?php
/**
 * WooCommerce <-> LearnPress integration glue.
 *
 * The learnpress-woo-payment addon creates its internal LP Order record on
 * a WooCommerce order status change, but two hooks LearnPress core would
 * normally listen to for enrollment notifications are commented out in
 * that addon's source (confirmed by reading incs/LPWooOrderHandler.php —
 * both learn-press/checkout-order-processed and
 * learn-press/woo-checkout-create-lp-order-processed are dead code in the
 * installed version). This class compensates for that gap directly,
 * without touching the addon or LearnPress core.
 *
 * @package InspectAfrica_Bridge
 */

if (!defined('ABSPATH')) {
    exit;
}

class IAB_Woo_Integration {

    public static function init(): void {
        add_action('woocommerce_order_status_completed', [self::class, 'send_enrollment_email']);
        add_action('woocommerce_account_dashboard', [self::class, 'render_my_courses_section']);
    }

    /**
     * Send a proper enrollment confirmation email when a WooCommerce order
     * containing course purchases completes — WooCommerce's own order email
     * still sends separately; this is the LearnPress-flavored one that
     * should have fired via the addon's (broken) hooks.
     */
    public static function send_enrollment_email(int $order_id): void {
        // Guard against double-send if this hook fires more than once for
        // the same order (WooCommerce can re-trigger status hooks on resave).
        if (get_post_meta($order_id, '_iab_enrollment_email_sent', true)) {
            return;
        }

        $order = wc_get_order($order_id);
        if (!$order) {
            return;
        }

        $course_titles = [];
        foreach ($order->get_items() as $item) {
            $product_id = $item->get_product_id();
            if (get_post_type($product_id) === 'lp_course') {
                $course_titles[] = html_entity_decode(get_the_title($product_id));
            }
        }

        if (empty($course_titles)) {
            return; // Order had no courses in it — not our concern.
        }

        $email = $order->get_billing_email();
        if (!$email) {
            return;
        }

        $name = trim($order->get_billing_first_name() . ' ' . $order->get_billing_last_name());
        $name = $name ?: 'there';

        $course_list = implode("\n", array_map(fn($t) => "  - $t", $course_titles));

        $subject = 'You\'re enrolled! Welcome to InspectAfrica';
        $message = sprintf(
            "Hi %s,\n\nYour enrollment is confirmed for:\n\n%s\n\nYou can start learning right away — log in at %s and head to your course dashboard.\n\nInspectAfrica Team",
            $name,
            $course_list,
            home_url('/my-account/')
        );

        wp_mail($email, $subject, $message);

        update_post_meta($order_id, '_iab_enrollment_email_sent', 1);
    }

    /**
     * Inject a "My Courses" section into WooCommerce's My Account dashboard
     * tab, so a student purchasing through the WooCommerce-routed checkout
     * sees their actual enrolled courses instead of only WooCommerce's
     * generic order/address/account-details links.
     */
    public static function render_my_courses_section(): void {
        $user_id = get_current_user_id();
        if (!$user_id) {
            return;
        }

        global $wpdb;

        $enrolled = $wpdb->get_results($wpdb->prepare(
            "SELECT item_id, status, graduation FROM {$wpdb->prefix}learnpress_user_items
             WHERE user_id = %d AND item_type = 'lp_course'
             ORDER BY start_time DESC",
            $user_id
        ), ARRAY_A);

        if (empty($enrolled)) {
            return;
        }

        echo '<h2>' . esc_html__('My Courses', 'inspect-africa-bridge') . '</h2>';
        echo '<table class="woocommerce-orders-table shop_table shop_table_responsive my_account_courses">';
        echo '<thead><tr><th>' . esc_html__('Course', 'inspect-africa-bridge') . '</th><th>' . esc_html__('Status', 'inspect-africa-bridge') . '</th><th></th></tr></thead><tbody>';

        foreach ($enrolled as $row) {
            $course_id = (int) $row['item_id'];
            $title = get_the_title($course_id);
            $permalink = get_permalink($course_id);

            $status_label = 'In progress';
            if ($row['status'] === 'finished' && $row['graduation'] === 'passed') {
                $status_label = 'Completed';
            } elseif ($row['status'] === 'finished' && $row['graduation'] === 'failed') {
                $status_label = 'Not passed';
            }

            printf(
                '<tr><td>%s</td><td>%s</td><td><a class="woocommerce-button button" href="%s">%s</a></td></tr>',
                esc_html($title),
                esc_html($status_label),
                esc_url($permalink),
                esc_html__('Continue', 'inspect-africa-bridge')
            );
        }

        echo '</tbody></table>';
    }
}

IAB_Woo_Integration::init();
