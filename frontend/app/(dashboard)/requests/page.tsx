"use client";

import * as React from "react";
import Link from "next/link";
import Avatar from "@mui/material/Avatar";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import VerifiedRoundedIcon from "@mui/icons-material/VerifiedRounded";
import InboxRoundedIcon from "@mui/icons-material/InboxRounded";

import StatusChip from "@/components/StatusChip";
import {
  ApiJobRequest,
  ApiJobSummary,
  ApiRequestHistoryEntry,
  approveJobRequest,
  cancellationDecision,
  completeJob,
  fetchJobRequests,
  fetchJobs,
  fetchRequestHistory,
  rejectJobRequest,
} from "@/lib/api";

const CLOSURE_STATUSES =
  "DELIVERED,DELIVERED_WITH_EXCEPTION,DRIVER_SUBMITTED_COMPLETION,MANAGER_REVIEW,REQUIRES_CORRECTION";

type QueueTab = "requests" | "history" | "cancellations" | "closures";

// Request History mixes three different kinds of driver ask - label each row
// so it's clear at a glance which one a given decision was for.
const REQUEST_TYPE_META: Record<
  ApiRequestHistoryEntry["type"],
  { label: string; bg: string; fg: string }
> = {
  JOB_REQUEST: { label: "Job request", bg: "#eff6ff", fg: "#1d4ed8" },
  CANCELLATION: { label: "Cancellation", bg: "#fef2f2", fg: "#b91c1c" },
  CLOSURE: { label: "Closure", bg: "#f0fdf4", fg: "#15803d" },
};

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function timeAgo(iso: string) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 60000),
  );
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

const tableSx = {
  tableLayout: "fixed",
  width: "100%",
  "& .MuiTableCell-root": {
    px: 2,
    py: 1.5,
    verticalAlign: "middle",
    whiteSpace: "normal",
    overflowWrap: "break-word",
    borderColor: "#e2e8f0",
  },
  "& .MuiTableCell-root:first-of-type": { pl: 2.5 },
  "& .MuiTableCell-root:last-of-type": { pr: 2.5 },
  "& .MuiTableHead-root .MuiTableCell-root": {
    backgroundColor: "#f8fafc",
    color: "#64748b",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    py: 1.25,
    borderBottom: "1px solid #e2e8f0",
  },
} as const;
function tabBadgeClass(count: number, activeClasses: string) {
  return `flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold ${
    count > 0 ? activeClasses : "bg-slate-100 text-slate-500"
  }`;
}

export default function DriverRequestsPage() {
  const [requests, setRequests] = React.useState<ApiJobRequest[] | null>(null);
  const [requestHistory, setRequestHistory] = React.useState<
    ApiRequestHistoryEntry[] | null
  >(null);
  const [closureJobs, setClosureJobs] = React.useState<ApiJobSummary[] | null>(
    null,
  );
  const [cancelJobs, setCancelJobs] = React.useState<ApiJobSummary[] | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [closureBusyId, setClosureBusyId] = React.useState<string | null>(null);
  const [cancelBusyId, setCancelBusyId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [activeTab, setActiveTab] = React.useState<QueueTab>("requests");

  const load = React.useCallback(async (showSpinner: boolean) => {
    if (showSpinner) {
      setRequests(null);
      setRequestHistory(null);
      setClosureJobs(null);
      setCancelJobs(null);
    }
    try {
      const [requestData, historyData, closureData, cancelData] = await Promise.all([
        fetchJobRequests("REQUESTED"),
        fetchRequestHistory(),
        fetchJobs({ status: CLOSURE_STATUSES }),
        fetchJobs({ status: "CANCELLATION_REVIEW" }),
      ]);
      setRequests(requestData);
      setRequestHistory(historyData);
      setClosureJobs(closureData);
      setCancelJobs(cancelData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load requests");
    }
  }, []);

  React.useEffect(() => {
    load(true);
    const timer = setInterval(() => load(false), 5000);
    return () => clearInterval(timer);
  }, [load]);

  const decide = async (
    request: ApiJobRequest,
    decision: "APPROVED" | "REJECTED",
  ) => {
    setBusyId(request.id);
    setActionError(null);
    try {
      if (decision === "APPROVED") await approveJobRequest(request.id);
      else await rejectJobRequest(request.id);
      setRequests((prev) => prev?.filter((r) => r.id !== request.id) ?? null);
      await load(false);
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : `Failed to ${decision.toLowerCase()} request`,
      );
    } finally {
      setBusyId(null);
    }
  };

  const pendingCount = requests?.length ?? 0;
  const historyCount = requestHistory?.length ?? 0;
  const closureCount = closureJobs?.length ?? 0;
  const cancelCount = cancelJobs?.length ?? 0;

  const kpiCards: {
    label: string;
    value: number;
    hint: string;
    hintColor: string;
    tab: QueueTab;
  }[] = [
    {
      label: "Job Requests",
      value: pendingCount,
      hint: "awaiting approval",
      hintColor: pendingCount > 0 ? "#b45309" : "#15803d",
      tab: "requests",
    },
    {
      label: "Cancellations",
      value: cancelCount,
      hint: "to review",
      hintColor: cancelCount > 0 ? "#b91c1c" : "#15803d",
      tab: "cancellations",
    },
    {
      label: "Closures",
      value: closureCount,
      hint: "awaiting closure",
      hintColor: closureCount > 0 ? "#1d4ed8" : "#15803d",
      tab: "closures",
    },
  ];

  const actCancel = async (
    job: ApiJobSummary,
    action: "release" | "reject",
  ) => {
    setCancelBusyId(job.id);
    setActionError(null);
    try {
      await cancellationDecision(job.id, action);
      setCancelJobs((prev) => prev?.filter((j) => j.id !== job.id) ?? null);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Cancellation decision failed",
      );
    } finally {
      setCancelBusyId(null);
    }
  };

  const actClosure = async (job: ApiJobSummary) => {
    setClosureBusyId(job.id);
    setActionError(null);
    try {
      await completeJob(job.id);
      setClosureJobs((prev) => prev?.filter((j) => j.id !== job.id) ?? null);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Closure action failed",
      );
    } finally {
      setClosureBusyId(null);
    }
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-[1500px] flex-col gap-4 overflow-y-auto p-4 sm:p-6 xl:overflow-hidden">
      {/* Page header */}
      <div className="flex w-full shrink-0 flex-row items-center justify-between gap-3">
        <Button
          component={Link}
          href="/jobs"
          variant="outlined"
          size="small"
          sx={{ bgcolor: "#fff", flexShrink: 0 }}
        >
          View Jobs
        </Button>
      </div>

      {/* Queue KPI cards */}
      <div className="flex shrink-0 flex-wrap items-stretch gap-3">
        {kpiCards.map((card) => (
          <Card
            key={card.label}
            className="min-w-[150px] flex-1 cursor-pointer transition-shadow hover:shadow-md"
            onClick={() => setActiveTab(card.tab)}
          >
            <CardContent sx={{ px: 1.5, py: 1, "&:last-child": { pb: 1 } }}>
              <Typography
                variant="body2"
                sx={{ color: "text.secondary", fontWeight: 600 }}
              >
                {card.label}
              </Typography>
              <Typography
                sx={{ fontSize: 24, fontWeight: 800, lineHeight: 1.1 }}
              >
                {card.value}
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  color: card.hintColor,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  fontSize: 10.5,
                }}
              >
                {card.hint}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </div>

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

      {/* Queue tabs */}
      <div className="shrink-0 border-b border-slate-200">
        <Tabs
          value={activeTab}
          onChange={(_event, value: QueueTab) => setActiveTab(value)}
          sx={{
            minHeight: 44,
            "& .MuiTab-root": {
              minHeight: 44,
              px: 2,
              fontSize: 14,
              fontWeight: 600,
              textTransform: "none",
              color: "#64748b",
            },
            "& .MuiTab-root.Mui-selected": { color: "#0f172a" },
            "& .MuiTabs-indicator": { backgroundColor: "#1e3a8a" },
          }}
        >
          <Tab
            value="requests"
            label={
              <span className="flex items-center gap-1.5">
                Job Requests
                <span
                  className={tabBadgeClass(
                    pendingCount,
                    "bg-amber-100 text-amber-700",
                  )}
                >
                  {pendingCount}
                </span>
              </span>
            }
          />
          <Tab
            value="cancellations"
            label={
              <span className="flex items-center gap-1.5">
                Cancellations
                <span
                  className={tabBadgeClass(
                    cancelCount,
                    "bg-red-100 text-red-700",
                  )}
                >
                  {cancelCount}
                </span>
              </span>
            }
          />
          <Tab
            value="closures"
            label={
              <span className="flex items-center gap-1.5">
                Closures
                <span
                  className={tabBadgeClass(
                    closureCount,
                    "bg-blue-100 text-blue-700",
                  )}
                >
                  {closureCount}
                </span>
              </span>
            }
          />
          <Tab
            value="history"
            label={
              <span className="flex items-center gap-1.5">
                Request History
                <span
                  className={tabBadgeClass(
                    historyCount,
                    "bg-slate-200 text-slate-700",
                  )}
                >
                  {historyCount}
                </span>
              </span>
            }
          />
        </Tabs>
      </div>

      {activeTab === "requests" && (
        <Paper className="flex shrink-0 flex-col overflow-hidden xl:min-h-0 xl:flex-1">
          <div className="slim-scroll flex flex-col xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
            <Table size="small" sx={tableSx}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: "16%" }}>Job</TableCell>
                  <TableCell sx={{ width: "20%" }}>Driver</TableCell>
                  <TableCell sx={{ width: "14%" }}>Cargo</TableCell>
                  <TableCell sx={{ width: "14%" }}>Pickup</TableCell>
                  <TableCell sx={{ width: "12%" }}>Requested</TableCell>
                  <TableCell align="right" sx={{ width: "24%" }}>
                    Decision
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {requests === null && !error && (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                      <CircularProgress size={28} />
                    </TableCell>
                  </TableRow>
                )}

                {error && (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                      <Typography
                        variant="body2"
                        sx={{ color: "#b91c1c", fontWeight: 600 }}
                      >
                        {error}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{ color: "text.secondary" }}
                      >
                        Is the backend running on port 4000?
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}

                {requests?.map((request) => {
                  const busy = busyId === request.id;
                  return (
                    <TableRow
                      key={request.id}
                      hover
                      sx={{ "&:last-child td": { border: 0 } }}
                    >
                      <TableCell>
                        <Typography
                          variant="body2"
                          component={Link}
                          href={`/jobs/${request.job.id}`}
                          sx={{
                            fontWeight: 700,
                            color: "#1d4ed8",
                            textDecoration: "none",
                            "&:hover": { textDecoration: "underline" },
                          }}
                        >
                          {request.job.jobNumber}
                        </Typography>
                        <Typography
                          variant="caption"
                          component="div"
                          sx={{
                            color: "text.secondary",
                            display: "block",
                            mt: 0.25,
                          }}
                        >
                          {request.job.pickup ?? "?"} →{" "}
                          {request.job.delivery ?? "?"}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <Avatar
                            sx={{
                              width: 34,
                              height: 34,
                              fontSize: 13,
                              bgcolor: "#e0f2fe",
                              color: "#0369a1",
                            }}
                          >
                            {initials(request.driver.name)}
                          </Avatar>
                          <div>
                            <div className="flex items-center gap-0.5">
                              <Typography
                                variant="body2"
                                sx={{ fontWeight: 600, whiteSpace: "nowrap" }}
                              >
                                {request.driver.name}
                              </Typography>
                              {request.driver.verified && (
                                <VerifiedRoundedIcon
                                  sx={{ fontSize: 14, color: "#0ea5e9" }}
                                />
                              )}
                            </div>
                            <Typography
                              variant="caption"
                              sx={{ color: "#94a3b8" }}
                            >
                              {request.driver.phone}
                            </Typography>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell
                        sx={{ whiteSpace: "nowrap", color: "text.secondary" }}
                      >
                        {request.job.quantity ?? request.job.cargo}
                      </TableCell>
                      <TableCell
                        sx={{ whiteSpace: "nowrap", color: "text.secondary" }}
                      >
                        {new Date(request.job.pickupAt).toLocaleString(
                          undefined,
                          {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          },
                        )}
                      </TableCell>
                      <TableCell
                        sx={{ whiteSpace: "nowrap", color: "text.secondary" }}
                      >
                        {timeAgo(request.requestedAt)}
                      </TableCell>
                      <TableCell align="right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="small"
                            variant="contained"
                            color="success"
                            disabled={busy}
                            startIcon={
                              busy ? (
                                <CircularProgress size={14} color="inherit" />
                              ) : (
                                <CheckRoundedIcon />
                              )
                            }
                            onClick={() => decide(request, "APPROVED")}
                          >
                            Approve
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            color="error"
                            disabled={busy}
                            startIcon={<CloseRoundedIcon />}
                            onClick={() => decide(request, "REJECTED")}
                          >
                            Reject
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {requests !== null && requests.length === 0 && !error && (
              <div className="flex flex-1 flex-row items-center justify-center gap-2 py-8">
                <InboxRoundedIcon sx={{ fontSize: 18, color: "#cbd5e1" }} />
                <Typography
                  variant="body2"
                  sx={{ color: "text.secondary", fontWeight: 600 }}
                >
                  No pending requests
                </Typography>
              </div>
            )}
          </div>
        </Paper>
      )}

      {activeTab === "history" && (
        <Paper className="flex shrink-0 flex-col overflow-hidden xl:min-h-0 xl:flex-1">
          <div className="slim-scroll flex flex-col xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
            <Table size="small" sx={tableSx}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: "12%" }}>Type</TableCell>
                  <TableCell sx={{ width: "18%" }}>Job</TableCell>
                  <TableCell sx={{ width: "22%" }}>Driver</TableCell>
                  <TableCell sx={{ width: "23%" }}>Route</TableCell>
                  <TableCell sx={{ width: "12%" }}>Decision</TableCell>
                  <TableCell sx={{ width: "13%" }}>Reviewed</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {requestHistory === null && !error && (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                      <CircularProgress size={28} />
                    </TableCell>
                  </TableRow>
                )}

                {requestHistory?.map((request) => {
                  const typeMeta = REQUEST_TYPE_META[request.type];
                  return (
                    <TableRow
                      key={request.id}
                      hover
                      sx={{ "&:last-child td": { border: 0 } }}
                    >
                      <TableCell>
                        <Chip
                          size="small"
                          label={typeMeta.label}
                          sx={{
                            bgcolor: typeMeta.bg,
                            color: typeMeta.fg,
                            fontWeight: 700,
                            fontSize: 11,
                            height: 22,
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <Typography
                          variant="body2"
                          component={Link}
                          href={`/jobs/${request.job.id}`}
                          sx={{
                            fontWeight: 700,
                            color: "#1d4ed8",
                            textDecoration: "none",
                            "&:hover": { textDecoration: "underline" },
                          }}
                        >
                          {request.job.jobNumber}
                        </Typography>
                        <Typography
                          variant="caption"
                          component="div"
                          sx={{ color: "text.secondary", display: "block", mt: 0.25 }}
                        >
                          {request.job.cargo}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <Avatar
                            sx={{
                              width: 34,
                              height: 34,
                              fontSize: 13,
                              bgcolor: "#e0f2fe",
                              color: "#0369a1",
                            }}
                          >
                            {initials(request.driver.name)}
                          </Avatar>
                          <div>
                            <div className="flex items-center gap-0.5">
                              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                {request.driver.name}
                              </Typography>
                              {request.driver.verified && (
                                <VerifiedRoundedIcon
                                  sx={{ fontSize: 14, color: "#0ea5e9" }}
                                />
                              )}
                            </div>
                            <Typography variant="caption" sx={{ color: "#94a3b8" }}>
                              {request.driver.phone}
                            </Typography>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ color: "text.secondary" }}>
                          {request.job.pickup ?? "?"} → {request.job.delivery ?? "?"}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <StatusChip status={request.decision} />
                      </TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap", color: "text.secondary" }}>
                        {timeAgo(request.decidedAt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {requestHistory !== null && requestHistory.length === 0 && !error && (
              <div className="flex flex-1 flex-row items-center justify-center gap-2 py-8">
                <InboxRoundedIcon sx={{ fontSize: 18, color: "#cbd5e1" }} />
                <Typography variant="body2" sx={{ color: "text.secondary", fontWeight: 600 }}>
                  No approved or rejected requests yet
                </Typography>
              </div>
            )}
          </div>
        </Paper>
      )}

      {activeTab === "cancellations" && (
        <Paper className="flex shrink-0 flex-col overflow-hidden xl:min-h-0 xl:flex-1">
          <div className="slim-scroll xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
            <Table size="small" sx={tableSx}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: "18%" }}>Job</TableCell>
                  <TableCell sx={{ width: "14%" }}>Driver</TableCell>
                  <TableCell sx={{ width: "38%" }}>Reason</TableCell>
                  <TableCell align="right" sx={{ width: "30%" }}>
                    Decision
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {cancelJobs === null && !error && (
                  <TableRow>
                    <TableCell colSpan={4} align="center" sx={{ py: 6 }}>
                      <CircularProgress size={28} />
                    </TableCell>
                  </TableRow>
                )}

                {cancelJobs !== null && cancelJobs.length === 0 && !error && (
                  <TableRow>
                    <TableCell colSpan={4} align="center" sx={{ py: 7 }}>
                      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5">
                        <InboxRoundedIcon
                          sx={{ fontSize: 18, color: "#cbd5e1" }}
                        />
                        <Typography
                          variant="body2"
                          sx={{ color: "text.secondary", fontWeight: 600 }}
                        >
                          No cancellation requests
                        </Typography>
                        <Typography variant="caption" sx={{ color: "#94a3b8" }}>
                          When a driver asks to cancel a trip over WhatsApp, it
                          shows up here.
                        </Typography>
                      </div>
                    </TableCell>
                  </TableRow>
                )}

                {cancelJobs?.map((job) => {
                  const busy = cancelBusyId === job.id;
                  return (
                    <TableRow
                      key={job.id}
                      hover
                      sx={{ "&:last-child td": { border: 0 } }}
                    >
                      <TableCell>
                        <Typography
                          variant="body2"
                          component={Link}
                          href={`/jobs/${job.id}`}
                          sx={{
                            fontWeight: 700,
                            color: "#1d4ed8",
                            textDecoration: "none",
                            "&:hover": { textDecoration: "underline" },
                          }}
                        >
                          {job.jobNumber}
                        </Typography>
                        <Typography
                          variant="caption"
                          component="div"
                          sx={{
                            color: "text.secondary",
                            display: "block",
                            mt: 0.25,
                          }}
                        >
                          {job.pickup ?? "?"} → {job.delivery ?? "?"}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>
                        {job.driver ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Typography
                          variant="body2"
                          sx={{ color: "text.secondary" }}
                        >
                          {job.cancellationReason ?? "not given"}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="small"
                            variant="outlined"
                            color="warning"
                            disabled={busy}
                            startIcon={<CloseRoundedIcon />}
                            onClick={() => actCancel(job, "reject")}
                          >
                            Reject request
                          </Button>
                          <Button
                            size="small"
                            variant="contained"
                            color="success"
                            disabled={busy}
                            startIcon={
                              busy ? (
                                <CircularProgress size={14} color="inherit" />
                              ) : (
                                <CheckRoundedIcon />
                              )
                            }
                            onClick={() => actCancel(job, "release")}
                          >
                            Accept & release driver
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Paper>
      )}

      {activeTab === "closures" && (
        <Paper className="flex shrink-0 flex-col overflow-hidden xl:min-h-0 xl:flex-1">
          <div className="slim-scroll xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
            <Table size="small" sx={tableSx}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: "18%" }}>Job</TableCell>
                  <TableCell sx={{ width: "14%" }}>Driver</TableCell>
                  <TableCell sx={{ width: "14%" }}>Cargo</TableCell>
                  <TableCell sx={{ width: "18%" }}>Status</TableCell>
                  <TableCell align="right" sx={{ width: "36%" }}>
                    Decision
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {closureJobs === null && !error && (
                  <TableRow>
                    <TableCell colSpan={5} align="center" sx={{ py: 6 }}>
                      <CircularProgress size={28} />
                    </TableCell>
                  </TableRow>
                )}

                {closureJobs !== null && closureJobs.length === 0 && !error && (
                  <TableRow>
                    <TableCell colSpan={5} align="center" sx={{ py: 7 }}>
                      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5">
                        <InboxRoundedIcon
                          sx={{ fontSize: 18, color: "#cbd5e1" }}
                        />
                        <Typography
                          variant="body2"
                          sx={{ color: "text.secondary", fontWeight: 600 }}
                        >
                          No trips awaiting closure
                        </Typography>
                        <Typography variant="caption" sx={{ color: "#94a3b8" }}>
                          When a trip is delivered or sent for closure, it shows
                          up here.
                        </Typography>
                      </div>
                    </TableCell>
                  </TableRow>
                )}

                {closureJobs?.map((job) => {
                  const busy = closureBusyId === job.id;
                  return (
                    <TableRow
                      key={job.id}
                      hover
                      sx={{ "&:last-child td": { border: 0 } }}
                    >
                      <TableCell>
                        <Typography
                          variant="body2"
                          component={Link}
                          href={`/jobs/${job.id}`}
                          sx={{
                            fontWeight: 700,
                            color: "#1d4ed8",
                            textDecoration: "none",
                            "&:hover": { textDecoration: "underline" },
                          }}
                        >
                          {job.jobNumber}
                        </Typography>
                        <Typography
                          variant="caption"
                          component="div"
                          sx={{
                            color: "text.secondary",
                            display: "block",
                            mt: 0.25,
                          }}
                        >
                          {job.pickup ?? "?"} → {job.delivery ?? "?"}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>
                        {job.driver ?? "—"}
                      </TableCell>
                      <TableCell
                        sx={{ whiteSpace: "nowrap", color: "text.secondary" }}
                      >
                        {job.quantity ?? job.cargo}
                      </TableCell>
                      <TableCell>
                        <StatusChip status={job.status} />
                      </TableCell>
                      <TableCell align="right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="small"
                            variant="contained"
                            color="success"
                            disabled={busy}
                            startIcon={
                              busy ? (
                                <CircularProgress size={14} color="inherit" />
                              ) : (
                                <CheckRoundedIcon />
                              )
                            }
                            onClick={() => actClosure(job)}
                          >
                            Approve & Close
                          </Button>
                          <Button
                            component={Link}
                            href={`/jobs/${job.id}`}
                            size="small"
                            variant="outlined"
                            sx={{ bgcolor: "#fff" }}
                          >
                            View
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Paper>
      )}
    </div>
  );
}
