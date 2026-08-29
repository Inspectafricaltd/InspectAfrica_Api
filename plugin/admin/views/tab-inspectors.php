<?php
/**
 * Inspectors Tab
 */
defined('ABSPATH') || exit;
?>
<div class="iab-filters">
    <div class="iab-filter-group">
        <label>Status:</label>
        <select id="filter-status" class="iab-filter-select">
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="expired">Expired</option>
            <option value="suspended">Suspended</option>
            <option value="candidate">Candidate</option>
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
                <th>ACHI Number</th>
                <th>Full Name</th>
                <th>Email</th>
                <th>Status</th>
                <th>Expires</th>
                <th>Verifications</th>
                <th>Actions</th>
            </tr>
        </thead>
        <tbody id="inspectors-table-body">
            <tr>
                <td colspan="7" class="iab-loading">
                    <div class="iab-spinner"></div>
                </td>
            </tr>
        </tbody>
    </table>
    <div class="iab-pagination" id="inspectors-pagination"></div>
</div>
