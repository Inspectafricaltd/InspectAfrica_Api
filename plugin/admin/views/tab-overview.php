<?php
/**
 * Overview Tab
 */
defined('ABSPATH') || exit;
?>
<div class="iab-cards">
    <div class="iab-card">
        <div class="iab-card-header">
            <span class="material-symbols-outlined">badge</span>
            <span class="iab-card-title">Total Certificates</span>
        </div>
        <div class="iab-card-value" id="stat-total">-</div>
    </div>

    <div class="iab-card">
        <div class="iab-card-header">
            <span class="material-symbols-outlined">verified</span>
            <span class="iab-card-title">Active</span>
        </div>
        <div class="iab-card-value success" id="stat-active">-</div>
    </div>

    <div class="iab-card">
        <div class="iab-card-header">
            <span class="material-symbols-outlined">event_busy</span>
            <span class="iab-card-title">Expired</span>
        </div>
        <div class="iab-card-value warning" id="stat-expired">-</div>
    </div>

    <div class="iab-card">
        <div class="iab-card-header">
            <span class="material-symbols-outlined">schedule</span>
            <span class="iab-card-title">Expiring (30 days)</span>
        </div>
        <div class="iab-card-value danger" id="stat-expiring">-</div>
    </div>
</div>

<div class="iab-cards">
    <div class="iab-card">
        <div class="iab-card-header">
            <span class="material-symbols-outlined">api</span>
            <span class="iab-card-title">API Requests (7d)</span>
        </div>
        <div class="iab-card-value" id="stat-requests">-</div>
    </div>

    <div class="iab-card">
        <div class="iab-card-header">
            <span class="material-symbols-outlined">check_circle</span>
            <span class="iab-card-title">Successful</span>
        </div>
        <div class="iab-card-value success" id="stat-success">-</div>
    </div>

    <div class="iab-card">
        <div class="iab-card-header">
            <span class="material-symbols-outlined">error</span>
            <span class="iab-card-title">Errors</span>
        </div>
        <div class="iab-card-value danger" id="stat-errors">-</div>
    </div>
</div>

