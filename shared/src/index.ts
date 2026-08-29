/**
 * @inspect-africa/shared
 * Shared TypeScript types for frontend and backend
 */

// ============================================
// User Types
// ============================================

export type UserRole = 'client' | 'inspector' | 'admin';

export interface User {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  avatarUrl: string | null;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export interface ClientProfile {
  userId: string;
  countryOfResidence: string | null;
  diasporaFlag: string | null;
  createdAt: string;
}

export interface InspectorProfile {
  id: string;
  userId: string;
  achiNumber: string | null;
  achiStatus: 'candidate' | 'certified' | 'expired' | 'suspended';
  achiIssuedAt: string | null;
  achiExpiresAt: string | null;
  bio: string | null;
  serviceAreas: string[];
  inspectionTypes: string[];
  rating: number | null;
  totalInspections: number;
  isActive: boolean;
  bankName: string | null;
  accountNumber: string | null;
  accountName: string | null;
  createdAt: string;
}

// ============================================
// Booking Types
// ============================================

export type BookingStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'in_progress' | 'completed' | 'disputed';

export type PropertyType = 'residential' | 'commercial' | 'land';

export type InspectionType = 'shi' | 'mic' | 'cib' | 'fsi' | 'pcc' | 'hhc' | 'snag';

export interface Booking {
  id: string;
  clientId: string;
  inspectorId: string | null;
  propertyAddress: string;
  propertyCity: string;
  propertyType: PropertyType;
  inspectionType: InspectionType;
  requestedDate: string;
  requestedTime: string | null;
  notesToInspector: string | null;
  status: BookingStatus;
  declinedReason: string | null;
  acceptedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  client?: User;
  inspector?: User;
}

// ============================================
// Inspection Types
// ============================================

export type InspectionStatus = 
  | 'draft' 
  | 'in_progress' 
  | 'pending_review' 
  | 'approved' 
  | 'flagged' 
  | 'revised';

export type ConditionSeverity = 'acceptable' | 'monitor' | 'repair_required' | 'unsafe' | null;

export interface Inspection {
  id: string;
  bookingId: string;
  inspectorId: string;
  status: InspectionStatus;
  startedAt: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  flaggedAt: string | null;
  flaggedBy: string | null;
  flagReason: string | null;
  createdAt: string;
  updatedAt: string;
  sections?: InspectionSection[];
}

export interface InspectionSection {
  id: string;
  inspectionId: string;
  name: string;
  displayOrder: number;
  status: 'pending' | 'pass' | 'observations';
  completedAt: string | null;
  conditions?: InspectionCondition[];
}

export interface InspectionCondition {
  id: string;
  sectionId: string;
  inspectionId: string;
  name: string;
  displayOrder: number;
  severity: ConditionSeverity;
  isComplete: boolean;
  photoCount: number;
  observationCount: number;
}

// ============================================
// Observation Types
// ============================================

export interface Observation {
  id: string;
  conditionId: string;
  inspectionId: string;
  text: string;
  addedBy: string;
  addedByRole: 'inspector' | 'admin';
  editedAt: string | null;
  editedBy: string | null;
  isDeleted: boolean;
  createdAt: string;
}

// ============================================
// Photo Types
// ============================================

export type UploadStatus = 'pending' | 'uploading' | 'done' | 'failed';

export interface InspectionPhoto {
  id: string;
  inspectionId: string;
  conditionId: string;
  storagePath: string | null;
  thumbPath: string | null;
  uploadStatus: UploadStatus;
  localId: string | null;
  mimeType: string;
  fileSizeBytes: number | null;
  width: number | null;
  height: number | null;
  takenAt: string | null;
  takenBy: string | null;
  createdAt: string;
}

// ============================================
// Report Types
// ============================================

export interface InspectionReport {
  id: string;
  inspectionId: string;
  version: number;
  certificateNumber: string | null;
  generatedAt: string;
  generatedBy: string;
  storagePath: string | null;
  fileSizeBytes: number | null;
  changesSummary: string | null;
  isLatest: boolean;
  createdAt: string;
}

export interface ReportAccessToken {
  id: string;
  inspectionId: string;
  token: string;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  accessedAt: string | null;
}

// ============================================
// Notification Types
// ============================================

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
  | 'admin_booking_stale'
  | 'sync_failure'
  | 'password_reset'
  | 'token_purchase_requested'
  | 'token_purchase_approved'
  | 'token_purchase_rejected'
  | 'token_granted';

export interface NotificationLog {
  id: string;
  type: NotificationType;
  recipientId: string;
  recipientEmail: string;
  sentAt: string;
  status: 'sent' | 'failed';
  resendId: string | null;
  errorMessage: string | null;
  responseTimeMs: number | null;
}

// ============================================
// Revision Event Types
// ============================================

export type EntityType = 'inspection' | 'condition' | 'observation' | 'photo' | 'annotation' | 'report';
export type RevisionAction = 'created' | 'updated' | 'deleted';

export interface RevisionEvent {
  id: string;
  inspectionId: string;
  entityType: EntityType;
  entityId: string;
  action: RevisionAction;
  field: string | null;
  previousValue: unknown;
  newValue: unknown;
  changedBy: string;
  changedAt: string;
  reason: string | null;
}

// ============================================
// API Response Types
// ============================================

export interface ApiResponse<T> {
  data: T;
  error: null;
}

export interface ApiError {
  code: string;
  message: string;
}

export interface ApiErrorResponse {
  data: null;
  error: ApiError;
}

export type ApiResult<T> = ApiResponse<T> | ApiErrorResponse;

// ============================================
// Pagination Types
// ============================================

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
}

// ============================================
// Dashboard Types
// ============================================

export interface DashboardStats {
  totalInspectors: number;
  activeInspectors: number;
  certifiedInspectors: number;
  totalClients: number;
  totalBookings: number;
  pendingBookings: number;
  acceptedBookings: number;
  completedBookings: number;
  pendingReviewCount: number;
  openFlagsCount: number;
}

// ============================================
// Inspector Public Profile
// ============================================

export interface PublicInspectorProfile {
  id: string;
  userId: string;
  fullName: string;
  avatarUrl: string | null;
  achiNumber: string | null;
  achiStatus: string;
  bio: string | null;
  serviceAreas: string[];
  inspectionTypes: string[];
  rating: number | null;
  totalInspections: number;
  reviews?: InspectorReview[];
}

export interface InspectorReview {
  id: string;
  rating: number;
  comment: string | null;
  clientName: string;
  createdAt: string;
}

// ============================================
// Certificate Verification
// ============================================

export interface CertVerificationResult {
  valid: boolean;
  name?: string;
  issued?: string;
  expires?: string;
  status?: string;
}

// ============================================
// Template Section (for inspection template)
// ============================================

export interface InspectionTemplateSection {
  name: string;
  order: number;
  conditions: string[];
}
