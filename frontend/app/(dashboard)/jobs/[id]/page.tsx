"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import Avatar from "@mui/material/Avatar";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import CancelOutlinedIcon from "@mui/icons-material/CancelOutlined";
import CheckCircleOutlineRoundedIcon from "@mui/icons-material/CheckCircleOutlineRounded";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import EditNoteRoundedIcon from "@mui/icons-material/EditNoteRounded";
import LocalShippingRoundedIcon from "@mui/icons-material/LocalShippingRounded";
import PersonRoundedIcon from "@mui/icons-material/PersonRounded";
import Inventory2RoundedIcon from "@mui/icons-material/Inventory2Rounded";
import ScheduleRoundedIcon from "@mui/icons-material/ScheduleRounded";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import ReportProblemRoundedIcon from "@mui/icons-material/ReportProblemRounded";
import RestartAltRoundedIcon from "@mui/icons-material/RestartAltRounded";
import PersonRemoveRoundedIcon from "@mui/icons-material/PersonRemoveRounded";
import VerifiedUserRoundedIcon from "@mui/icons-material/VerifiedUserRounded";

import StatusChip from "@/components/StatusChip";
import {
  ApiJobActivityMessage,
  ApiJobDetail,
  ApiTimelineEvent,
  cancelJob,
  cancellationDecision,
  completeJob,
  fetchJob,
  fetchJobActivity,
  fetchJobTimeline,
  markJobVerified,
  releaseDriver,
  requestJobCorrection,
  resetJob,
} from "@/lib/api";

const LADDER: {
  key: string;
  label: string;
  protected?: boolean;
  verified?: boolean;
}[] = [
  { key: "PUBLISHED", label: "Published" },
  { key: "ASSIGNED", label: "Assigned", protected: true },
  { key: "IN_PROGRESS", label: "Started" },
  { key: "ARRIVED_AT_PICKUP", label: "At pickup" },
  { key: "LOADED", label: "Loaded", protected: true, verified: true },
  { key: "DEPARTED", label: "Departed" },
  { key: "ARRIVED_AT_DELIVERY", label: "At delivery" },
  {
    key: "DELIVERED",
    label: "Unloaded & Delivered",
    protected: true,
    verified: true,
  },
  { key: "DRIVER_SUBMITTED_COMPLETION", label: "Closure requested" },
  { key: "COMPLETED", label: "Completed", protected: true },
];

const TRACK_INSET = 50 / LADDER.length;

const LADDER_RANK: Record<string, number> = {
  PUBLISHED: 0,
  DRIVER_REQUESTED: 0,
  MANAGER_APPROVED: 1,
  ASSIGNMENT_SENT: 0,
  ASSIGNED: 1,
  IN_PROGRESS: 2,
  ARRIVED_AT_PICKUP: 3,
  LOADING_STARTED: 3,
  LOADED: 4,
  DEPARTED: 5,
  ARRIVED_AT_DELIVERY: 6,
  UNLOADING_STARTED: 6,
  UNLOADED: 7,
  DELIVERED: 7,
  DELIVERED_WITH_EXCEPTION: 7,
  DRIVER_SUBMITTED_COMPLETION: 8,
  MANAGER_REVIEW: 8,
  REQUIRES_CORRECTION: 8,
  COMPLETED: 9,
};

const EVENT_STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  APPLIED: { bg: "#dcfce7", fg: "#15803d" },
  CONFIRMED: { bg: "#dbeafe", fg: "#1d4ed8" },
  PROPOSED: { bg: "#e2e8f0", fg: "#475569" },
  REVIEW_REQUIRED: { bg: "#fef3c7", fg: "#b45309" },
  REJECTED: { bg: "#fee2e2", fg: "#b91c1c" },
};

const LIVE_JOB_STATUSES = new Set([
  "MANAGER_APPROVED",
  "ASSIGNMENT_SENT",
  "ASSIGNED",
  "IN_PROGRESS",
  "ARRIVED_AT_PICKUP",
  "LOADING_STARTED",
  "LOADED",
  "DEPARTED",
  "ARRIVED_AT_DELIVERY",
  "UNLOADING_STARTED",
  "UNLOADED",
  "DELAYED",
  "INCIDENT_OPEN",
  "CANCELLATION_REVIEW",
  "DELIVERED",
  "DELIVERED_WITH_EXCEPTION",
  "DRIVER_SUBMITTED_COMPLETION",
  "MANAGER_REVIEW",
  "REQUIRES_CORRECTION",
]);

function intentTone(status: string) {
  if (status === "REQUIRES_REVIEW") return { bg: "#fef3c7", fg: "#b45309" };
  if (status === "FAILED") return { bg: "#fee2e2", fg: "#b91c1c" };
  return { bg: "#e0e7ff", fg: "#4338ca" };
}

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function latestStatus(status: string, assignmentStatus: string | null | undefined) {
  if (status === "MANAGER_APPROVED" && assignmentStatus === "PENDING_DRIVER_ACCEPTANCE") {
    return assignmentStatus;
  }
  return status;
}

const PROVENANCE_KEYS = new Set([
  "inferred",
  "inferred_by",
  "correction",
  "verification",
  "reason",
]);

function eventDetails(data: Record<string, unknown>) {
  return Object.entries(data ?? {})
    .filter(([k, v]) => v != null && v !== "" && !PROVENANCE_KEYS.has(k))
    .map(
      ([k, v]) =>
        `${k.replace(/_/g, " ")}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`,
    );
}

type Provenance = { label: string; bg: string; fg: string; title?: string };

function eventProvenance(data: Record<string, unknown>): Provenance | null {
  const d = (data ?? {}) as {
    inferred?: boolean;
    reason?: string;
    correction?: boolean;
    verification?: { stage?: string; method?: string };
  };
  if (d.verification) {
    return {
      label: `${(d.verification.stage ?? "").toLowerCase()} code verified`,
      bg: "#dcfce7",
      fg: "#15803d",
      title:
        "Confirmed automatically by matching the document code stored for this job",
    };
  }
  if (d.inferred) {
    return {
      label: "auto-filled",
      bg: "#e0e7ff",
      fg: "#4338ca",
      title: d.reason
        ? `Recorded by the system because it must logically have happened (${d.reason})`
        : "Recorded by the system because it must logically have happened",
    };
  }
  if (d.correction) {
    return {
      label: "correction",
      bg: "#fef3c7",
      fg: "#b45309",
      title: "The driver corrected the job back to this state",
    };
  }
  return null;
}

function stageDelayMinutes(
  scheduled: string | null,
  actual: string | null,
): number | null {
  if (!scheduled || !actual) return null;
  const minutes = Math.round(
    (new Date(actual).getTime() - new Date(scheduled).getTime()) / 60000,
  );
  return minutes > 0 ? minutes : null;
}

function fmtDelay(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function DelayCard({
  label,
  scheduled,
  actual,
  reason,
}: {
  label: string;
  scheduled: string | null;
  actual: string | null;
  reason: string | null;
}) {
  const minutes = stageDelayMinutes(scheduled, actual);
  if (minutes == null) return null;
  return (
    <div className="mt-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px]">
      <div className="flex items-center justify-between gap-1">
        <span className="font-bold text-amber-800">
          {label}: {fmtDelay(minutes)} late
        </span>
        {!reason && (
          <span className="rounded bg-amber-200/70 px-1 font-bold text-[9px] text-amber-900">
            Pending
          </span>
        )}
      </div>
      {reason && (
        <span className="mt-0.5 block text-[10px] text-amber-700 truncate">
          Reason: {reason}
        </span>
      )}
    </div>
  );
}

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const jobId = params.id;

  const [job, setJob] = React.useState<ApiJobDetail | null>(null);
  const [timeline, setTimeline] = React.useState<ApiTimelineEvent[]>([]);
  const [activity, setActivity] = React.useState<ApiJobActivityMessage[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [cancelReason, setCancelReason] = React.useState("");
  const [correctionOpen, setCorrectionOpen] = React.useState(false);
  const [correctionNote, setCorrectionNote] = React.useState("");
  const [releaseOpen, setReleaseOpen] = React.useState(false);
  const [releaseReason, setReleaseReason] = React.useState("");
  const [resetOpen, setResetOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const [detail, events, activityData] = await Promise.all([
        fetchJob(jobId),
        fetchJobTimeline(jobId),
        fetchJobActivity(jobId),
      ]);
      setJob(detail);
      setTimeline(events);
      setActivity(activityData.messages);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load job");
    }
  }, [jobId]);

  React.useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  if (error && !job) {
    return (
      <div className="mx-auto max-w-[1200px] p-6">
        <Button
          component={Link}
          href="/jobs"
          startIcon={<ArrowBackRoundedIcon />}
          size="small"
        >
          Jobs
        </Button>
        <Paper sx={{ mt: 3, p: 6, textAlign: "center" }}>
          <Typography sx={{ color: "#b91c1c", fontWeight: 700 }}>
            {error}
          </Typography>
        </Paper>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="flex justify-center p-16">
        <CircularProgress />
      </div>
    );
  }

  const pickup = job.stops.find((s) => s.type === "PICKUP");
  const delivery = job.stops.find((s) => s.type === "DELIVERY");
  const ladderIndex = LADDER_RANK[job.status] ?? 0;
  const finalStatuses = ["COMPLETED", "CANCELLED"];
  const inCancellationReview = job.status === "CANCELLATION_REVIEW";
  const inCompletionReview = [
    "DRIVER_SUBMITTED_COMPLETION",
    "MANAGER_REVIEW",
    "REQUIRES_CORRECTION",
  ].includes(job.status);
  const readyForClosure = ["DELIVERED", "DELIVERED_WITH_EXCEPTION"].includes(
    job.status,
  );
  const isLive = LIVE_JOB_STATUSES.has(job.status);
  const displayStatus = latestStatus(job.status, job.assignment?.status);
  const awaitingDriverConfirmation = job.status === "MANAGER_APPROVED";
  const hasLiveAssignment = [
    "PENDING_DRIVER_ACCEPTANCE",
    "ASSIGNED",
    "ACTIVE",
    "CANCELLATION_REVIEW",
  ].includes(job.assignment?.status ?? "");
  const mediaAttachments = activity.flatMap((m) =>
    m.attachments.filter((a) => a.type === "IMAGE" || a.type === "DOCUMENT"),
  );

  return (
    <div className="mx-auto flex h-full w-full max-w-[1500px] flex-col gap-4 overflow-y-auto p-4 sm:p-6 lg:overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            onClick={() => router.back()}
            startIcon={<ArrowBackRoundedIcon />}
            size="small"
            variant="outlined"
            sx={{ bgcolor: "#fff" }}
          >
            Jobs
          </Button>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>
            {job.jobNumber}
          </Typography>
          <StatusChip status={displayStatus} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            color="warning"
            variant="outlined"
            size="small"
            startIcon={<PersonRemoveRoundedIcon />}
            disabled={busy || !hasLiveAssignment}
            onClick={() => setReleaseOpen(true)}
          >
            Release Driver
          </Button>
          <Button
            color="error"
            variant="outlined"
            size="small"
            startIcon={<RestartAltRoundedIcon />}
            disabled={busy || job.status === "DRAFT"}
            onClick={() => setResetOpen(true)}
          >
            Reset Job
          </Button>
          {!finalStatuses.includes(job.status) && !inCancellationReview && (
            <Button
              color="error"
              variant="outlined"
              size="small"
              startIcon={<CancelOutlinedIcon />}
              disabled={busy}
              onClick={() => setCancelOpen(true)}
            >
              Cancel Job
            </Button>
          )}
        </div>
      </div>

      {/* Progress */}
      <Paper sx={{ px: 3, py: 2 }} className="w-full shrink-0">
        <Typography sx={{ fontWeight: 800, mb: 1.5, fontSize: 15 }}>
          Progress
        </Typography>
        <div className="relative">
          <div
            className="absolute top-[5px] h-0.5 rounded-full bg-slate-200"
            style={{ left: `${TRACK_INSET}%`, right: `${TRACK_INSET}%` }}
          />
          <div
            className="absolute top-[5px] h-0.5 rounded-full bg-blue-600 transition-all"
            style={{
              left: `${TRACK_INSET}%`,
              width: `${((100 - TRACK_INSET * 2) * ladderIndex) / (LADDER.length - 1)}%`,
            }}
          />
          <div className="relative flex justify-between">
            {LADDER.map((step, i) => {
              const awaitingAssignedStep =
                awaitingDriverConfirmation && step.key === "ASSIGNED";
              const reached = i <= ladderIndex && !awaitingAssignedStep;
              const current = i === ladderIndex;
              const nearCurrent = Math.abs(i - ladderIndex) <= 1;
              return (
                <div
                  key={step.key}
                  className="flex flex-1 flex-col items-center"
                >
                  <span className="relative flex h-3 w-3 items-center justify-center">
                    {current && (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-60" />
                    )}
                    <span
                      className="relative inline-flex h-2.5 w-2.5 rounded-full"
                      style={{
                        background: awaitingAssignedStep
                          ? "#fff"
                          : reached
                            ? "#2563eb"
                            : "#cbd5e1",
                        border: awaitingAssignedStep
                          ? "2px solid #2563eb"
                          : undefined,
                      }}
                    />
                  </span>
                  <span
                    className={`mt-1 text-center text-[11px] font-medium leading-tight ${
                      current ? "font-bold text-blue-700" : "text-slate-500"
                    } ${nearCurrent ? "" : "hidden sm:block"}`}
                  >
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        {awaitingDriverConfirmation && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-2">
            <PersonRoundedIcon sx={{ color: "#2563eb", fontSize: 18 }} />
            <Typography
              variant="body2"
              sx={{ color: "#1e40af", fontWeight: 600 }}
            >
              Awaiting driver confirmation.
            </Typography>
          </div>
        )}
      </Paper>

      {actionError && (
        <Paper
          className="shrink-0"
          sx={{ p: 1.5, bgcolor: "#fef2f2", border: "1px solid #fecaca" }}
        >
          <Typography
            variant="body2"
            sx={{ color: "#b91c1c", fontWeight: 600 }}
          >
            {actionError}
          </Typography>
        </Paper>
      )}

      {/* Cancellation Review Card */}
      {inCancellationReview && (
        <Paper
          className="shrink-0"
          sx={{
            p: 2.5,
            border: "1px solid #fde68a",
            bgcolor: "#fffbeb",
            borderRadius: 3,
          }}
        >
          <div className="flex items-start gap-2.5">
            <ReportProblemRoundedIcon sx={{ color: "#d97706", mt: 0.3 }} />
            <div className="flex-1">
              <Typography sx={{ fontWeight: 800, color: "#92400e" }}>
                {job.assignment?.driver.name ?? "The driver"} asked to cancel
                this job
              </Typography>
              <Typography variant="body2" sx={{ color: "#a16207", mt: 0.5 }}>
                Reason: {job.assignment?.cancellationReason ?? "not given"}
              </Typography>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="small"
                  variant="contained"
                  color="success"
                  disabled={busy}
                  onClick={() =>
                    run(() => cancellationDecision(job.id, "release"))
                  }
                >
                  Release driver (job reopens)
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  color="warning"
                  disabled={busy}
                  onClick={() =>
                    run(() => cancellationDecision(job.id, "reject"))
                  }
                >
                  Reject request (keep job)
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  disabled={busy}
                  onClick={() =>
                    run(() => cancellationDecision(job.id, "cancel"))
                  }
                >
                  Cancel the job
                </Button>
              </div>
            </div>
          </div>
        </Paper>
      )}

      {/* Closure Card */}
      {readyForClosure && (
        <Paper
          className="shrink-0"
          sx={{
            p: 2.5,
            border: "1px solid #bbf7d0",
            bgcolor: "#f0fdf4",
            borderRadius: 3,
          }}
        >
          <div className="flex items-start gap-2.5">
            <CheckCircleOutlineRoundedIcon sx={{ color: "#16a34a", mt: 0.3 }} />
            <div className="flex-1">
              <Typography sx={{ fontWeight: 800, color: "#166534" }}>
                This trip has been delivered
                {job.status === "DELIVERED_WITH_EXCEPTION"
                  ? " with an exception"
                  : ""}
              </Typography>
              <Typography variant="body2" sx={{ color: "#15803d", mt: 0.5 }}>
                Close the job to mark it completed and release the driver for
                their next job.
              </Typography>
              <div className="mt-3">
                <Button
                  size="small"
                  variant="contained"
                  color="success"
                  disabled={busy}
                  onClick={() => run(() => completeJob(job.id))}
                >
                  Approve & Close Job
                </Button>
              </div>
            </div>
          </div>
        </Paper>
      )}

      {/* Completion Review Card */}
      {inCompletionReview && (
        <Paper
          className="shrink-0"
          sx={{
            p: 2.5,
            border: "1px solid #bfdbfe",
            bgcolor: "#eff6ff",
            borderRadius: 3,
          }}
        >
          <div className="flex items-start gap-2.5">
            <CheckCircleOutlineRoundedIcon sx={{ color: "#2563eb", mt: 0.3 }} />
            <div className="flex-1">
              <Typography sx={{ fontWeight: 800, color: "#1e40af" }}>
                {job.status === "REQUIRES_CORRECTION"
                  ? "Correction requested from the driver"
                  : job.status === "MANAGER_REVIEW"
                    ? "This trip is in closure review"
                    : "The driver requested closure of this trip"}
              </Typography>
              <Typography variant="body2" sx={{ color: "#3b82f6", mt: 0.5 }}>
                Review the timeline below, then approve the close or ask for a
                correction.
              </Typography>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="small"
                  variant="contained"
                  color="success"
                  disabled={busy}
                  onClick={() => run(() => completeJob(job.id))}
                >
                  Approve & Close Job
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={busy}
                  startIcon={<EditNoteRoundedIcon />}
                  onClick={() => setCorrectionOpen(true)}
                >
                  Request Correction
                </Button>
              </div>
            </div>
          </div>
        </Paper>
      )}

      <div className="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:overflow-hidden">
        {/* Job Details Row */}
        <Paper
          sx={{
            p: 2.5,
            borderRadius: 2.5,
            border: "1px solid",
            borderColor: "divider",
          }}
          className="w-full shrink-0 shadow-sm"
        >
          <div className="grid grid-cols-1 divide-y divide-slate-100 md:grid-cols-2 lg:grid-cols-12 lg:divide-x lg:divide-y-0">
            {/* Trip: Origin -> Destination */}
            <div className="flex flex-col justify-between py-2 pr-0 lg:col-span-4 lg:py-0 lg:pr-5">
              <div className="flex items-center gap-2">
                <LocalShippingRoundedIcon
                  sx={{ color: "#2563eb", fontSize: 18 }}
                />
                <Typography
                  variant="caption"
                  sx={{
                    fontWeight: 800,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "#64748b",
                  }}
                >
                  Route
                </Typography>
              </div>

              <div className="mt-2 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <Typography
                    variant="body2"
                    sx={{
                      fontWeight: 700,
                      color: "text.primary",
                      lineHeight: 1.25,
                    }}
                  >
                    {pickup?.name ?? "—"}
                  </Typography>
                  {pickup?.address && (
                    <Typography
                      variant="caption"
                      sx={{
                        color: "text.secondary",
                        display: "block",
                        mt: 0.5,
                        lineHeight: 1.25,
                      }}
                      title={pickup.address}
                    >
                      {pickup.address.replace(
                        new RegExp(`^${pickup.name}?[,\\s]*`, "i"),
                        "",
                      ) || pickup.address}
                    </Typography>
                  )}
                </div>

                <ArrowForwardRoundedIcon
                  sx={{
                    color: "#94a3b8",
                    flexShrink: 0,
                    fontSize: 16,
                    mt: 0.25,
                  }}
                />

                <div className="min-w-0 flex-1">
                  <Typography
                    variant="body2"
                    sx={{
                      fontWeight: 700,
                      color: "text.primary",
                      lineHeight: 1.25,
                    }}
                  >
                    {delivery?.name ?? "—"}
                  </Typography>
                  {delivery?.address && (
                    <Typography
                      variant="caption"
                      sx={{
                        color: "text.secondary",
                        display: "block",
                        mt: 0.5,
                        lineHeight: 1.25,
                      }}
                      title={delivery.address}
                    >
                      {delivery.address.replace(
                        new RegExp(`^${delivery.name}?[,\\s]*`, "i"),
                        "",
                      ) || delivery.address}
                    </Typography>
                  )}
                </div>
              </div>
            </div>

            {/* Cargo */}
            <div className="flex flex-col justify-between py-2 lg:col-span-2 lg:px-4 lg:py-0">
              <div className="flex items-center gap-2">
                <Inventory2RoundedIcon
                  sx={{ color: "#2563eb", fontSize: 18 }}
                />
                <Typography
                  variant="caption"
                  sx={{
                    fontWeight: 800,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "#64748b",
                  }}
                >
                  Cargo
                </Typography>
              </div>

              <div className="mt-2 min-w-0">
                <Typography
                  variant="body2"
                  sx={{ fontWeight: 700, lineHeight: 1.25 }}
                  noWrap
                  title={job.cargo}
                >
                  {job.cargo || "General Freight"}
                </Typography>

                {job.items.map((item) => {
                  const isRedundant =
                    item.description.trim().toLowerCase() ===
                    (job.cargo ?? "").trim().toLowerCase();
                  return (
                    <Typography
                      key={item.description}
                      variant="caption"
                      sx={{
                        display: "block",
                        color: "text.secondary",
                        mt: 0.25,
                      }}
                    >
                      {isRedundant
                        ? item.quantity
                          ? `${item.quantity} Units`
                          : ""
                        : `${item.description}${item.quantity ? ` · ${item.quantity}` : ""}`}
                    </Typography>
                  );
                })}

                {job.specialInstructions && (
                  <Chip
                    size="small"
                    label={job.specialInstructions}
                    sx={{
                      mt: 0.75,
                      bgcolor: "#fef3c7",
                      color: "#92400e",
                      fontWeight: 600,
                      fontSize: 10,
                      height: 20,
                    }}
                  />
                )}
              </div>
            </div>

            {/* Schedule */}
            <div className="flex flex-col justify-between py-2 lg:col-span-2 lg:px-4 lg:py-0">
              <div className="flex items-center gap-2">
                <ScheduleRoundedIcon sx={{ color: "#2563eb", fontSize: 18 }} />
                <Typography
                  variant="caption"
                  sx={{
                    fontWeight: 800,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "#64748b",
                  }}
                >
                  Schedule
                </Typography>
              </div>

              <div className="mt-2 space-y-1">
                <div className="flex items-baseline justify-between gap-1">
                  <Typography
                    variant="caption"
                    sx={{ color: "text.secondary" }}
                  >
                    Pick:
                  </Typography>
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>
                    {fmtTime(job.pickupAt)}
                  </Typography>
                </div>
                <div className="flex items-baseline justify-between gap-1">
                  <Typography
                    variant="caption"
                    sx={{ color: "text.secondary" }}
                  >
                    Drop:
                  </Typography>
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>
                    {fmtTime(job.deliveryAt)}
                  </Typography>
                </div>
                <DelayCard
                  label="Pickup"
                  scheduled={job.pickupAt}
                  actual={job.pickupActualAt}
                  reason={job.pickupDelayReason}
                />
                <DelayCard
                  label="Delivery"
                  scheduled={job.deliveryAt}
                  actual={job.deliveryActualAt}
                  reason={job.deliveryDelayReason}
                />
              </div>
            </div>

            {/* Driver */}
            <div className="flex flex-col justify-between py-2 lg:col-span-2 lg:px-4 lg:py-0">
              <div className="flex items-center gap-2">
                <PersonRoundedIcon sx={{ color: "#2563eb", fontSize: 18 }} />
                <Typography
                  variant="caption"
                  sx={{
                    fontWeight: 800,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "#64748b",
                  }}
                >
                  Driver
                </Typography>
              </div>

              <div className="mt-2 flex items-center gap-2">
                {job.assignment ? (
                  <>
                    <Avatar
                      sx={{
                        width: 34,
                        height: 34,
                        fontSize: 12,
                        fontWeight: 700,
                        bgcolor: "#eff6ff",
                        color: "#1d4ed8",
                        border: "1px solid #bfdbfe",
                      }}
                    >
                      {job.assignment.driver.name.slice(0, 2).toUpperCase()}
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <Typography
                        variant="body2"
                        sx={{ fontWeight: 700, lineHeight: 1.2 }}
                        noWrap
                      >
                        {job.assignment.driver.name}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{
                          color: "text.secondary",
                          display: "block",
                          lineHeight: 1.2,
                        }}
                        noWrap
                      >
                        {job.assignment.driver.phone}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{
                          color: "#64748b",
                          display: "block",
                          fontSize: 10,
                          fontWeight: 600,
                        }}
                      >
                        {job.assignment.status.replace(/_/g, " ")}
                      </Typography>
                    </div>
                  </>
                ) : (
                  <Typography
                    variant="caption"
                    sx={{ color: "text.secondary", fontStyle: "italic" }}
                  >
                    Unassigned
                  </Typography>
                )}
              </div>
            </div>

            {/* Security Codes */}
            <div className="flex flex-col justify-between py-2 lg:col-span-2 lg:py-0 lg:pl-4">
              <div className="flex items-center gap-1.5">
                <VerifiedUserRoundedIcon
                  sx={{ color: "#2563eb", fontSize: 18 }}
                />
                <Typography
                  variant="caption"
                  sx={{
                    fontWeight: 800,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "#64748b",
                  }}
                >
                  Site Codes
                </Typography>
              </div>

              <div className="mt-2 space-y-1.5">
                {[
                  {
                    label: "Pickup",
                    code: job.pickupCode,
                    verifiedAt: job.pickupVerifiedAt,
                    stage: "PICKUP" as const,
                  },
                  {
                    label: "Drop",
                    code: job.deliveryCode,
                    verifiedAt: job.deliveryVerifiedAt,
                    stage: "DELIVERY" as const,
                  },
                ].map(({ label, code, verifiedAt, stage }) => (
                  <div
                    key={stage}
                    className="flex items-center justify-between gap-1.5 text-xs"
                  >
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="text-[11px] font-medium text-slate-500 w-8">
                        {label}
                      </span>
                      {code ? (
                        <div className="flex items-center rounded bg-slate-100 px-1.5 py-0.5 font-mono font-bold text-[12px] text-slate-800">
                          {code}
                          <IconButton
                            size="small"
                            sx={{ p: 0.25, ml: 0.5 }}
                            onClick={() =>
                              void navigator.clipboard.writeText(code)
                            }
                          >
                            <ContentCopyRoundedIcon sx={{ fontSize: 11 }} />
                          </IconButton>
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </div>

                    <div className="shrink-0">
                      {verifiedAt ? (
                        <Chip
                          size="small"
                          label="Verified"
                          sx={{
                            bgcolor: "#dcfce7",
                            color: "#15803d",
                            fontWeight: 700,
                            fontSize: 10,
                            height: 18,
                          }}
                        />
                      ) : code && !finalStatuses.includes(job.status) ? (
                        <Button
                          size="small"
                          variant="text"
                          sx={{
                            minWidth: 0,
                            p: 0,
                            fontSize: 11,
                            fontWeight: 700,
                            textTransform: "none",
                          }}
                          disabled={busy}
                          onClick={() =>
                            run(() => markJobVerified(job.id, stage))
                          }
                        >
                          Verify
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Paper>

        {/* Timeline + Activity Section */}
        <div className="grid grid-cols-1 gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-2 lg:overflow-hidden">
          {/* Event Timeline Card */}
          <Paper
            sx={{
              p: 2.5,
              borderRadius: 2.5,
              border: "1px solid",
              borderColor: "divider",
            }}
            className="flex min-h-0 flex-col lg:overflow-hidden"
          >
            <div className="mb-3 flex shrink-0 items-center justify-between">
              <div className="flex items-center gap-2">
                <Typography sx={{ fontWeight: 800, fontSize: 14 }}>
                  Event Timeline
                </Typography>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                  {timeline.length}
                </span>
              </div>
              <Typography
                variant="caption"
                sx={{ color: "text.secondary", fontSize: 11 }}
              >
                Reverse chronological
              </Typography>
            </div>

            {timeline.length === 0 ? (
              <div className="flex flex-1 items-center justify-center p-6 text-center">
                <Typography
                  variant="body2"
                  sx={{ color: "text.secondary", fontSize: 12 }}
                >
                  No events recorded yet. Updates appear here automatically.
                </Typography>
              </div>
            ) : (
              <div className="slim-scroll -mr-1 flex min-h-0 flex-1 flex-col overflow-y-auto pr-2">
                <div className="relative pl-4 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-[2px] before:bg-slate-200">
                  {[...timeline].reverse().map((event) => {
                    const tone =
                      EVENT_STATUS_TONE[event.status] ??
                      EVENT_STATUS_TONE.PROPOSED;
                    const details = eventDetails(event.data);
                    const provenance = eventProvenance(event.data);

                    return (
                      <div key={event.id} className="relative pb-3 last:pb-1">
                        <div
                          className="absolute -left-4 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white shadow-sm ring-1 ring-slate-300"
                          style={{ backgroundColor: tone.fg }}
                        />

                        <div className="rounded-md border border-transparent p-1.5 hover:border-slate-200 hover:bg-slate-50/60 transition-colors">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs font-bold text-slate-800 tracking-tight">
                              {event.type.replace(/_/g, " ")}
                            </span>

                            <Chip
                              size="small"
                              label={event.status.toLowerCase()}
                              sx={{
                                bgcolor: tone.bg,
                                color: tone.fg,
                                fontWeight: 700,
                                fontSize: 9.5,
                                height: 18,
                                px: 0.2,
                                textTransform: "capitalize",
                              }}
                            />

                            {provenance && (
                              <Tooltip title={provenance.title ?? ""}>
                                <Chip
                                  size="small"
                                  label={provenance.label}
                                  sx={{
                                    bgcolor: provenance.bg,
                                    color: provenance.fg,
                                    fontWeight: 600,
                                    fontSize: 9.5,
                                    height: 18,
                                    px: 0.2,
                                  }}
                                />
                              </Tooltip>
                            )}

                            {event.confidence != null && (
                              <span className="inline-flex items-center gap-0.5 rounded bg-blue-50 px-1 py-0.5 text-[10px] font-semibold text-blue-700">
                                <AutoAwesomeRoundedIcon sx={{ fontSize: 10 }} />
                                {Math.round(event.confidence * 100)}%
                              </span>
                            )}

                            <span className="ml-auto text-[11px] font-medium text-slate-400">
                              {fmtTime(event.time)}
                            </span>
                          </div>

                          {event.sourceMessage && (
                            <p className="mt-1 text-[11px] italic text-slate-600 line-clamp-2">
                              “{event.sourceMessage}”
                            </p>
                          )}

                          {details.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {details.map((d, i) => (
                                <span
                                  key={i}
                                  className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
                                >
                                  {d}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Paper>

          {/* Driver Activity Card */}
          <Paper
            sx={{
              p: 2.5,
              borderRadius: 2.5,
              border: "1px solid",
              borderColor: "divider",
            }}
            className="flex min-h-0 flex-col lg:overflow-hidden"
          >
            <div className="mb-2 flex shrink-0 items-center justify-between">
              <div className="flex items-center gap-2">
                <Typography sx={{ fontWeight: 800, fontSize: 14 }}>
                  Driver Activity
                </Typography>
                {isLive && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    LIVE
                  </span>
                )}
              </div>
              <span className="text-[11px] font-medium text-slate-400">
                WhatsApp stream
              </span>
            </div>

            {/* Pinned Media Gallery */}
            {mediaAttachments.length > 0 && (
              <div className="mb-2.5 flex shrink-0 items-center gap-2 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50/80 p-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 shrink-0">
                  Media ({mediaAttachments.length})
                </span>
                <div className="flex gap-2 min-w-0">
                  {mediaAttachments.map((att) =>
                    att.type === "IMAGE" && att.publicUrl ? (
                      <a
                        key={att.id}
                        href={att.publicUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="group relative h-12 w-12 shrink-0 overflow-hidden rounded border border-slate-200 bg-white"
                      >
                        <img
                          src={att.publicUrl}
                          alt={att.filename ?? "attachment"}
                          className="h-full w-full object-cover transition-transform group-hover:scale-110"
                        />
                      </a>
                    ) : (
                      <a
                        key={att.id}
                        href={att.publicUrl ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                        className="flex h-12 w-20 shrink-0 flex-col items-center justify-center rounded border border-slate-200 bg-white px-1 text-center no-underline hover:bg-slate-100"
                      >
                        <span className="w-full truncate text-[10px] font-semibold text-slate-700">
                          {att.filename ?? att.type}
                        </span>
                        <span className="text-[9px] text-slate-400">
                          {fmtTime(att.createdAt)}
                        </span>
                      </a>
                    ),
                  )}
                </div>
              </div>
            )}

            {activity.length === 0 ? (
              <div className="flex flex-1 items-center justify-center p-6 text-center">
                <Typography
                  variant="body2"
                  sx={{ color: "text.secondary", fontSize: 12 }}
                >
                  No messages or WhatsApp updates received yet.
                </Typography>
              </div>
            ) : (
              <div className="slim-scroll -mr-1 flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-2">
                {[...activity].reverse().map((msg) => {
                  const isBot = msg.kind === "BOT";
                  const isDriver = msg.kind === "DRIVER";
                  const tone = msg.interpretation
                    ? intentTone(msg.interpretation.status)
                    : null;

                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col rounded-lg p-2.5 text-xs transition-colors ${
                        isBot
                          ? "bg-slate-100/70 border border-slate-200/80 text-slate-800"
                          : isDriver
                            ? "bg-emerald-50/50 border border-emerald-100 text-slate-900"
                            : "bg-blue-50/50 border border-blue-100 text-slate-900"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider ${
                            isBot
                              ? "bg-slate-200 text-slate-700"
                              : isDriver
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-blue-100 text-blue-800"
                          }`}
                        >
                          {msg.kind}
                        </span>

                        {msg.interpretation && tone && (
                          <Chip
                            size="small"
                            label={`${msg.interpretation.intent.replace(/_/g, " ")} · ${Math.round(
                              msg.interpretation.confidence * 100,
                            )}%`}
                            sx={{
                              bgcolor: tone.bg,
                              color: tone.fg,
                              fontWeight: 700,
                              fontSize: 9.5,
                              height: 18,
                              px: 0.2,
                            }}
                          />
                        )}

                        <span className="ml-auto text-[10px] text-slate-400">
                          {fmtTime(msg.time)}
                        </span>
                      </div>

                      {msg.text && (
                        <div className="mt-1.5 text-[12px] font-normal leading-snug break-words text-slate-800">
                          {msg.text}
                        </div>
                      )}

                      {msg.interpretation &&
                        msg.interpretation.fields.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1 border-t border-slate-200/50 pt-1">
                            {msg.interpretation.fields.map((f, i) => (
                              <span
                                key={i}
                                className="text-[10px] text-slate-500 font-mono"
                              >
                                <span className="font-semibold text-slate-700">
                                  {f.label}:
                                </span>{" "}
                                {f.value}
                              </span>
                            ))}
                          </div>
                        )}

                      {msg.attachments.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {msg.attachments.map((att) =>
                            att.type === "IMAGE" && att.publicUrl ? (
                              <a
                                key={att.id}
                                href={att.publicUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="h-10 w-10 overflow-hidden rounded border border-slate-300"
                              >
                                <img
                                  src={att.publicUrl}
                                  alt="preview"
                                  className="h-full w-full object-cover"
                                />
                              </a>
                            ) : (
                              <span
                                key={att.id}
                                className="rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-medium border border-slate-200 text-slate-600"
                              >
                                📎 {att.filename ?? att.type}
                              </span>
                            ),
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Paper>
        </div>
      </div>

      {/* Cancel Dialog */}
      <Dialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Cancel {job.jobNumber}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>
            The job is cancelled immediately and the assigned driver (if any) is
            notified over WhatsApp. This cannot be undone.
          </Typography>
          <TextField
            fullWidth
            size="small"
            label="Reason (optional)"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCancelOpen(false)}>Back</Button>
          <Button
            color="error"
            variant="contained"
            disabled={busy}
            onClick={() => {
              setCancelOpen(false);
              run(() => cancelJob(job.id, cancelReason || undefined));
            }}
          >
            Cancel Job
          </Button>
        </DialogActions>
      </Dialog>

      {/* Correction Dialog */}
      <Dialog
        open={correctionOpen}
        onClose={() => setCorrectionOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Request a correction</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>
            The driver gets a WhatsApp message asking for the correction (e.g.
            corrected quantity or missing POD).
          </Typography>
          <TextField
            fullWidth
            size="small"
            label="What needs correcting?"
            value={correctionNote}
            onChange={(e) => setCorrectionNote(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCorrectionOpen(false)}>Back</Button>
          <Button
            variant="contained"
            disabled={busy}
            onClick={() => {
              setCorrectionOpen(false);
              run(() =>
                requestJobCorrection(job.id, correctionNote || undefined),
              );
            }}
          >
            Send Request
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={releaseOpen}
        onClose={() => setReleaseOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Release driver?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>
            The driver will be notified and the job will reopen for another
            driver.
          </Typography>
          <TextField
            fullWidth
            size="small"
            label="Reason (optional)"
            value={releaseReason}
            onChange={(event) => setReleaseReason(event.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReleaseOpen(false)}>Back</Button>
          <Button
            color="warning"
            variant="contained"
            disabled={busy}
            onClick={() => {
              setReleaseOpen(false);
              run(() => releaseDriver(job.id, releaseReason || undefined));
            }}
          >
            Release Driver
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Reset {job.jobNumber}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: "#b91c1c" }}>
            This removes the driver assignment, requests, incidents, workflow
            events, and job notifications. The job returns to Published with new
            security codes.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResetOpen(false)}>Back</Button>
          <Button
            color="error"
            variant="contained"
            disabled={busy}
            onClick={() => {
              setResetOpen(false);
              run(() => resetJob(job.id));
            }}
          >
            Reset Job
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
