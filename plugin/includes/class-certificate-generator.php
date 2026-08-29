<?php
/**
 * ACHI Certificate Image Generator
 *
 * Composites a certified inspector's name, ACHI number, and issue date onto
 * the client-supplied certificate template (assets/images/main-certificate.jpg)
 * using GD (bundled with every WordPress install — no new PHP extensions).
 * The signature line is left intentionally blank per client direction.
 *
 * Layout coordinates below were measured directly against the 3300x2550px
 * template (see assets/images/main-certificate.jpg) — if the template
 * artwork is ever replaced, these will need re-measuring.
 *
 * @package InspectAfrica_Bridge
 */

if (!defined('ABSPATH')) {
    exit;
}

class IAB_Certificate_Generator {

    /** Template and font paths */
    private const TEMPLATE = IAB_PLUGIN_DIR . 'assets/images/main-certificate.jpg';
    private const FONT_NAME = IAB_PLUGIN_DIR . 'assets/fonts/great-vibes.ttf';
    private const FONT_DETAIL = IAB_PLUGIN_DIR . 'assets/fonts/eb-garamond-regular.ttf';

    /** Layout — measured against the 3300x2550 template */
    private const NAME_CY = 1280;
    private const NAME_MAX_FONT_SIZE = 130;
    private const NAME_MIN_FONT_SIZE = 60;
    private const NAME_MAX_WIDTH_RATIO = 0.72; // of full image width
    private const NAME_COLOR = [20, 60, 40];

    private const ACHI_CY = 1420;
    private const ACHI_FONT_SIZE = 44;
    private const ACHI_COLOR = [100, 100, 100];

    private const DATE_CENTER_X = 2483;
    private const DATE_TOP_Y = 1980;
    private const DATE_FONT_SIZE = 40;
    private const DATE_COLOR = [20, 20, 20];

    /**
     * Generate a personalized certificate image for one inspector.
     * Returns the absolute file path on success, WP_Error on failure.
     */
    public static function generate(string $full_name, string $achi_number, string $issued_at): string|WP_Error {
        if (!function_exists('imagecreatefromjpeg') || !function_exists('imagettftext')) {
            return new WP_Error('gd_missing', 'PHP GD (with FreeType/TTF support) is required to generate certificates.');
        }

        if (!file_exists(self::TEMPLATE)) {
            return new WP_Error('template_missing', 'Certificate template image not found: ' . self::TEMPLATE);
        }

        $image = @imagecreatefromjpeg(self::TEMPLATE);
        if (!$image) {
            return new WP_Error('template_load_failed', 'Could not load certificate template image.');
        }

        $width = imagesx($image);

        // Name — auto-shrink to fit within NAME_MAX_WIDTH_RATIO of the canvas
        $name_color = imagecolorallocate($image, ...self::NAME_COLOR);
        $name_size = self::NAME_MAX_FONT_SIZE;
        $max_name_width = $width * self::NAME_MAX_WIDTH_RATIO;

        while ($name_size > self::NAME_MIN_FONT_SIZE) {
            $bbox = imagettfbbox($name_size, 0, self::FONT_NAME, $full_name);
            $text_width = $bbox[2] - $bbox[0];
            if ($text_width <= $max_name_width) {
                break;
            }
            $name_size -= 5;
        }
        self::draw_centered($image, $full_name, self::FONT_NAME, $name_size, self::NAME_CY, $name_color, $width);

        // ACHI number — directly below the name
        $achi_color = imagecolorallocate($image, ...self::ACHI_COLOR);
        self::draw_centered($image, $achi_number, self::FONT_DETAIL, self::ACHI_FONT_SIZE, self::ACHI_CY, $achi_color, $width);

        // Date — centered above the "Date" line (not vertically centered like
        // the other two; this anchors from a fixed top Y since it sits above
        // a specific line rather than in an open gap)
        $date_color = imagecolorallocate($image, ...self::DATE_COLOR);
        $date_display = date_i18n('F j, Y', strtotime($issued_at));
        $bbox = imagettfbbox(self::DATE_FONT_SIZE, 0, self::FONT_DETAIL, $date_display);
        $date_width = $bbox[2] - $bbox[0];
        $date_x = self::DATE_CENTER_X - ($date_width / 2) - $bbox[0];
        $date_baseline_y = self::DATE_TOP_Y - $bbox[5]; // bbox[5] is negative (ascender above origin)
        imagettftext($image, self::DATE_FONT_SIZE, 0, (int) $date_x, (int) $date_baseline_y, $date_color, self::FONT_DETAIL, $date_display);

        // Save to uploads/ia-certificates/{ACHI-NUMBER}.jpg
        $upload_dir = wp_upload_dir();
        $cert_dir = trailingslashit($upload_dir['basedir']) . 'ia-certificates/';
        if (!file_exists($cert_dir)) {
            wp_mkdir_p($cert_dir);
        }

        $filename = sanitize_file_name($achi_number) . '.jpg';
        $filepath = $cert_dir . $filename;

        $saved = imagejpeg($image, $filepath, 92);
        imagedestroy($image);

        if (!$saved) {
            return new WP_Error('save_failed', 'Failed to save generated certificate image.');
        }

        return $filepath;
    }

    /**
     * Draw text horizontally centered on the canvas, vertically centered on
     * $cy. GD's imagettftext() origin is the text baseline (not top-left,
     * unlike most image libraries), so centering requires reading the actual
     * glyph bounding box back from imagettfbbox() rather than assuming a
     * fixed line-height.
     */
    private static function draw_centered($image, string $text, string $font, int $size, int $cy, int $color, int $canvas_width): void {
        $bbox = imagettfbbox($size, 0, $font, $text);
        $text_width = $bbox[2] - $bbox[0];
        $text_height = $bbox[1] - $bbox[5]; // bbox[1] = descender (≥0), bbox[5] = ascender (≤0)

        $x = ($canvas_width - $text_width) / 2 - $bbox[0];
        $baseline_y = $cy - ($text_height / 2) - $bbox[5];

        imagettftext($image, $size, 0, (int) $x, (int) $baseline_y, $color, $font, $text);
    }
}
