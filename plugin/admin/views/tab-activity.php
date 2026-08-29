<?php
/**
 * Activity Tab
 */
defined('ABSPATH') || exit;
?>
<div class="iab-filters">
    <div class="iab-filter-group">
        <label>ACHI Number:</label>
        <input type="text" id="filter-achi" placeholder="ACHI-2024-00001">
    </div>
    <div class="iab-filter-group">
        <label>Result:</label>
        <select id="filter-result" class="iab-filter-select">
            <option value="">All</option>
            <option value="success">Success</option>
            <option value="expired">Expired</option>
            <option value="blocked">Blocked</option>
            <option value="invalid">Invalid</option>
            <option value="error">Error</option>
        </select>
    </div>
    <button class="iab-btn iab-btn-secondary iab-apply-filters">
        <span class="material-symbols-outlined" style="font-size:18px">filter_list</span>
        Apply
    </button>
</div>

<div class="iab-table-container">
    <table class="iab-table">
        <thead>
            <tr>
                <th>Request ID</th>
                <th>Endpoint</th>
                <th>ACHI Number</th>
                <th>IP Address</th>
                <th>Result</th>
                <th>Response Time</th>
                <th>Timestamp</th>
            </tr>
        </thead>
        <tbody id="activity-table-body">
            <tr>
                <td colspan="7" class="iab-loading">
                    <div class="iab-spinner"></div>
                </td>
            </tr>
        </tbody>
    </table>
    <div class="iab-pagination" id="activity-pagination"></div>
</div>

<h3 style="margin-top:32px;">Outbound Webhook Deliveries</h3>
<p class="iab-settings-hint">
    Real delivery results for events sent to apps/api (cert issued, expired, updated, user enrolled) —
    shows what actually happened, not just that WordPress attempted to send it.
    <button type="button" id="iab-refresh-webhook-log" class="iab-btn iab-btn-secondary iab-btn-sm">Refresh</button>
</p>
<div class="iab-table-container">
    <table class="iab-table">
        <thead>
            <tr>
                <th>Event</th>
                <th>Status</th>
                <th>Response Code</th>
                <th>Error</th>
                <th>Sent</th>
            </tr>
        </thead>
        <tbody id="webhook-log-table-body">
            <tr>
                <td colspan="5" class="iab-loading">
                    <div class="iab-spinner"></div>
                </td>
            </tr>
        </tbody>
    </table>
</div>
