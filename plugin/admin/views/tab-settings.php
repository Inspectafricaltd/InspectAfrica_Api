<?php
/**
 * Settings Tab
 */
defined('ABSPATH') || exit;
?>
<div class="iab-settings-section">
    <h3>API Configuration</h3>

    <div class="iab-settings-row">
        <div class="iab-settings-label">
            <label>API Key</label>
        </div>
        <div class="iab-settings-field">
            <div class="iab-api-key" style="display:flex;align-items:center;gap:8px;">
                <input type="text" id="current-api-key" readonly
                    value="••••••••••••••••••••••••••••••••"
                    data-key="<?php echo esc_attr(IAB_Database::get_setting('api_key')); ?>"
                    data-hidden="true"
                    style="font-family:monospace;width:320px;letter-spacing:0.05em;">
                <button id="iab-toggle-key" class="iab-btn iab-btn-secondary iab-btn-sm" type="button">Show</button>
                <button id="iab-regenerate-key" class="iab-btn iab-btn-danger iab-btn-sm" type="button">
                    Regenerate
                </button>
            </div>
            <p class="iab-settings-hint">Use this key in the X-IA-API-Key header for API requests.</p>
        </div>
    </div>

    <div class="iab-settings-row">
        <div class="iab-settings-label">
            <label for="setting-webhook-url">Fastify API Base URL</label>
        </div>
        <div class="iab-settings-field">
            <input type="text" id="setting-webhook-url" name="fastify_webhook_url"
                value="<?php echo esc_attr(IAB_Database::get_setting('fastify_webhook_url')); ?>"
                placeholder="https://api.inspectafrica.org/api/v1/wordpress">
            <p class="iab-settings-hint">Base URL only — no trailing path. The plugin appends the correct sub-path per event automatically (e.g. <code>/webhook/cert-issued</code>, <code>/webhook/cert-expired</code>).</p>
        </div>
    </div>
</div>

<div class="iab-settings-section">
    <h3>Rate Limiting</h3>

    <div class="iab-settings-row">
        <div class="iab-settings-label">
            <label for="setting-rate-limit">Max Requests</label>
        </div>
        <div class="iab-settings-field">
            <input type="number" id="setting-rate-limit" name="rate_limit_max"
                value="<?php echo esc_attr(IAB_Database::get_setting('rate_limit_max', '100')); ?>"
                min="10" max="10000">
            <p class="iab-settings-hint">Maximum requests per time window</p>
        </div>
    </div>

    <div class="iab-settings-row">
        <div class="iab-settings-label">
            <label for="setting-rate-window">Time Window (seconds)</label>
        </div>
        <div class="iab-settings-field">
            <input type="number" id="setting-rate-window" name="rate_limit_window"
                value="<?php echo esc_attr(IAB_Database::get_setting('rate_limit_window', '3600')); ?>"
                min="60" max="86400">
            <p class="iab-settings-hint">Default: 3600 (1 hour)</p>
        </div>
    </div>
</div>

<div class="iab-settings-section">
    <h3>LearnPress Integration</h3>

    <div class="iab-settings-row">
        <div class="iab-settings-label">
            <label for="setting-required-courses">Required Courses for Certification</label>
        </div>
        <div class="iab-settings-field">
            <textarea id="setting-required-courses" name="lms_certification_required_courses"
                rows="3" style="width:100%;font-family:monospace;"
                placeholder="15,169,429,3619,..."><?php echo esc_textarea(IAB_Database::get_setting('lms_certification_required_courses', '')); ?></textarea>
            <p class="iab-settings-hint">
                Comma-separated LearnPress course IDs. A student is certified automatically once they've
                passed <strong>every</strong> course in this list — no purchase step, per the original agreement.
                Currently configured: <strong id="required-courses-count">…</strong> course(s).
                <button type="button" id="iab-preview-required-courses" class="iab-btn iab-btn-secondary iab-btn-sm">Preview titles</button>
            </p>
            <div id="required-courses-preview"></div>
        </div>
    </div>

    <div class="iab-settings-row">
        <div class="iab-settings-label">
            <label for="setting-passing-grade">Apply Evaluation Settings</label>
        </div>
        <div class="iab-settings-field">
            <div style="display:flex;align-items:center;gap:8px;">
                <input type="number" id="setting-passing-grade" min="0" max="100" value="80" style="width:80px;">
                <span>% passing grade</span>
                <button type="button" id="iab-apply-evaluation-mode" class="iab-btn iab-btn-secondary iab-btn-sm">Apply to required courses</button>
            </div>
            <p class="iab-settings-hint">
                Sets every course in the list above to <code>evaluate_quiz</code> mode at this passing grade
                (must pass this % of the course's quizzes). Applies immediately — not part of "Save Settings" below.
            </p>
            <div id="apply-evaluation-mode-result"></div>
        </div>
    </div>

    <div class="iab-settings-row">
        <div class="iab-settings-label">
            <label for="setting-bulk-price">Apply Course Price</label>
        </div>
        <div class="iab-settings-field">
            <div style="display:flex;align-items:center;gap:8px;">
                <input type="number" id="setting-bulk-price" min="0" step="0.01" value="0" style="width:100px;">
                <button type="button" id="iab-apply-course-price" class="iab-btn iab-btn-secondary iab-btn-sm">Apply to required courses</button>
            </div>
            <p class="iab-settings-hint">
                Sets every course in the list above to this price. <code>0</code> makes them free (swaps "Add to
                Cart" for "Enroll Now"). Applies immediately — not part of "Save Settings" below.
            </p>
            <div id="apply-course-price-result"></div>
        </div>
    </div>

    <div class="iab-settings-row">
        <div class="iab-settings-label">
            <label for="setting-auto-sync">Auto Sync</label>
        </div>
        <div class="iab-settings-field">
            <label style="display:flex;align-items:center;gap:8px;">
                <input type="checkbox" id="setting-auto-sync" name="auto_sync_enabled"
                    <?php echo IAB_Database::get_setting('auto_sync_enabled', '0') === '1' ? 'checked' : ''; ?>>
                Enable daily automatic sync
            </label>
        </div>
    </div>
</div>

<p class="submit">
    <button id="iab-save-settings" class="iab-btn iab-btn-primary">
        <span class="material-symbols-outlined" style="font-size:18px">save</span>
        Save Settings
    </button>
</p>
