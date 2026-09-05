// ---------------------------------------------------------------------------
// API client for the FleetLink backend (WhatsApp conversations).
// Set NEXT_PUBLIC_API_URL in frontend/.env.local if the backend is elsewhere.
// ---------------------------------------------------------------------------

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

export interface ApiConversationSummary {
  id: string;
  driver: string;
  phone: string;
  jobNumber: string;
  lastMessage: string;
  lastActivity: string | null;
  unread: number;
  verified: boolean;
  aiPaused: boolean;
}

export type ApiMessageKind = "DRIVER" | "MANAGER" | "BOT";

export interface ApiInterpretation {
  intent: string;
  confidence: number;
  status: "PENDING" | "COMPLETED" | "FAILED" | "REQUIRES_REVIEW";
  fields: { label: string; value: string }[];
}

export interface ApiChatAttachment {
  id: string;
  type: string;
  filename: string | null;
  mimeType: string | null;
  publicUrl: string | null;
  createdAt: string;
}

export interface ApiChatMessage {
  id: string;
  kind: ApiMessageKind;
  type?: string; 
  text: string;
  time: string; 
  deliveryStatus: "RECEIVED" | "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED";
  interpretation?: ApiInterpretation;
  attachments: ApiChatAttachment[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function fetchConversations(): Promise<ApiConversationSummary[]> {
  return request<ApiConversationSummary[]>("/api/conversations");
}

export function fetchConversationMessages(conversationId: string): Promise<ApiChatMessage[]> {
  return request<ApiChatMessage[]>(`/api/conversations/${conversationId}/messages`);
}

export function markConversationRead(conversationId: string): Promise<{ readAt: string }> {
  return request(`/api/conversations/${conversationId}/read`, { method: "POST" });
}

export function sendManagerMessage(conversationId: string, body: string): Promise<ApiChatMessage> {
  return request<ApiChatMessage>(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ body, source_type: "MANUAL_MANAGER_MESSAGE" }),
  });
}

export function clearConversation(conversationId: string): Promise<{ ok: boolean; deleted: number }> {
  return request(`/api/conversations/${conversationId}/messages`, { method: "DELETE" });
}

export function deleteConversation(conversationId: string): Promise<{ ok: boolean }> {
  return request(`/api/conversations/${conversationId}`, { method: "DELETE" });
}

{/*Drivers*/}

export interface ApiDriverSummary {
  id: string;
  name: string;
  phone: string;
  verified: boolean;
  status: "ACTIVE" | "INACTIVE" | "SUSPENDED";
  currentJob: string | null;
  completedTrips: number;
  vehicleType: string | null;
  licensePlate: string | null;
}

export interface ApiDriverPayload {
  name: string;
  phone: string;
  vehicleType: string;
  licensePlate: string;
  status?: "ACTIVE" | "INACTIVE" | "SUSPENDED";
}

export function fetchDrivers(): Promise<ApiDriverSummary[]> {
  return request<ApiDriverSummary[]>("/api/drivers");
}

export function createDriver(payload: ApiDriverPayload): Promise<ApiDriverSummary> {
  return request<ApiDriverSummary>("/api/drivers", { method: "POST", body: JSON.stringify(payload) });
}

export function updateDriver(
  id: string,
  payload: ApiDriverPayload & { status: "ACTIVE" | "INACTIVE" | "SUSPENDED" }
): Promise<ApiDriverSummary> {
  return request<ApiDriverSummary>(`/api/drivers/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export function updateDriverStatus(id: string, status: string): Promise<ApiDriverSummary> {
  return request<ApiDriverSummary>(`/api/drivers/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export function deleteDriver(id: string): Promise<{ ok: boolean; id: string; name: string }> {
  return request(`/api/drivers/${id}`, { method: "DELETE" });
}



{/*Job request queue (manager approvals)*/}

export interface ApiJobRequest {
  id: string;
  status: "REQUESTED" | "CANCELLED_BY_DRIVER" | "REJECTED" | "APPROVED" | "EXPIRED";
  requestedAt: string;
  reviewedAt: string | null;
  job: {
    id: string;
    jobNumber: string;
    cargo: string;
    pickup: string | null;
    delivery: string | null;
    quantity: string | null;
    pickupAt: string;
    status: string;
  };
  driver: {
    id: string;
    name: string;
    phone: string;
    verified: boolean;
  };
}

export function fetchJobRequests(status = "REQUESTED"): Promise<ApiJobRequest[]> {
  return request<ApiJobRequest[]>(`/api/job-requests?status=${encodeURIComponent(status)}`);
}

export function approveJobRequest(id: string): Promise<{ ok: boolean; jobNumber: string; driver: string }> {
  return request(`/api/job-requests/${id}/approve`, { method: "POST", body: JSON.stringify({}) });
}

export function rejectJobRequest(id: string, reason?: string): Promise<{ ok: boolean; jobNumber: string; driver: string }> {
  return request(`/api/job-requests/${id}/reject`, { method: "POST", body: JSON.stringify({ reason: reason ?? null }) });
}

// One combined, reverse-chronological feed of every decision a manager has
// made on a driver's ask - taking a job, cancelling one, or closing one out -
// each tagged with which of the three it was.
export interface ApiRequestHistoryEntry {
  id: string;
  type: "JOB_REQUEST" | "CANCELLATION" | "CLOSURE";
  decision: string;
  decidedAt: string;
  job: {
    id: string;
    jobNumber: string;
    cargo: string | null;
    pickup: string | null;
    delivery: string | null;
  };
  driver: {
    id: string | null;
    name: string;
    phone: string;
    verified: boolean;
  };
}

export function fetchRequestHistory(): Promise<ApiRequestHistoryEntry[]> {
  return request<ApiRequestHistoryEntry[]>(`/api/job-requests/history`);
}

{/*Jobs*/}

export interface ApiJobSummary {
  id: string;
  jobNumber: string;
  status: string;
  cargo: string;
  pickup: string | null;
  delivery: string | null;
  quantity: string | null;
  pickupAt: string;
  deliveryAt: string | null;
  pickupCode?: string | null; 
  deliveryCode?: string | null;
  driver: string | null;
  cancellationReason: string | null;
  assignmentStatus: string | null;
}

export interface ApiJobDetail {
  id: string;
  jobNumber: string;
  status: string;
  cargo: string;
  specialInstructions: string | null;
  pickupAt: string;
  deliveryAt: string | null;
  completedAt: string | null;
  pickupCode: string | null;
  deliveryCode: string | null;
  pickupVerifiedAt: string | null;
  deliveryVerifiedAt: string | null;
  pickupActualAt: string | null;
  deliveryActualAt: string | null;
  pickupDelayReason: string | null;
  deliveryDelayReason: string | null;
  stops: { type: string; name: string; address: string }[];
  items: { description: string; quantity: string | null; quantityValue: number | null; unit: string | null }[];
  assignment: {
    id: string;
    status: string;
    assignedAt: string;
    acceptedAt: string | null;
    startedAt: string | null;
    completionSubmittedAt: string | null;
    cancellationReason: string | null;
    driver: { id: string; name: string; phone: string };
  } | null;
}

export interface ApiTimelineEvent {
  id: string;
  type: string;
  status: "PROPOSED" | "CONFIRMED" | "APPLIED" | "REJECTED" | "REVIEW_REQUIRED";
  data: Record<string, unknown>;
  confidence: number | null;
  appliedAt: string | null;
  time: string;
  sourceMessage: string | null;
}

export function fetchJobs(params?: { status?: string; search?: string }): Promise<ApiJobSummary[]> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.search) qs.set("search", params.search);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return request<ApiJobSummary[]>(`/api/jobs${suffix}`);
}

export interface ApiJobIdentifiers {
  jobNumber: string;
  pickupCode: string;
  deliveryCode: string;
}

export function fetchJobIdentifiers(): Promise<ApiJobIdentifiers> {
  return request<ApiJobIdentifiers>("/api/jobs/next-identifiers");
}

export function createJob(payload: {
  jobNumber?: string;
  pickupLocation: string;
  deliveryLocation: string;
  pickupAt?: string;
  deliveryAt?: string;
  cargo: string;
  quantity?: string;
  unit?: string;
  instructions?: string;
  pickupCode?: string;
  deliveryCode?: string;
  status: "PUBLISHED" | "DRAFT";
}): Promise<ApiJobSummary> {
  return request<ApiJobSummary>("/api/jobs", { method: "POST", body: JSON.stringify(payload) });
}

export function fetchJob(id: string): Promise<ApiJobDetail> {
  return request<ApiJobDetail>(`/api/jobs/${id}`);
}

export function fetchJobTimeline(id: string): Promise<ApiTimelineEvent[]> {
  return request<ApiTimelineEvent[]>(`/api/jobs/${id}/timeline`);
}

export interface ApiLiveJob extends ApiJobSummary {
  driverPhone: string | null;
  lastEventType: string | null;
  lastEventAt: string | null;
  openIncidents: number;
}

export interface ApiJobActivityAttachment {
  id: string;
  type: string;
  filename: string | null;
  mimeType: string | null;
  publicUrl: string | null;
  createdAt: string;
}

export interface ApiJobActivityMessage {
  id: string;
  kind: ApiMessageKind;
  type?: string;
  text: string;
  time: string;
  deliveryStatus: ApiChatMessage["deliveryStatus"];
  interpretation?: ApiInterpretation;
  attachments: ApiJobActivityAttachment[];
}

export function fetchLiveJobs(): Promise<ApiLiveJob[]> {
  return request<ApiLiveJob[]>("/api/jobs/live");
}

export function fetchJobActivity(id: string): Promise<{ messages: ApiJobActivityMessage[] }> {
  return request<{ messages: ApiJobActivityMessage[] }>(`/api/jobs/${id}/activity`);
}

export function cancelJob(id: string, reason?: string): Promise<{ ok: boolean; status: string }> {
  return request(`/api/jobs/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason: reason ?? null }) });
}

export function updateJob(
  id: string,
  payload: {
    pickupLocation: string;
    deliveryLocation: string;
    pickupAt?: string;
    deliveryAt?: string;
    cargo: string;
    quantity?: string;
    unit?: string;
    instructions?: string;
  }
): Promise<ApiJobSummary> {
  return request<ApiJobSummary>(`/api/jobs/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export function deactivateJob(id: string): Promise<{ ok: boolean; id: string; status: string }> {
  return request(`/api/jobs/${id}/deactivate`, { method: "POST", body: JSON.stringify({}) });
}

export function activateJob(id: string): Promise<{ ok: boolean; id: string; status: string }> {
  return request(`/api/jobs/${id}/activate`, { method: "POST", body: JSON.stringify({}) });
}

export function deleteJob(id: string): Promise<{ ok: boolean; id: string; jobNumber: string }> {
  return request(`/api/jobs/${id}`, { method: "DELETE" });
}

export function cancellationDecision(id: string, action: "release" | "reject" | "cancel"): Promise<{ ok: boolean; status: string; action: string }> {
  return request(`/api/jobs/${id}/cancellation-decision`, { method: "POST", body: JSON.stringify({ action }) });
}

export function releaseDriver(id: string, reason?: string): Promise<{ ok: boolean; status: string }> {
  return request(`/api/jobs/${id}/release-driver`, { method: "POST", body: JSON.stringify({ reason: reason ?? null }) });
}

export function resetJob(id: string): Promise<ApiJobDetail> {
  return request(`/api/jobs/${id}/reset`, { method: "POST" });
}

export function requestJobCorrection(id: string, note?: string): Promise<{ ok: boolean; status: string }> {
  return request(`/api/jobs/${id}/request-correction`, { method: "POST", body: JSON.stringify({ note: note ?? null }) });
}

export function submitJobCompletion(id: string): Promise<{ ok: boolean; status: string }> {
  return request(`/api/jobs/${id}/submit-completion`, { method: "POST", body: JSON.stringify({}) });
}

export function completeJob(id: string): Promise<{ ok: boolean; status: string }> {
  return request(`/api/jobs/${id}/complete`, { method: "POST", body: JSON.stringify({}) });
}

export function markJobVerified(
  id: string,
  stage: "PICKUP" | "DELIVERY"
): Promise<{
  ok: boolean;
  stage: string;
  verifiedAt: string;
  status: string;
  alreadyVerified: boolean;
}> {
  return request(`/api/jobs/${id}/verify`, { method: "POST", body: JSON.stringify({ stage }) });
}


{/*Dashboard stats (sidebar badges)*/}

export interface ApiSidebarCounts {
  conversations: number;
}

export function setConversationTakeover(
  conversationId: string,
  enabled: boolean,
): Promise<{ aiPaused: boolean }> {
  return request(`/api/conversations/${conversationId}/takeover`, {
    method: "POST",
    body: JSON.stringify({ enabled }),
  });
}

export function fetchSidebarCounts(): Promise<ApiSidebarCounts> {
  return request<ApiSidebarCounts>("/api/stats/sidebar-counts");
}

export interface ApiSidebarNotifications {
  driverMessageIds: string[];
  liveJobStamps: string[];
  incidentIds: string[];
  jobRequestIds: string[];
}

export function fetchSidebarNotifications(): Promise<ApiSidebarNotifications> {
  return request<ApiSidebarNotifications>("/api/stats/sidebar-notifications");
}

export interface ApiOverviewKpi {
  label: string;
  value: number;
  hint: string;
  tone: "primary" | "info" | "success" | "warning" | "error" | "neutral";
}

export interface ApiOverviewJob {
  jobNumber: string;
  driver: string;
  origin: string;
  destination: string;
  status: string;
  lastUpdate: string;
  lastUpdateAgo: string;
  exception: string | null;
}

export interface ApiOverviewIncident {
  id: string;
  jobNumber: string;
  summary: string;
}

export interface ApiOverviewAiEvent {
  intent: string;
  detail: string;
  confidence: number;
  tone: "success" | "warning" | "error" | "info";
}

export interface ApiOperationsOverview {
  kpis: ApiOverviewKpi[];
  activeJobs: ApiOverviewJob[];
  openIncidents: ApiOverviewIncident[];
  recentAiEvents: ApiOverviewAiEvent[];
}

export function fetchOperationsOverview(): Promise<ApiOperationsOverview> {
  return request<ApiOperationsOverview>("/api/stats/overview");
}

{/*Incidents*/}

export type ApiIncidentStatus = "OPEN" | "UNDER_REVIEW" | "RESOLVED";

export interface ApiIncidentSummary {
  id: string;
  type: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: ApiIncidentStatus;
  description: string | null;
  reportedAt: string;
  resolvedAt: string | null;
  managerNotes: string | null;
  job: { id: string; jobNumber: string; status: string };
  driver: string;
}

export interface ApiIncidentDetail extends ApiIncidentSummary {
  sourceMessage: { text: string; time: string } | null;
  location: { lat: number; lng: number; receivedAt: string | null } | null;
  backupVehicle: "REQUESTED" | "DECLINED" | null;
  attachments: { id: string; type: string; filename: string | null; mimeType: string | null; publicUrl: string | null }[];
}

export function fetchIncidents(params?: { status?: string; severity?: string }): Promise<ApiIncidentSummary[]> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.severity) qs.set("severity", params.severity);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return request<ApiIncidentSummary[]>(`/api/incidents${suffix}`);
}

export function fetchIncident(id: string): Promise<ApiIncidentDetail> {
  return request<ApiIncidentDetail>(`/api/incidents/${id}`);
}

export function updateIncidentNotes(id: string, managerNotes: string): Promise<{ ok: boolean }> {
  return request(`/api/incidents/${id}`, { method: "PATCH", body: JSON.stringify({ managerNotes }) });
}

export function incidentAction(
  id: string,
  action: "resolve" | "under-review" | "keep-open",
  managerNotes?: string
): Promise<{ ok: boolean; jobNumber: string }> {
  return request(`/api/incidents/${id}/${action}`, {
    method: "POST",
    body: JSON.stringify({ managerNotes: managerNotes ?? null }),
  });
}
