<?php
/**
 * Dashboard wrapper
 */
defined('ABSPATH') || exit;
?>
<div class="wrap iab-dashboard">
    <div class="iab-header">
        <h1>
            <span class="material-symbols-outlined">apartment</span>
            InspectAfrica Bridge
        </h1>
        <div>
            <button id="iab-sync-now" class="iab-btn iab-btn-secondary">
                <span class="material-symbols-outlined">sync</span>
                Sync Now
            </button>
        </div>
    </div>

    <nav class="iab-tabs">
        <?php foreach ($tabs as $key => $label) : ?>
            <button class="iab-tab <?php echo $active_tab === $key ? 'active' : ''; ?>" data-tab="<?php echo esc_attr($key); ?>">
                <?php echo esc_html($label); ?>
            </button>
        <?php endforeach; ?>
    </nav>

    <div class="iab-tab-content" id="tab-overview" style="<?php echo $active_tab !== 'overview' ? 'display:none' : ''; ?>">
        <?php IAB_Admin::render_tab('overview'); ?>
    </div>

    <div class="iab-tab-content" id="tab-activity" style="<?php echo $active_tab !== 'activity' ? 'display:none' : ''; ?>">
        <?php IAB_Admin::render_tab('activity'); ?>
    </div>

    <div class="iab-tab-content" id="tab-inspectors" style="<?php echo $active_tab !== 'inspectors' ? 'display:none' : ''; ?>">
        <?php IAB_Admin::render_tab('inspectors'); ?>
    </div>

    <div class="iab-tab-content" id="tab-settings" style="<?php echo $active_tab !== 'settings' ? 'display:none' : ''; ?>">
        <?php IAB_Admin::render_tab('settings'); ?>
    </div>
</div>
