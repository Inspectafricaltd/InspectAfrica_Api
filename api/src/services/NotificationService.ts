import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { notificationLogs } from '../db/schema.js';
import { getResendClient, RESEND_FROM_EMAIL } from '../lib/resend.js';
import { logger } from '../lib/logger.js';

export type NotificationType =
  | 'welcome_client'
  | 'welcome_inspector'
  | 'booking_received'
  | 'booking_accepted'
  | 'booking_declined'
  | 'inspection_started'
  | 'report_ready'
  | 'report_approved'
  | 'report_flagged'
  | 'report_revised'
  | 'report_generation_failed'
  | 'cert_expiry_30'
  | 'cert_expiry_7'
  | 'account_suspended'
  | 'sync_failure'
  | 'admin_booking_stale'
  | 'booking_cancelled'
  | 'payout_paid'
  | 'inspector_registered'
  | 'inspection_submitted'
  | 'payment_receipt_uploaded'
  | 'token_purchase_requested'
  | 'token_purchase_approved'
  | 'token_purchase_rejected'
  | 'token_granted'
  | 'password_reset';

export interface NotificationPayload {
  recipientId: string;
  recipientEmail: string;
  data: Record<string, unknown>;
  entityType?: string;
  entityId?: string;
}

interface EmailTemplate {
  subject: string;
  html: string;
}

const SUBJECTS: Record<NotificationType, string> = {
  welcome_client: 'Welcome to InspectAfrica',
  welcome_inspector: 'Welcome to InspectAfrica — Inspector Account Ready',
  booking_received: 'New inspection booking request',
  booking_accepted: 'Your inspection has been confirmed',
  booking_declined: 'Inspection booking update',
  inspection_started: 'Your property inspection has started',
  report_ready: 'Your InspectAfrica inspection report is ready',
  report_approved: 'Your inspection report has been approved',
  report_flagged: 'Action required: Inspection report flagged',
  report_revised: 'Your inspection report has been updated',
  report_generation_failed: 'Action required: report generation failed',
  cert_expiry_30: 'ACHI certification expiry notice',
  cert_expiry_7: 'ACHI certification expiry notice - URGENT',
  account_suspended: 'Your InspectAfrica account has been suspended',
  sync_failure: 'Action required: Photo upload failed',
  admin_booking_stale: 'Alert: Booking waiting for inspector assignment',
  booking_cancelled: 'A booking was cancelled',
  payout_paid: 'Your payout has been sent',
  inspector_registered: 'New inspector registered — certification review needed',
  inspection_submitted: 'Inspection submitted for review',
  payment_receipt_uploaded: 'Payment receipt uploaded — review pending',
  token_purchase_requested: 'New token purchase request',
  token_purchase_approved: 'Your token purchase has been approved',
  token_purchase_rejected: 'Token purchase request update',
  token_granted: 'Tokens added to your account',
  password_reset: 'Reset your InspectAfrica password',
};

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escape untrusted string for HTML text / attribute context.
 * All user-controlled fields (names, addresses, reasons, etc.) MUST pass through this
 * before interpolation into email HTML to prevent stored-XSS in recipient mail clients.
 */
function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPE_MAP[c]!);
}

/**
 * Validate + escape a URL for use in an href. Rejects javascript:/data:/vbscript: schemes
 * and anything that fails URL parsing. Returns '#' on rejection so the link is inert.
 */
function safeUrl(value: unknown, fallback: string = '#'): string {
  if (value === null || value === undefined) return escapeHtml(fallback);
  const str = String(value).trim();
  if (!str) return escapeHtml(fallback);
  try {
    const parsed = new URL(str);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'mailto:') {
      return escapeHtml(fallback);
    }
    return escapeHtml(parsed.toString());
  } catch {
    return escapeHtml(fallback);
  }
}

const APP_URL = process.env.APP_URL && /^https?:\/\//.test(process.env.APP_URL)
  ? process.env.APP_URL
  : 'https://inspectafrica.org';

/**
 * Build email HTML content based on notification type.
 * All interpolations of untrusted `data.*` fields are HTML-escaped (text) or URL-validated (href).
 */
function buildEmailContent(type: NotificationType, data: Record<string, unknown>): EmailTemplate {
  const subject = SUBJECTS[type];

  const brandStyles = `
    <style>
      body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #333; line-height: 1.6; }
      .container { max-width: 600px; margin: 0 auto; padding: 20px; }
      .header { background: #1B4332; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
      .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
      .button { display: inline-block; padding: 12px 30px; background: #1B4332; color: white; text-decoration: none; border-radius: 6px; margin-top: 15px; }
      .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
    </style>
  `;

  const footer = `
    <div class="footer">
      <p>InspectAfrica Standard™ | inspectafrica.org</p>
      <p>This is an automated message. Please do not reply to this email.</p>
    </div>
  `;

  let html = '';

  switch (type) {
    case 'welcome_client':
      html = `
        ${brandStyles}
        <div class="container">
          <div class="header">
            <h1>InspectAfrica Standard™</h1>
          </div>
          <div class="content">
            <h2>Welcome, ${escapeHtml(data.fullName) || 'there'}!</h2>
            <p>Your InspectAfrica client account has been created. You can now book certified property inspections across Nigeria.</p>
            <p>Here's what you can do:</p>
            <ul>
              <li>Book a property inspection before you buy, rent, or invest</li>
              <li>Track your inspection in real-time</li>
              <li>Download your certified report instantly</li>
            </ul>
            <a href="${safeUrl(`${APP_URL}/client`, `${APP_URL}/client`)}" class="button">Go to Dashboard</a>
          </div>
          ${footer}
        </div>
      `;
      break;

    case 'welcome_inspector':
      html = `
        ${brandStyles}
        <div class="container">
          <div class="header">
            <h1>InspectAfrica Standard™</h1>
          </div>
          <div class="content">
            <h2>Welcome, ${escapeHtml(data.fullName) || 'Inspector'}!</h2>
            <p>Your InspectAfrica inspector account is ready. You can now accept bookings, conduct inspections, and submit reports through the platform.</p>
            ${data.achiNumber
              ? `<p><strong>ACHI Number on file:</strong> ${escapeHtml(data.achiNumber)}</p>`
              : `<p>You registered without an ACHI number. You can add your ACHI certification number in your profile at any time.</p>`
            }
            <p><strong>Next steps:</strong></p>
            <ul>
              <li>Complete your profile (bio, service areas, inspection types)</li>
              <li>Check the open booking pool for available jobs</li>
              ${!data.achiNumber ? '<li>Add your ACHI number once you have it to unlock certified status</li>' : ''}
            </ul>
            <a href="${safeUrl(`${APP_URL}/inspector`, `${APP_URL}/inspector`)}" class="button">Go to Dashboard</a>
          </div>
          ${footer}
        </div>
      `;
      break;

    case 'booking_received':
      html = `
        ${brandStyles}
        <div class="container">
          <div class="header">
            <h1>InspectAfrica Standard™</h1>
          </div>
          <div class="content">
            <h2>New Booking Request</h2>
            <p>Hello ${escapeHtml(data.inspectorName) || 'Inspector'},</p>
            <p>You have received a new inspection booking request from ${escapeHtml(data.clientName) || 'a client'}.</p>
            <p><strong>Property Address:</strong> ${escapeHtml(data.propertyAddress) || 'N/A'}</p>
            <p><strong>Property Type:</strong> ${escapeHtml(data.propertyType) || 'N/A'}</p>
            <p><strong>Requested Date:</strong> ${escapeHtml(data.requestedDate) || 'N/A'}</p>
            <p>Please log in to your dashboard to accept or decline this booking.</p>
            <a href="${safeUrl(`${APP_URL}/inspector/bookings/${encodeURIComponent(String(data.bookingId ?? ''))}`, `${APP_URL}/inspector/bookings`)}" class="button">View Booking</a>
          </div>
          ${footer}
        </div>
      `;
      break;

    case 'booking_accepted':
      html = `
        ${brandStyles}
        <div class="container">
          <div class="header">
            <h1>InspectAfrica Standard™</h1>
          </div>
          <div class="content">
            <h2>Booking Confirmed</h2>
            <p>Hello ${escapeHtml(data.clientName) || 'Client'},</p>
            <p>Your inspection booking has been confirmed by ${escapeHtml(data.inspectorName) || 'the inspector'}.</p>
            <p><strong>Property Address:</strong> ${escapeHtml(data.propertyAddress) || 'N/A'}</p>
            <p><strong>Inspection Date:</strong> ${escapeHtml(data.inspectedDate ?? data.requestedDate) || 'N/A'}</p>
            <p>The inspector will contact you shortly with further details.</p>
          </div>
          ${footer}
        </div>
      `;
      break;

    case 'booking_declined':
      html = `
        ${brandStyles}
        <div class="container">
          <div class="header">
            <h1>InspectAfrica Standard™</h1>
          </div>
          <div class="content">
            <h2>Booking Update</h2>
            <p>Hello ${escapeHtml(data.clientName) || 'Client'},</p>
            <p>Unfortunately, your inspection booking for <strong>${escapeHtml(data.propertyAddress) || 'your property'}</strong> could not be accommodated.</p>
            ${data.reason ? `<p><strong>Reason:</strong> ${escapeHtml(data.reason)}</p>` : ''}
            <p>Please log in to book with another certified inspector.</p>
            <a href="${safeUrl(`${APP_URL}/book`, `${APP_URL}/book`)}" class="button">Find Another Inspector</a>
          </div>
          ${footer}
        </div>
      `;
      break;

    case 'inspection_started':
      html = `
        ${brandStyles}
        <div class="container">
          <div class="header">
            <h1>InspectAfrica Standard™</h1>
          </div>
          <div class="content">
            <h2>Inspection In Progress</h2>
            <p>Hello ${escapeHtml(data.clientName) || 'Client'},</p>
            <p>Your property inspection at <strong>${escapeHtml(data.propertyAddress) || 'your property'}</strong> has started.</p>
            <p>Inspector <strong>${escapeHtml(data.inspectorName) || 'The inspector'}</strong> is now conducting the inspection.</p>
            <p>You will receive your report once the inspection is complete and approved.</p>
          </div>
          ${footer}
        </div>
      `;
      break;

    case 'report_ready': {
      html = `
        ${brandStyles}
        <div class="container">
          <div class="header">
            <h1>InspectAfrica Standard™</h1>
          </div>
          <div class="content">
            <h2>Your Inspection Report is Ready</h2>
            <p>Hello ${escapeHtml(data.clientName) || 'Client'},</p>
            <p>The inspection report for <strong>${escapeHtml(data.propertyAddress) || 'your property'}</strong> is now ready.</p>
            <p>Click below to view your complete inspection report:</p>
            <a href="${safeUrl(data.reportAccessUrl)}" class="button">View Report</a>
            ${data.expiresAt ? `<p style="margin-top:15px;color:#666;font-size:12px;">This link expires on ${escapeHtml(data.expiresAt)}</p>` : ''}
          </div>
          ${footer}
        </div>
      `;
      break;
    }

    case 'report_approved': {
      html = `
        ${brandStyles}
        <div class="container">
          <div class="header">
            <h1>InspectAfrica Standard™</h1>
          </div>
          <div class="content">
            <h2>Report Approved</h2>
            <p>Hello ${escapeHtml(data.clientName) || 'Client'},</p>
            <p>Your inspection report for <strong>${escapeHtml(data.propertyAddress) || 'your property'}</strong> has been approved by InspectAfrica.</p>
            ${data.reportAccessUrl ? `<a href="${safeUrl(data.reportAccessUrl)}" class="button">View Report</a>` : '<p>You will receive a separate email with your report link shortly.</p>'}
          </div>
          ${footer}
        </div>
      `;
      break;
    }

    case 'report_generation_failed':
      html = `
        ${brandStyles}
        <div class="container">
          <div class="header">
            <h1>InspectAfrica Standard™</h1>
          </div>
          <div class="content">
            <h2>Report Generation Failed</h2>
            <p>Hello ${escapeHtml(data.adminName) || 'Admin'},</p>
            <p>The report for the approved inspection at <strong>${escapeHtml(data.propertyAddress) || 'N/A'}</strong> could not be generated after ${escapeHtml(data.attempts) || 'multiple'} attempt(s).</p>
            <p><strong>Error:</strong> ${escapeHtml(data.errorMessage) || 'Unknown error'}</p>
            <p>The client has <strong>not</strong> been notified — no "report ready" email is sent until generation succeeds. Please retry generation from the inspection page.</p>
            <a href="${safeUrl(`${APP_URL}/admin/inspections/${encodeURIComponent(String(data.inspectionId ?? ''))}`, `${APP_URL}/admin/inspections`)}" class="button">Open Inspection</a>
          </div>
          ${footer}
        </div>
      `;
      break;

    case 'report_flagged':
      html = `
        ${brandStyles}
        <div class="container">
          <div class="header">
            <h1>InspectAfrica Standard™</h1>
          </div>
          <div class="content">
            <h2>Action Required: Report Flagged</h2>
            <p>Hello ${escapeHtml(data.inspectorName) || 'Inspector'},</p>
            <p>Your inspection report for <strong>${escapeHtml(data.propertyAddress) || 'a property'}</strong> has been flagged for review.</p>
            <p><strong>Reason:</strong> ${escapeHtml(data.flagReason) || 'Additional review required'}</p>
            <p>Please log in to review and address the flagged items.</p>
            <a href="${safeUrl(`${APP_URL}/inspector/bookings/${encodeURIComponent(String(data.bookingId ?? ''))}`, `${APP_URL}/inspector/bookings`)}" class="button">View Details</a>
          </div>
          ${footer}
        </div>
      `;
      break;

    case 'report_revised':
      html = `
        ${brandStyles}
        <div class="container">
          <div class="header">
            <h1>InspectAfrica Standard™</h1>
          </div>
          <div class="content">
            <h2>Report Updated</h2>
            <p>Hello ${escapeHtml(data.clientName) || 'Client'},</p>
            <p>Your inspection report for <strong>${escapeHtml(data.propertyAddress) || 'your property'}</strong> has been updated.</p>
            ${data.changesSummary ? `<p><strong>Changes:</strong> ${escapeHtml(data.changesSummary)}</p>` : ''}
            <a href="${safeUrl(data.reportAccessUrl)}" class="button">View Updated Report</a>
          </div>
          ${footer}
        </div>
      `;
      break;

    case 'cert_expiry_30':
    case 'cert_expiry_7':
      html = `
        ${brandStyles}
        <div class="container">
          <div class="header">
            <h1>InspectAfrica Standard™</h1>
          </div>
          <div class="content">
            <h2>ACHI Certification Expiry Notice</h2>
            <p>Hello ${escapeHtml(data.recipientName) || 'Inspector'},</p>
            <p>Your ACHI certification <strong>${escapeHtml(data.achiNumber)}</strong> will expire on <strong>${escapeHtml(data.expiresAt) || 'soon'}</strong>.</p>
            ${type === 'cert_expiry_7' ? '<p style="color:#C0392B;font-weight:bold;">This is an urgent notice - your certification expires in 7 days or less!</p>' : '<p>This is a 30-day advance notice.</p>'}
            <p>Please renew your certification to maintain your active status on the platform.</p>
            ${data.renewUrl ? `<a href="${safeUrl(data.renewUrl)}" class="button">Renew Certification</a>` : ''}
          </div>
          ${footer}
        </div>
      `;
      break;

    case 'account_suspended': {
      const contactEmail = String(data.contactEmail ?? 'support@inspectafrica.org');
      const contactHref = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)
        ? `mailto:${contactEmail}`
        : 'mailto:support@inspectafrica.org';
      html = `
        ${brandStyles}
        <div class="container">
          <div class="header">
            <h1>InspectAfrica Standard™</h1>
          </div>
          <div class="content">
            <h2>Account Suspended</h2>
            <p>Hello ${escapeHtml(data.inspectorName) || 'Inspector'},</p>
            <p>Your InspectAfrica inspector account has been suspended.</p>
            ${data.reason ? `<p><strong>Reason:</strong> ${escapeHtml(data.reason)}</p>` : ''}
            <p>If you believe this is an error or wish to appeal, please contact us.</p>
            <p>Contact: <a href="${safeUrl(contactHref, 'mailto:support@inspectafrica.org')}">${escapeHtml(contactEmail)}</a></p>
          </div>
          ${footer}
        </div>
      `;
      break;
    }

    case 'sync_failure':
      html = `
        ${brandStyles}
        <div class="container">
          <div class="header">
            <h1>InspectAfrica Standard™</h1>
          </div>
          <div class="content">
            <h2>Photo Upload Failed</h2>
            <p>Hello ${escapeHtml(data.inspectorName) || 'Inspector'},</p>
            <p>Some photos for your inspection at <strong>${escapeHtml(data.inspectionAddress) || 'a property'}</strong> failed to upload.</p>
            <p><strong>Failed Photos:</strong> ${escapeHtml(data.failedPhotoCount) || 'Some'} photo(s)</p>
            <p>Please open the app and retry the upload to complete your inspection report.</p>
          </div>
          ${footer}
        </div>
      `;
      break;

    case 'admin_booking_stale':
      html = `
        ${brandStyles}
        <div class="container">
          <div class="header">
            <h1>InspectAfrica Standard™</h1>
          </div>
          <div class="content">
            <h2>Booking Waiting for Inspector</h2>
            <p>Hello ${escapeHtml(data.adminName) || 'Admin'},</p>
            <p>Booking <strong>${escapeHtml(data.bookingId) || 'N/A'}</strong> has been waiting <strong>${escapeHtml(data.waitingHours) || '48+'} hours</strong> with no inspector assigned.</p>
            <p><strong>Property:</strong> ${escapeHtml(data.propertyAddress) || 'N/A'}</p>
            <p>Please review this booking and consider manual assignment or outreach to available inspectors.</p>
            <a href="${safeUrl(`${APP_URL}/admin/bookings`, `${APP_URL}/admin/bookings`)}" class="button">View Open Bookings</a>
          </div>
          ${footer}
        </div>
      `;
      break;

    case 'booking_cancelled':
      html = `
        ${brandStyles}
        <div class="container">
          <div class="header">
            <h1>InspectAfrica Standard™</h1>
          </div>
          <div class="content">
            <h2>Booking Cancelled</h2>
            <p>Hello ${escapeHtml(data.adminName) || 'Admin'},</p>
            <p>A client cancelled their open booking before an inspector was assigned.</p>
            <p><strong>Property:</strong> ${escapeHtml(data.propertyAddress) || 'N/A'}</p>
            <p><strong>Client:</strong> ${escapeHtml(data.clientName) || 'N/A'}</p>
            <a href="${safeUrl(`${APP_URL}/admin/bookings`, `${APP_URL}/admin/bookings`)}" class="button">View Bookings</a>
          </div>
          ${footer}
        </div>
      `;
      break;

    case 'payout_paid':
      html = `
        ${brandStyles}
        <div class="container">
          <div class="header">
            <h1>InspectAfrica Standard™</h1>
          </div>
          <div class="content">
            <h2>Payout Sent</h2>
            <p>Hello ${escapeHtml(data.inspectorName) || 'there'},</p>
            <p>Your payout${data.amount ? ` of <strong>₦${escapeHtml(Number(data.amount).toLocaleString())}</strong>` : ''} has been marked as paid.</p>
            ${data.notes ? `<p><strong>Notes:</strong> ${escapeHtml(data.notes)}</p>` : ''}
            <a href="${safeUrl(`${APP_URL}/inspector/profile`, `${APP_URL}/inspector/profile`)}" class="button">View Payout Details</a>
          </div>
          ${footer}
        </div>
      `;
      break;

    case 'inspector_registered':
      html = `
        ${brandStyles}
        <div class="container">
          <div class="header">
            <h1>InspectAfrica Standard™</h1>
          </div>
          <div class="content">
            <h2>New Inspector Registered</h2>
            <p>Hello ${escapeHtml(data.adminName) || 'Admin'},</p>
            <p><strong>${escapeHtml(data.inspectorName) || 'A new inspector'}</strong> (${escapeHtml(data.inspectorEmail) || 'no email'}) just registered and needs certification review.</p>
            <a href="${safeUrl(`${APP_URL}/admin/inspectors`, `${APP_URL}/admin/inspectors`)}" class="button">Review Inspectors</a>
          </div>
          ${footer}
        </div>
      `;
      break;

    case 'inspection_submitted':
      html = `
        ${brandStyles}
        <div class="container">
          <div class="header">
            <h1>InspectAfrica Standard™</h1>
          </div>
          <div class="content">
            <h2>${data.isResubmission ? 'Inspection Resubmitted' : 'Inspection Submitted'}</h2>
            <p>Hello ${escapeHtml(data.adminName) || 'Admin'},</p>
            <p>${escapeHtml(data.inspectorName) || 'An inspector'} ${data.isResubmission ? 'resubmitted a flagged inspection after making the requested changes' : 'submitted an inspection'} for review.</p>
            <p><strong>Property:</strong> ${escapeHtml(data.propertyAddress) || 'N/A'}</p>
            <a href="${safeUrl(`${APP_URL}/admin/inspections/${encodeURIComponent(String(data.inspectionId ?? ''))}`, `${APP_URL}/admin/inspections`)}" class="button">Review Inspection</a>
          </div>
          ${footer}
        </div>
      `;
      break;

    case 'payment_receipt_uploaded':
      html = `
        ${brandStyles}
        <div class="container">
          <div class="header">
            <h1>InspectAfrica Standard™</h1>
          </div>
          <div class="content">
            <h2>Payment Receipt Uploaded</h2>
            <p>Hello ${escapeHtml(data.adminName) || 'Admin'},</p>
            <p>A client uploaded a payment receipt for review.</p>
            <p><strong>Property:</strong> ${escapeHtml(data.propertyAddress) || 'N/A'}</p>
            <a href="${safeUrl(`${APP_URL}/admin/bookings/${encodeURIComponent(String(data.bookingId ?? ''))}`, `${APP_URL}/admin/bookings`)}" class="button">Review Payment</a>
          </div>
          ${footer}
        </div>
      `;
      break;

    case 'password_reset':
      html = `
        ${brandStyles}
        <div class="container">
          <div class="header">
            <h1>InspectAfrica Standard™</h1>
          </div>
          <div class="content">
            <h2>Reset Your Password</h2>
            <p>Hello ${escapeHtml(data.fullName) || 'there'},</p>
            <p>We received a request to reset your password. Click the button below to set a new password. This link expires in 1 hour.</p>
            <a href="${safeUrl(data.resetUrl)}" class="button">Reset Password</a>
            <p style="margin-top: 20px; font-size: 14px; color: #666;">If you didn't request a password reset, you can safely ignore this email.</p>
          </div>
          ${footer}
        </div>
      `;
      break;

    case 'token_purchase_requested':
      html = `
        ${brandStyles}
        <div class="container">
          <div class="header">
            <h1>InspectAfrica Standard™</h1>
          </div>
          <div class="content">
            <h2>New Token Purchase Request</h2>
            <p>Hello ${escapeHtml(data.adminName) || 'Admin'},</p>
            <p><strong>${escapeHtml(data.inspectorName) || 'An inspector'}</strong> (${escapeHtml(data.inspectorEmail) || ''}) has submitted a token purchase request.</p>
            <p><strong>Quantity:</strong> ${escapeHtml(data.quantity)} token(s)</p>
            <p><strong>Amount:</strong> ₦${escapeHtml(data.amountNgn)}</p>
            <p>Please review the proof of payment and approve or reject this request.</p>
            <a href="${safeUrl(`${APP_URL}/admin/token-purchases`, `${APP_URL}/admin/token-purchases`)}" class="button">Review Request</a>
          </div>
          ${footer}
        </div>
      `;
      break;

    case 'token_purchase_approved':
      html = `
        ${brandStyles}
        <div class="container">
          <div class="header">
            <h1>InspectAfrica Standard™</h1>
          </div>
          <div class="content">
            <h2>Tokens Credited 🪙</h2>
            <p>Hello ${escapeHtml(data.inspectorName) || 'Inspector'},</p>
            <p>Your token purchase request has been <strong>approved</strong>.</p>
            <p><strong>Tokens credited:</strong> ${escapeHtml(data.quantity)} token(s)</p>
            <p>You can now use these tokens to conduct inspections on the platform.</p>
            <a href="${safeUrl(`${APP_URL}/inspector`, `${APP_URL}/inspector`)}" class="button">Go to Dashboard</a>
          </div>
          ${footer}
        </div>
      `;
      break;

    case 'token_purchase_rejected':
      html = `
        ${brandStyles}
        <div class="container">
          <div class="header">
            <h1>InspectAfrica Standard™</h1>
          </div>
          <div class="content">
            <h2>Token Purchase Update</h2>
            <p>Hello ${escapeHtml(data.inspectorName) || 'Inspector'},</p>
            <p>Your token purchase request for <strong>${escapeHtml(data.quantity)} token(s)</strong> (₦${escapeHtml(data.amountNgn)}) has been <strong>declined</strong>.</p>
            ${data.reason ? `<p><strong>Reason:</strong> ${escapeHtml(data.reason)}</p>` : ''}
            <p>If you believe this is an error, please contact support or submit a new request with updated proof of payment.</p>
            <a href="${safeUrl(`${APP_URL}/inspector`, `${APP_URL}/inspector`)}" class="button">Go to Dashboard</a>
          </div>
          ${footer}
        </div>
      `;
      break;

    case 'token_granted':
      html = `
        ${brandStyles}
        <div class="container">
          <div class="header">
            <h1>InspectAfrica Standard™</h1>
          </div>
          <div class="content">
            <h2>Tokens Added to Your Account 🪙</h2>
            <p>Hello ${escapeHtml(data.inspectorName) || 'Inspector'},</p>
            <p><strong>${escapeHtml(data.quantity)} token(s)</strong> have been added to your account by the InspectAfrica admin team.</p>
            ${data.note ? `<p><strong>Note:</strong> ${escapeHtml(data.note)}</p>` : ''}
            <p>You can now use these tokens to conduct inspections on the platform.</p>
            <a href="${safeUrl(`${APP_URL}/inspector`, `${APP_URL}/inspector`)}" class="button">Go to Dashboard</a>
          </div>
          ${footer}
        </div>
      `;
      break;

    default:
      html = `
        ${brandStyles}
        <div class="container">
          <div class="header">
            <h1>InspectAfrica Standard™</h1>
          </div>
          <div class="content">
            <p>You have a new notification from InspectAfrica.</p>
          </div>
          ${footer}
        </div>
      `;
  }

  return { subject, html };
}

export class NotificationService {
  /**
   * Send a notification email
   * Fire-and-forget: logs errors but does NOT throw
   */
  static async send(type: NotificationType, payload: NotificationPayload): Promise<void> {
    let status: 'sent' | 'failed' = 'sent';
    let resendId: string | null = null;
    let errorMessage: string | null = null;

    try {
      // Build email content
      const { subject, html } = buildEmailContent(type, payload.data);

      // Send via Resend
      const resend = getResendClient();
      const { data, error } = await resend.emails.send({
        from: RESEND_FROM_EMAIL,
        to: payload.recipientEmail,
        subject,
        html,
      });

      if (error) {
        throw error;
      }

      resendId = data?.id || null;
    } catch (err: any) {
      status = 'failed';
      errorMessage = err?.message || 'Unknown error';
      logger.error({ err, type, recipientId: payload.recipientId }, 'NotificationService.send failed');
    }

    // Log to notification_logs
    try {
      await db.insert(notificationLogs).values({
        type,
        recipientId:    payload.recipientId,
        recipientEmail: payload.recipientEmail,
        entityType:     payload.entityType || null,
        entityId:       payload.entityId || null,
        sentAt:         new Date(),
        status,
        resendId,
        error:          errorMessage,
      });
    } catch (logErr) {
      logger.error({ err: logErr, type }, 'NotificationService: failed to log notification');
    }
  }

  /**
   * Get notification log history
   */
  static async getLogHistory(filters: {
    type?: NotificationType;
    recipientId?: string;
    status?: 'sent' | 'failed';
    page?: number;
    limit?: number;
  }): Promise<{ logs: any[]; total: number }> {
    const page = filters.page || 1;
    const limit = filters.limit || 25;
    const offset = (page - 1) * limit;

    const conds = [];
    if (filters.type)        conds.push(eq(notificationLogs.type, filters.type));
    if (filters.recipientId) conds.push(eq(notificationLogs.recipientId, filters.recipientId));
    if (filters.status)      conds.push(eq(notificationLogs.status, filters.status));
    const whereExpr = conds.length > 0 ? and(...conds) : undefined;

    try {
      const [data, totalRow] = await Promise.all([
        db
          .select()
          .from(notificationLogs)
          .where(whereExpr)
          .orderBy(desc(notificationLogs.sentAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(notificationLogs)
          .where(whereExpr),
      ]);
      return { logs: data, total: totalRow[0]?.count ?? 0 };
    } catch (err) {
      logger.error({ err }, 'NotificationService.getLogHistory failed');
      return { logs: [], total: 0 };
    }
  }
}
