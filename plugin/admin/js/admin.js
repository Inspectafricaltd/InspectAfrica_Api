/**
 * InspectAfrica Bridge Admin JS
 */

(function ($) {
    'use strict';

    const IAB = {
        init: function () {
            this.bindEvents();
            this.loadTabData();
        },

        bindEvents: function () {
            // Tab navigation
            $(document).on('click', '.iab-tab', this.switchTab);

            // Settings
            $(document).on('click', '#iab-save-settings', this.saveSettings);
            $(document).on('click', '#iab-regenerate-key', this.regenerateKey);
            $(document).on('click', '#iab-toggle-key', this.toggleKeyVisibility);
            $(document).on('click', '#iab-sync-now', this.syncCertificates);
            $(document).on('click', '#iab-preview-required-courses', this.previewRequiredCourses);
            $(document).on('click', '#iab-apply-evaluation-mode', this.applyEvaluationMode);
            $(document).on('click', '#iab-apply-course-price', this.applyCoursePrice);
            $(document).on('click', '#iab-refresh-webhook-log', this.loadWebhookLog);

            // Filters
            $(document).on('change', '.iab-filter-select', this.applyFilters);
            $(document).on('click', '.iab-apply-filters', this.applyFilters);

            // Pagination
            $(document).on('click', '.iab-page-btn', this.changePage);

            // IP actions
            $(document).on('click', '.iab-block-ip', this.blockIP);
            $(document).on('click', '.iab-unblock-ip', this.unblockIP);

            // Certificate actions
            $(document).on('click', '.iab-suspend-cert', this.suspendCertificate);
            $(document).on('click', '.iab-reinstate-cert', this.reinstateCertificate);
        },

        switchTab: function (e) {
            e.preventDefault();
            const tab = $(this).data('tab');

            $('.iab-tab').removeClass('active');
            $(this).addClass('active');

            $('.iab-tab-content').hide();
            $(`#tab-${tab}`).show();

            // Update URL
            const url = new URL(window.location);
            url.searchParams.set('tab', tab);
            history.pushState(null, '', url);

            // Load tab data
            IAB.loadTabData(tab);
        },

        loadTabData: function (activeTab) {
            const tab = activeTab || new URLSearchParams(window.location.search).get('tab') || 'overview';

            switch (tab) {
                case 'overview':
                    this.loadStats();
                    break;
                case 'activity':
                    this.loadActivity();
                    this.loadWebhookLog();
                    break;
                case 'inspectors':
                    this.loadInspectors();
                    break;
            }
        },

        loadStats: function () {
            $.post(iabData.ajaxUrl, {
                action: 'iab_get_stats',
                nonce: iabData.nonce,
            }, function (response) {
                if (response.success) {
                    const data = response.data;

                    $('#stat-total').text(data.certificates.total || 0);
                    $('#stat-active').text(data.certificates.active || 0);
                    $('#stat-expired').text(data.certificates.expired || 0);
                    $('#stat-expiring').text(data.certificates.expiring_30_days || 0);

                    $('#stat-requests').text(data.activity.stats.total_requests || 0);
                    $('#stat-success').text(data.activity.stats.successful || 0);
                    $('#stat-errors').text(data.activity.stats.errors || 0);
                }
            });
        },

        loadActivity: function (page = 1) {
            const container = $('#activity-table-body');
            container.html('<tr><td colspan="7" class="iab-loading"><div class="iab-spinner"></div></td></tr>');

            $.post(iabData.ajaxUrl, {
                action: 'iab_get_activity',
                nonce: iabData.nonce,
                page: page,
                per_page: 20,
                achi_number: $('#filter-achi').val(),
                result: $('#filter-result').val(),
            }, function (response) {
                if (response.success) {
                    IAB.renderActivityTable(response.data);
                } else {
                    // Previously a failed AJAX call (e.g. expired nonce after
                    // a long-open admin session) left the spinner running
                    // forever, indistinguishable from "no new data."
                    const message = (response.data && response.data.message) || 'Failed to load activity — try reloading the page.';
                    container.html(`<tr><td colspan="7" class="iab-error">${message}</td></tr>`);
                }
            }).fail(function () {
                container.html('<tr><td colspan="7" class="iab-error">Request failed — try reloading the page.</td></tr>');
            });
        },

        renderActivityTable: function (data) {
            const tbody = $('#activity-table-body');
            tbody.empty();

            if (!data.logs.length) {
                tbody.html('<tr><td colspan="7">No activity found</td></tr>');
                return;
            }

            data.logs.forEach(function (log) {
                const badgeClass = log.result === 'success' ? 'success' : (log.result === 'blocked' ? 'blocked' : 'error');

                tbody.append(`
                    <tr>
                        <td><code>${log.request_id}</code></td>
                        <td>${log.endpoint}</td>
                        <td>${log.achi_number || '-'}</td>
                        <td>${log.ip_address}</td>
                        <td><span class="iab-badge ${badgeClass}">${log.result}</span></td>
                        <td>${log.response_time_ms ? log.response_time_ms + 'ms' : '-'}</td>
                        <td>${IAB.formatDate(log.created_at)}</td>
                    </tr>
                `);
            });

            // Update pagination
            IAB.updatePagination('activity', data.pagination);
        },

        loadInspectors: function (page = 1) {
            const container = $('#inspectors-table-body');
            container.html('<tr><td colspan="7" class="iab-loading"><div class="iab-spinner"></div></td></tr>');

            $.post(iabData.ajaxUrl, {
                action: 'iab_get_inspectors',
                nonce: iabData.nonce,
                page: page,
                per_page: 20,
                status: $('#filter-status').val(),
            }, function (response) {
                if (response.success) {
                    IAB.renderInspectorsTable(response.data);
                }
            });
        },

        renderInspectorsTable: function (data) {
            const tbody = $('#inspectors-table-body');
            tbody.empty();

            if (!data.certificates.length) {
                tbody.html('<tr><td colspan="7">No inspectors found</td></tr>');
                return;
            }

            data.certificates.forEach(function (cert) {
                let actions = '';
                if (cert.status === 'suspended') {
                    actions = `<button class="iab-btn iab-btn-secondary iab-btn-sm iab-reinstate-cert" data-id="${cert.id}" data-name="${cert.full_name}">Reinstate</button>`;
                } else if (cert.status === 'active') {
                    actions = `<button class="iab-btn iab-btn-danger iab-btn-sm iab-suspend-cert" data-id="${cert.id}" data-name="${cert.full_name}">Suspend</button>`;
                } else {
                    actions = '<span class="iab-settings-hint">—</span>';
                }

                tbody.append(`
                    <tr>
                        <td><code>${cert.achi_number}</code></td>
                        <td>${cert.full_name}</td>
                        <td>${cert.email}</td>
                        <td><span class="iab-badge ${cert.status}">${cert.status}</span></td>
                        <td>${IAB.formatDate(cert.expires_at)}</td>
                        <td>${cert.app_verification_count || 0}</td>
                        <td>${actions}</td>
                    </tr>
                `);
            });

            IAB.updatePagination('inspectors', data.pagination);
        },

        suspendCertificate: function () {
            const id = $(this).data('id');
            const name = $(this).data('name');
            if (!confirm(`Suspend ${name}'s ACHI certification? Their role will be downgraded and they'll be notified by email immediately.`)) {
                return;
            }
            IAB.updateCertificateStatus(id, 'suspended');
        },

        reinstateCertificate: function () {
            const id = $(this).data('id');
            const name = $(this).data('name');
            if (!confirm(`Reinstate ${name}'s ACHI certification? They'll be re-promoted to Certified and notified by email.`)) {
                return;
            }
            IAB.updateCertificateStatus(id, 'active');
        },

        updateCertificateStatus: function (id, status) {
            $.post(iabData.ajaxUrl, {
                action: 'iab_update_certificate_status',
                nonce: iabData.nonce,
                id: id,
                status: status,
            }, function (response) {
                if (response.success) {
                    IAB.showNotice('Certificate status updated', 'success');
                    IAB.loadInspectors();
                } else {
                    IAB.showNotice((response.data && response.data.message) || 'Failed to update certificate', 'error');
                }
            });
        },

        saveSettings: function () {
            const btn = $(this);
            btn.prop('disabled', true).text('Saving...');

            $.post(iabData.ajaxUrl, {
                action: 'iab_update_settings',
                nonce: iabData.nonce,
                fastify_webhook_url: $('#setting-webhook-url').val(),
                rate_limit_max: $('#setting-rate-limit').val(),
                rate_limit_window: $('#setting-rate-window').val(),
                lms_certification_required_courses: $('#setting-required-courses').val(),
                auto_sync_enabled: $('#setting-auto-sync').is(':checked') ? 1 : 0,
            }, function (response) {
                btn.prop('disabled', false).text('Save Settings');
                if (response.success) {
                    IAB.showNotice('Settings saved successfully', 'success');
                    IAB.previewRequiredCourses();
                } else {
                    IAB.showNotice(response.data.message || 'Error saving settings', 'error');
                }
            });
        },

        previewRequiredCourses: function () {
            const raw = $('#setting-required-courses').val();
            const ids = raw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));

            $('#required-courses-count').text(ids.length);

            const preview = $('#required-courses-preview');
            if (!ids.length) {
                preview.html('');
                return;
            }

            preview.html('<div class="iab-loading" style="margin-top:8px;"><div class="iab-spinner"></div></div>');

            $.ajax({
                url: iabData.restUrl + '/admin/required-courses',
                method: 'GET',
                headers: { 'X-IA-API-Key': iabData.apiKey },
            }).done(function (data) {
                const rows = (data.courses || []).map(c =>
                    `<tr><td><code>${c.ID}</code></td><td>${c.post_title}</td><td><span class="iab-badge ${c.post_status === 'publish' ? 'success' : 'blocked'}">${c.post_status}</span></td></tr>`
                ).join('');
                preview.html(`<table class="iab-table" style="margin-top:8px;"><thead><tr><th>ID</th><th>Title</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`);
            }).fail(function () {
                preview.html('<p class="iab-settings-hint" style="color:#c53030;">Save settings first, then preview — the preview reflects what\'s saved, not the unsaved text box.</p>');
            });
        },

        applyEvaluationMode: function () {
            const btn = $(this);
            const passing = $('#setting-passing-grade').val();
            const result = $('#apply-evaluation-mode-result');

            btn.prop('disabled', true).text('Applying...');
            result.html('');

            $.post(iabData.ajaxUrl, {
                action: 'iab_set_evaluation_mode',
                nonce: iabData.nonce,
                passing_grade: passing,
            }, function (response) {
                btn.prop('disabled', false).text('Apply to required courses');
                if (response.success) {
                    result.html(`<p class="iab-settings-hint" style="color:#2f855a;">Applied to ${response.data.updated} course(s).${response.data.errors.length ? ' Failed: ' + response.data.errors.join(', ') : ''}</p>`);
                } else {
                    result.html(`<p class="iab-settings-hint" style="color:#c53030;">${(response.data && response.data.message) || 'Failed to apply'}</p>`);
                }
            });
        },

        applyCoursePrice: function () {
            const btn = $(this);
            const price = $('#setting-bulk-price').val();
            const result = $('#apply-course-price-result');

            btn.prop('disabled', true).text('Applying...');
            result.html('');

            $.post(iabData.ajaxUrl, {
                action: 'iab_set_course_price',
                nonce: iabData.nonce,
                price: price,
            }, function (response) {
                btn.prop('disabled', false).text('Apply to required courses');
                if (response.success) {
                    result.html(`<p class="iab-settings-hint" style="color:#2f855a;">Applied to ${response.data.updated} course(s).${response.data.errors.length ? ' Failed: ' + response.data.errors.join(', ') : ''}</p>`);
                } else {
                    result.html(`<p class="iab-settings-hint" style="color:#c53030;">${(response.data && response.data.message) || 'Failed to apply'}</p>`);
                }
            });
        },

        loadWebhookLog: function () {
            const tbody = $('#webhook-log-table-body');
            tbody.html('<tr><td colspan="5" class="iab-loading"><div class="iab-spinner"></div></td></tr>');

            $.post(iabData.ajaxUrl, {
                action: 'iab_get_webhook_log',
                nonce: iabData.nonce,
                limit: 15,
            }, function (response) {
                if (!response.success) {
                    tbody.html('<tr><td colspan="5" class="iab-error">Failed to load webhook log</td></tr>');
                    return;
                }

                const rows = response.data.webhooks || [];
                if (!rows.length) {
                    tbody.html('<tr><td colspan="5">No webhook deliveries yet</td></tr>');
                    return;
                }

                tbody.empty();
                rows.forEach(function (w) {
                    const badgeClass = w.status === 'delivered' ? 'success' : (w.status === 'pending' ? 'blocked' : 'error');
                    tbody.append(`
                        <tr>
                            <td><code>${w.event_type}</code></td>
                            <td><span class="iab-badge ${badgeClass}">${w.status}</span></td>
                            <td>${w.response_code || '-'}</td>
                            <td>${w.error_message || '-'}</td>
                            <td>${IAB.formatDate(w.created_at)}</td>
                        </tr>
                    `);
                });
            }).fail(function () {
                tbody.html('<tr><td colspan="5" class="iab-error">Request failed</td></tr>');
            });
        },

        regenerateKey: function () {
            if (!confirm('Are you sure? This will invalidate the current API key.')) {
                return;
            }

            $.post(iabData.ajaxUrl, {
                action: 'iab_regenerate_key',
                nonce: iabData.nonce,
            }, function (response) {
                if (response.success) {
                    const input = $('#current-api-key');
                    input.data('key', response.data.api_key);
                    input.data('hidden', true);
                    input.val('••••••••••••••••••••••••••••••••');
                    $('#iab-toggle-key').text('Show');
                    IAB.showNotice('API key regenerated. Click Show to copy it.', 'success');
                }
            });
        },

        toggleKeyVisibility: function () {
            const input = $('#current-api-key');
            const btn = $('#iab-toggle-key');
            const isHidden = input.data('hidden') !== false;
            if (isHidden) {
                input.val(input.data('key'));
                input.data('hidden', false);
                btn.text('Hide');
            } else {
                input.val('••••••••••••••••••••••••••••••••');
                input.data('hidden', true);
                btn.text('Show');
            }
        },

        syncCertificates: function () {
            const btn = $(this);
            btn.prop('disabled', true).text('Syncing...');

            $.post(iabData.ajaxUrl, {
                action: 'iab_sync_certificates',
                nonce: iabData.nonce,
            }, function (response) {
                btn.prop('disabled', false).text('Sync Now');
                if (response.success) {
                    IAB.showNotice(`Synced ${response.data.synced} certificates`, 'success');
                    IAB.loadStats();
                } else {
                    IAB.showNotice('Sync failed: ' + (response.data.errors?.join(', ') || 'Unknown error'), 'error');
                }
            });
        },

        applyFilters: function () {
            const tab = $('.iab-tab.active').data('tab');

            if (tab === 'activity') {
                IAB.loadActivity(1);
            } else if (tab === 'inspectors') {
                IAB.loadInspectors(1);
            }
        },

        changePage: function () {
            const page = $(this).data('page');
            const tab = $('.iab-tab.active').data('tab');

            if (tab === 'activity') {
                IAB.loadActivity(page);
            } else if (tab === 'inspectors') {
                IAB.loadInspectors(page);
            }
        },

        blockIP: function () {
            const ip = $(this).data('ip');
            const reason = prompt('Enter reason for blocking:');

            if (!reason) return;

            $.post(iabData.ajaxUrl, {
                action: 'iab_toggle_ip_block',
                nonce: iabData.nonce,
                ip: ip,
                action_type: 'block',
                reason: reason,
            }, function (response) {
                if (response.success) {
                    IAB.showNotice(`IP ${ip} blocked`, 'success');
                    IAB.loadActivity();
                }
            });
        },

        unblockIP: function () {
            const ip = $(this).data('ip');

            $.post(iabData.ajaxUrl, {
                action: 'iab_toggle_ip_block',
                nonce: iabData.nonce,
                ip: ip,
                action_type: 'unblock',
            }, function (response) {
                if (response.success) {
                    IAB.showNotice(`IP ${ip} unblocked`, 'success');
                }
            });
        },

        updatePagination: function (type, pagination) {
            const container = $(`#${type}-pagination`);
            container.empty();

            if (pagination.total_pages <= 1) return;

            container.append(`
                <button class="iab-page-btn" data-page="${pagination.page - 1}" ${pagination.page === 1 ? 'disabled' : ''}>
                    Previous
                </button>
                <span>Page ${pagination.page} of ${pagination.total_pages}</span>
                <button class="iab-page-btn" data-page="${pagination.page + 1}" ${pagination.page === pagination.total_pages ? 'disabled' : ''}>
                    Next
                </button>
            `);
        },

        formatDate: function (dateStr) {
            if (!dateStr) return '-';
            const date = new Date(dateStr);
            return date.toLocaleDateString('en-GB', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
            });
        },

        showNotice: function (message, type) {
            const notice = $(`<div class="notice notice-${type} is-dismissible"><p>${message}</p></div>`);
            $('.iab-header').after(notice);

            setTimeout(function () {
                notice.fadeOut(function () {
                    $(this).remove();
                });
            }, 3000);
        },
    };

    $(document).ready(function () {
        IAB.init();
    });

})(jQuery);
