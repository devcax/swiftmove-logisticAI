"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Snackbar from "@mui/material/Snackbar";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import BlockRoundedIcon from "@mui/icons-material/BlockRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import PowerSettingsNewRoundedIcon from "@mui/icons-material/PowerSettingsNewRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import StatusChip from "@/components/StatusChip";
import { activateJob, createJob, deactivateJob, deleteJob, fetchJob, fetchJobIdentifiers, fetchJobs, updateJob, type ApiJobSummary } from "@/lib/api";
import { type Job, type JobStatus } from "@/lib/data";

const tabs: ("ALL" | JobStatus)[] = ["ALL", "PUBLISHED", "ACTIVE", "COMPLETED", "CANCELLED"];

const cardLabel: Record<string, string> = {
  ALL: "All Jobs",
  PUBLISHED: "Published Jobs",
  ACTIVE: "Active Jobs",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const cardHint: Record<string, { text: string; color: string }> = {
  ALL: { text: "Every status", color: "#64748b" },
  PUBLISHED: { text: "In the pool", color: "#2563eb" },
  ACTIVE: { text: "On the road", color: "#16a34a" },
  COMPLETED: { text: "Delivered", color: "#64748b" },
  CANCELLED: { text: "Deactivated", color: "#dc2626" },
};

const units = ["Pallets", "Boxes", "Tons", "Units", "Containers"];
const MAX_DELIVERY_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

function formatWindow(pickupAt: string | null, deliveryAt: string | null) {
  const fmt = (value: string | null) =>
    value
      ? new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
      : "-";
  if (!pickupAt && !deliveryAt) return "Not scheduled";
  return `${fmt(pickupAt)} → ${fmt(deliveryAt)}`;
}

function toLocalInput(value: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// A datetime-local input holds a bare wall clock ("2026-09-07T10:00") with no
// timezone, so it must be resolved to a real instant here - in the browser,
// where the user's timezone is - before it goes to the API.
function fromLocalInput(value: string) {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

// Earliest pickup a manager can pick: 1 hour from now (so "today" stays
// selectable, not just "tomorrow").
function oneHourFromNowLocalInput() {
  return toLocalInput(new Date(Date.now() + 60 * 60 * 1000).toISOString());
}

// Drivers only get offered a published job if its pickup falls within the
// next 24 hours (see backend jobOffers.offerPublishedJob) - jobs scheduled
// further out won't be sent to anyone until they roll inside that window.
const DRIVER_DISCOVERY_WINDOW_NOTE =
  "Drivers are only notified once the pickup time is within 24 hours — jobs scheduled further out won't reach anyone until then.";

function mapJob(job: ApiJobSummary): Job {
  return {
    id: job.id,
    jobNumber: job.jobNumber,
    status: job.status as JobStatus,
    assignmentStatus: job.assignmentStatus,
    origin: job.pickup ?? "—",
    destination: job.delivery ?? "—",
    window: formatWindow(job.pickupAt, job.deliveryAt),
    cargo: job.cargo ?? "General cargo",
    quantity: job.quantity ?? "—",
    driver: job.driver,
  };
}

function latestStatus(job: Job) {
  if (
    job.status === "MANAGER_APPROVED" &&
    job.assignmentStatus === "PENDING_DRIVER_ACCEPTANCE"
  ) {
    return job.assignmentStatus;
  }
  return job.status;
}

const LOCAL_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function localIdentifiers() {
  const code = (prefix: string) =>
    `${prefix}-${Array.from({ length: 6 }, () => LOCAL_CODE_ALPHABET[Math.floor(Math.random() * LOCAL_CODE_ALPHABET.length)]).join("")}`;
  return {
    jobNumber: `JOB-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 100).toString().padStart(2, "0")}`,
    pickupCode: code("PU"),
    deliveryCode: code("DL"),
  };
}

const fieldLabelSx = {
  color: "#64748b",
  fontWeight: 700,
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  mb: 0.5,
  display: "block",
} as const;

export default function JobsPage() {
  const router = useRouter();
  const [jobList, setJobList] = React.useState<Job[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [tab, setTab] = React.useState<"ALL" | JobStatus>("ALL");
  const [query, setQuery] = React.useState("");
  const [snackbar, setSnackbar] = React.useState<{ severity: "success" | "error"; message: string } | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [minPickupAt, setMinPickupAt] = React.useState("");
  const [rowAction, setRowAction] = React.useState<{ id: string; action: "activate" | "deactivate" | "delete" } | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<Job | null>(null);
  const [rowPending, startRowTransition] = React.useTransition();
  const [editPending, startEditTransition] = React.useTransition();
  const [editTarget, setEditTarget] = React.useState<Job | null>(null);
  const [editLoading, setEditLoading] = React.useState(false);
  const [editForm, setEditForm] = React.useState({
    pickupLocation: "",
    deliveryLocation: "",
    pickupAt: "",
    deliveryAt: "",
    cargo: "",
    quantity: "",
    unit: "Pallets",
    instructions: "",
  });


  const [form, setForm] = React.useState({
    jobNumber: "",
    pickupLocation: "",
    deliveryLocation: "",
    pickupAt: "",
    deliveryAt: "",
    cargo: "",
    quantity: "",
    unit: "Pallets",
    instructions: "",
    pickupCode: "",
    deliveryCode: "",
  });

  const loadJobs = React.useCallback(async () => {
    try {
      const data = await fetchJobs();
      setJobList(data.map(mapJob));
      setLoadError(null);
    } catch (err) {
      setJobList([]);
      setLoadError(err instanceof Error ? err.message : "Could not load jobs.");
    }
  }, []);

  React.useEffect(() => {
    void loadJobs();
    const timer = window.setInterval(() => void loadJobs(), 5_000);
    return () => window.clearInterval(timer);
  }, [loadJobs]);

  const loadIdentifiers = React.useCallback(async () => {
    try {
      const ids = await fetchJobIdentifiers();
      setForm((prev) => ({ ...prev, ...ids }));
    } catch {
      setForm((prev) => ({ ...prev, ...localIdentifiers() }));
    }
  }, []);

  const jobs = jobList ?? [];

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));


  const minPickupTime = minPickupAt ? new Date(minPickupAt).getTime() : null;
  const pickupTime = form.pickupAt ? new Date(form.pickupAt).getTime() : null;
  const deliveryTime = form.deliveryAt ? new Date(form.deliveryAt).getTime() : null;
  const pickupError = pickupTime !== null && minPickupTime !== null && pickupTime < minPickupTime;
  const deliveryBeforePickup = pickupTime !== null && deliveryTime !== null && deliveryTime <= pickupTime;
  const deliveryTooLate = pickupTime !== null && deliveryTime !== null && deliveryTime > pickupTime + MAX_DELIVERY_WINDOW_MS;
  const deliveryError = deliveryBeforePickup || deliveryTooLate;
  const maxDeliveryAt = pickupTime === null
    ? undefined
    : toLocalInput(new Date(pickupTime + MAX_DELIVERY_WINDOW_MS).toISOString());

  const isValid =
    form.pickupLocation.trim() !== "" &&
    form.deliveryLocation.trim() !== "" &&
    form.cargo.trim() !== "" &&
    form.quantity.trim() !== "" &&
    pickupTime !== null &&
    minPickupTime !== null &&
    pickupTime >= minPickupTime &&
    deliveryTime !== null &&
    deliveryTime > pickupTime &&
    deliveryTime <= pickupTime + MAX_DELIVERY_WINDOW_MS;

  const submitJob = async () => {
    if (!isValid || submitting) return;

    setSubmitting(true);
    try {
      const created = await createJob({
        jobNumber: form.jobNumber || undefined,
        pickupLocation: form.pickupLocation.trim(),
        deliveryLocation: form.deliveryLocation.trim(),
        pickupAt: fromLocalInput(form.pickupAt),
        deliveryAt: fromLocalInput(form.deliveryAt),
        cargo: form.cargo.trim(),
        quantity: form.quantity.trim(),
        unit: form.unit,
        instructions: form.instructions.trim() || undefined,
        pickupCode: form.pickupCode || undefined,
        deliveryCode: form.deliveryCode || undefined,
        status: "PUBLISHED",
      });
      const job = mapJob(created);
      const next = [job, ...jobs];
      setJobList(next);
      setForm((prev) => ({
        ...prev,
        pickupLocation: "",
        deliveryLocation: "",
        pickupAt: "",
        deliveryAt: "",
        cargo: "",
        quantity: "",
        instructions: "",
        jobNumber: "",
        pickupCode: "",
        deliveryCode: "",
      }));
      setTab("PUBLISHED");
      setCreateOpen(false);
      setSnackbar({
        severity: "success",
        message: `${job.jobNumber} published! Matching drivers are being notified on WhatsApp`,
      });
    } catch (err) {
      setSnackbar({
        severity: "error",
        message: err instanceof Error ? err.message : "Could not save the job. Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const countFor = (value: "ALL" | JobStatus) =>
    value === "ALL" ? jobs.length : jobs.filter((job) => job.status === value).length;

  const isRowBusy = (id: string | undefined) => rowPending && rowAction !== null && rowAction.id === id;

  const isRowActionPending = (id: string | undefined, action: "activate" | "deactivate" | "delete") =>
    rowPending && rowAction !== null && rowAction.id === id && rowAction.action === action;

  const setEdit = (key: keyof typeof editForm) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setEditForm((prev) => ({ ...prev, [key]: event.target.value }));

  const editValid =
    editForm.pickupLocation.trim() !== "" && editForm.deliveryLocation.trim() !== "" && editForm.cargo.trim() !== "";

  const handleDeactivate = (job: Job) => {
    if (!job.id || rowPending) return;
    const id = job.id;
    setRowAction({ id, action: "deactivate" });
    startRowTransition(async () => {
      try {
        await deactivateJob(id);
        setJobList((prev) => (prev ?? []).map((j) => (j.id === id ? { ...j, status: "CANCELLED" as JobStatus } : j)));
        setSnackbar({ severity: "success", message: `${job.jobNumber} deactivated` });
      } catch (err) {
        setSnackbar({
          severity: "error",
          message: err instanceof Error ? err.message : "Could not deactivate the job. Please try again.",
        });
      } finally {
        setRowAction(null);
      }
    });
  };


  const handleActivate = (job: Job) => {
    if (!job.id || rowPending) return;
    const id = job.id;
    setRowAction({ id, action: "activate" });
    startRowTransition(async () => {
      try {
        await activateJob(id);
        setJobList((prev) => (prev ?? []).map((j) => (j.id === id ? { ...j, status: "PUBLISHED" as JobStatus } : j)));
        setSnackbar({ severity: "success", message: `${job.jobNumber} reactivated and published to the driver pool` });
      } catch (err) {
        setSnackbar({
          severity: "error",
          message: err instanceof Error ? err.message : "Could not reactivate the job. Please try again.",
        });
      } finally {
        setRowAction(null);
      }
    });
  };

  const confirmDelete = () => {
    if (!deleteTarget?.id || rowPending) return;
    const job = deleteTarget;
    const id = job.id as string;
    setRowAction({ id, action: "delete" });
    startRowTransition(async () => {
      try {
        await deleteJob(id);
        setJobList((prev) => (prev ?? []).filter((j) => j.id !== id));
        setDeleteTarget(null);
        setSnackbar({ severity: "success", message: `${job.jobNumber} deleted` });
      } catch (err) {
        setSnackbar({
          severity: "error",
          message: err instanceof Error ? err.message : "Could not delete the job. Please try again.",
        });
      } finally {
        setRowAction(null);
      }
    });
  };

  const openEdit = async (job: Job) => {
    if (!job.id) return;
    setEditTarget(job);
    setEditLoading(true);
    try {
      const detail = await fetchJob(job.id);
      const pickup = detail.stops.find((s) => s.type === "PICKUP");
      const delivery = detail.stops.find((s) => s.type === "DELIVERY");
      const item = detail.items[0];
      setEditForm({
        pickupLocation: pickup?.name ?? "",
        deliveryLocation: delivery?.name ?? "",
        pickupAt: toLocalInput(detail.pickupAt),
        deliveryAt: toLocalInput(detail.deliveryAt),
        cargo: detail.cargo ?? "",
        quantity: item?.quantityValue != null ? String(item.quantityValue) : "",
        unit: units.find((u) => u.toLowerCase() === String(item?.unit ?? "").toLowerCase()) ?? "Pallets",
        instructions: detail.specialInstructions ?? "",
      });
    } catch (err) {
      setEditTarget(null);
      setSnackbar({
        severity: "error",
        message: err instanceof Error ? err.message : "Could not load the job details. Please try again.",
      });
    } finally {
      setEditLoading(false);
    }
  };

  const submitEdit = () => {
    if (!editTarget?.id || !editValid || editPending) return;
    const id = editTarget.id;
    startEditTransition(async () => {
      try {
        const updated = await updateJob(id, {
          pickupLocation: editForm.pickupLocation.trim(),
          deliveryLocation: editForm.deliveryLocation.trim(),
          pickupAt: fromLocalInput(editForm.pickupAt),
          deliveryAt: fromLocalInput(editForm.deliveryAt),
          cargo: editForm.cargo.trim(),
          quantity: editForm.quantity.trim(),
          unit: editForm.unit,
          instructions: editForm.instructions.trim() || undefined,
        });
        setJobList((prev) => (prev ?? []).map((j) => (j.id === updated.id ? mapJob(updated) : j)));
        setEditTarget(null);
        setSnackbar({ severity: "success", message: `${updated.jobNumber} updated` });
      } catch (err) {
        setSnackbar({
          severity: "error",
          message: err instanceof Error ? err.message : "Could not update the job. Please try again.",
        });
      }
    });
  };

  const visibleJobs = jobs
    .filter((job) => tab === "ALL" || job.status === tab)
    .filter(
      (job) =>
        query.trim() === "" ||
        job.jobNumber.toLowerCase().includes(query.toLowerCase()) ||
        (job.driver ?? "").toLowerCase().includes(query.toLowerCase()) ||
        job.origin.toLowerCase().includes(query.toLowerCase()) ||
        job.destination.toLowerCase().includes(query.toLowerCase()),
    );

  return (
    <div className="mx-auto flex h-full w-full max-w-[1500px] flex-col overflow-y-auto p-4 sm:p-6 xl:overflow-hidden">
      {/* Status KPI cards*/}
      <div className="mb-5 flex shrink-0 flex-wrap gap-3">
        {tabs.map((value) => {
          const selected = tab === value;
          const hint = cardHint[value];
          return (
            <Card
              key={value}
              className="min-w-[140px] flex-1"
              onClick={() => setTab(value)}
              sx={{
                cursor: "pointer",
                bgcolor: selected ? "#eff6ff" : "#fff",
                transition: "background-color 0.15s ease",
              }}
            >
              <CardContent sx={{ px: 1.5, py: 1, "&:last-child": { pb: 1 } }}>
                <Typography
                  variant="body2"
                  sx={{ color: selected ? "text.primary" : "text.secondary", fontWeight: selected ? 700 : 600 }}
                >
                  {cardLabel[value]}
                </Typography>
                <Typography sx={{ fontSize: 24, fontWeight: 800, lineHeight: 1.1 }}>{countFor(value)}</Typography>
                <Typography
                  variant="caption"
                  sx={{
                    color: hint.color,
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    fontSize: 10.5,
                  }}
                >
                  {hint.text}
                </Typography>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Jobs table */}
      <Paper className="flex shrink-0 flex-col xl:min-h-0 xl:flex-1">
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-4">
          <div className="mr-auto">
            <Typography variant="subtitle1">Job Management</Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              Showing {visibleJobs.length} of {jobs.length} jobs
            </Typography>
          </div>
          <TextField
            size="small"
            placeholder="Filter jobs"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            sx={{
              width: { xs: "100%", sm: 190 },
              "& .MuiOutlinedInput-root": { bgcolor: "#f6f8fb", borderRadius: 1, fontSize: 13 },
              "& .MuiOutlinedInput-input": { py: 0.75 },
            }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRoundedIcon fontSize="small" sx={{ color: "#94a3b8" }} />
                  </InputAdornment>
                ),
              },
            }}
          />
          <Button
            variant="contained"
            startIcon={<AddRoundedIcon />}
            onClick={() => {
              setCreateOpen(true);
              setMinPickupAt(oneHourFromNowLocalInput());
              void loadIdentifiers();
            }}
            sx={{ bgcolor: "#1e3a8a", "&:hover": { bgcolor: "#172554" } }}
          >
            Create Job
          </Button>
        </div>

          {/* Jobs table */}
          <div className="slim-scroll xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
          <Table
            size="small"
            sx={{
              tableLayout: "fixed",
              width: "100%",
              "& .MuiTableCell-root": {
                px: 1,
                verticalAlign: "middle",
                whiteSpace: "normal",
                overflowWrap: "break-word",
              },
              "& .MuiTableCell-root:first-of-type": { pl: 2 },
              "& .MuiTableCell-root:last-of-type": { pr: 2 },
            }}
          >
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: "10%" }}>Job</TableCell>
                <TableCell sx={{ width: "12%" }}>Driver</TableCell>
                <TableCell sx={{ width: "21%" }}>Route</TableCell>
                <TableCell sx={{ width: "14%" }}>Cargo</TableCell>
                <TableCell sx={{ width: "16%" }}>Window</TableCell>
                <TableCell sx={{ width: "13%" }}>Status</TableCell>
                <TableCell align="right" sx={{ width: "14%" }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {jobList === null && (
                <TableRow>
                  <TableCell colSpan={7}>
                    <div className="flex items-center justify-center gap-2 py-12">
                      <CircularProgress size={20} sx={{ color: "#2563eb" }} />
                      <Typography variant="body2" sx={{ color: "text.secondary" }}>
                        Loading jobs…
                      </Typography>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {jobList !== null && loadError && (
                <TableRow>
                  <TableCell colSpan={7}>
                    <Alert
                      severity="warning"
                      sx={{ m: 2, borderRadius: 2 }}
                      action={
                        <Button color="inherit" size="small" onClick={() => void loadJobs()}>
                          Retry
                        </Button>
                      }
                    >
                      {loadError}
                    </Alert>
                  </TableCell>
                </TableRow>
              )}
              {visibleJobs.map((job) => (
                <TableRow
                  key={job.id ?? job.jobNumber}
                  hover
                  tabIndex={0}
                  onClick={() => job.id && router.push(`/jobs/${job.id}`)}
                  onKeyDown={(event) => {
                    if (job.id && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault();
                      router.push(`/jobs/${job.id}`);
                    }
                  }}
                  sx={{
                    cursor: job.id ? "pointer" : "default",
                    "&:last-child td": { border: 0 },
                  }}
                >
                  <TableCell>
                    <Typography
                      component={Link}
                      href={`/jobs/${job.id}`}
                      variant="body2"
                      sx={{
                        fontWeight: 800,
                        color: "#1e3a8a",
                        textDecoration: "none",
                        "&:hover": { textDecoration: "underline" },
                      }}
                    >
                      {job.jobNumber}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {job.driver ? (
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {job.driver}
                      </Typography>
                    ) : (
                      <Typography variant="caption" sx={{ color: "#94a3b8" }}>
                        Unassigned
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[13px] text-slate-600">
                      <span className="min-w-0 break-words">{job.origin}</span>
                      <ArrowForwardRoundedIcon sx={{ fontSize: 14, color: "#94a3b8", flexShrink: 0 }} />
                      <span className="min-w-0 break-words font-semibold text-slate-800">{job.destination}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="min-w-0">
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {job.cargo}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{ color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase", fontSize: 10, display: "block" }}
                      >
                        {job.quantity}
                      </Typography>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ color: "text.secondary", fontSize: 13 }}>
                      {job.window}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <StatusChip status={latestStatus(job)} />
                    </div>
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{ whiteSpace: "nowrap" }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="flex items-center justify-end gap-2">
                      <Tooltip title="Edit job">
                        <span>
                          <IconButton
                            size="small"
                            sx={{ color: "#64748b" }}
                            disabled={isRowBusy(job.id)}
                            onClick={() => void openEdit(job)}
                          >
                            <EditRoundedIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip
                        title={
                          job.status === "COMPLETED"
                            ? "Job already completed"
                            : job.status === "CANCELLED"
                              ? "Reactivate job"
                              : "Deactivate job"
                        }
                      >
                        <span>
                          <IconButton
                            size="small"
                            sx={{ color: job.status === "CANCELLED" ? "#16a34a" : "#64748b" }}
                            disabled={isRowBusy(job.id) || job.status === "COMPLETED"}
                            onClick={() => (job.status === "CANCELLED" ? handleActivate(job) : handleDeactivate(job))}
                          >
                            {isRowActionPending(job.id, "deactivate") || isRowActionPending(job.id, "activate") ? (
                              <CircularProgress size={16} sx={{ color: "#64748b" }} />
                            ) : (
                              <PowerSettingsNewRoundedIcon fontSize="small" />
                            )}
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Delete job">
                        <span>
                          <IconButton
                            size="small"
                            sx={{ color: "#dc2626" }}
                            disabled={isRowBusy(job.id)}
                            onClick={() => setDeleteTarget(job)}
                          >
                            {isRowActionPending(job.id, "delete") ? (
                              <CircularProgress size={16} sx={{ color: "#dc2626" }} />
                            ) : (
                              <BlockRoundedIcon fontSize="small" />
                            )}
                          </IconButton>
                        </span>
                      </Tooltip>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {jobList !== null && visibleJobs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7}>
                    <div className="py-10 text-center">
                      <Typography variant="body2" sx={{ color: "text.secondary" }}>
                        No jobs match this view.
                      </Typography>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          </div>
        </Paper>

      {/* Create Job modal */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} fullWidth maxWidth="sm">
        <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-900">
            <AddRoundedIcon fontSize="small" />
          </span>
          <div className="mr-auto">
            <Typography variant="subtitle1">Create Job</Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              Publishes to matching drivers instantly
            </Typography>
          </div>
          <IconButton size="small" onClick={() => setCreateOpen(false)} aria-label="Close create job dialog">
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </div>

        <div className="flex flex-col gap-3 px-5 py-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Typography variant="caption" sx={fieldLabelSx}>Job number</Typography>
              <TextField
                fullWidth
                size="small"
                value={form.jobNumber}
                slotProps={{ input: { readOnly: true, sx: { bgcolor: "#f6f8fb", color: "text.secondary" } } }}
              />
            </div>
            <div>
              <Typography variant="caption" sx={fieldLabelSx}>Pickup code</Typography>
              <TextField
                fullWidth
                size="small"
                value={form.pickupCode}
                slotProps={{ input: { readOnly: true, sx: { bgcolor: "#f6f8fb", color: "text.secondary" } } }}
              />
            </div>
            <div>
              <Typography variant="caption" sx={fieldLabelSx}>Delivery code</Typography>
              <TextField
                fullWidth
                size="small"
                value={form.deliveryCode}
                slotProps={{ input: { readOnly: true, sx: { bgcolor: "#f6f8fb", color: "text.secondary" } } }}
              />
            </div>
          </div>
          <Typography variant="caption" sx={{ color: "#94a3b8", mt: -1, display: "block" }}>
            Identifiers are auto-generated. Share the security codes with site staff only, never with the driver.
          </Typography>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Typography variant="caption" sx={fieldLabelSx}>
                Pickup location <span className="text-red-600">*</span>
              </Typography>
              <TextField
                fullWidth
                size="small"
                required
                placeholder="e.g., Colombo Port, Gate 4"
                value={form.pickupLocation}
                onChange={set("pickupLocation")}
              />
            </div>
            <div>
              <Typography variant="caption" sx={fieldLabelSx}>
                Delivery location <span className="text-red-600">*</span>
              </Typography>
              <TextField
                fullWidth
                size="small"
                required
                placeholder="e.g., Kandy Distribution Centre"
                value={form.deliveryLocation}
                onChange={set("deliveryLocation")}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Typography variant="caption" sx={fieldLabelSx}>
                Pickup date &amp; time <span className="text-red-600">*</span>
              </Typography>
              <TextField
                fullWidth
                size="small"
                type="datetime-local"
                required
                value={form.pickupAt}
                onChange={set("pickupAt")}
                error={pickupError}
                helperText={pickupError ? "Pickup must be at least 1 hour from now" : undefined}
                slotProps={{ htmlInput: { min: minPickupAt } }}
              />
            </div>
            <div>
              <Typography variant="caption" sx={fieldLabelSx}>
                Delivery date &amp; time <span className="text-red-600">*</span>
              </Typography>
              <TextField
                fullWidth
                size="small"
                type="datetime-local"
                required
                value={form.deliveryAt}
                onChange={set("deliveryAt")}
                disabled={form.pickupAt === ""}
                error={deliveryError}
                helperText={
                  deliveryBeforePickup
                    ? "Delivery must be after the pickup time"
                    : deliveryTooLate
                      ? "Delivery must be within 2 days of pickup"
                      : undefined
                }
                slotProps={{ htmlInput: { min: form.pickupAt || undefined, max: maxDeliveryAt } }}
              />
            </div>
          </div>
          <Typography variant="caption" sx={{ color: "#94a3b8", display: "block", mt: -1.5 }}>
            {DRIVER_DISCOVERY_WINDOW_NOTE}
          </Typography>
          <div>
            <Typography variant="caption" sx={fieldLabelSx}>
              Cargo description <span className="text-red-600">*</span>
            </Typography>
            <TextField
              fullWidth
              size="small"
              required
              placeholder="e.g., Mixed FMCG cartons"
              value={form.cargo}
              onChange={set("cargo")}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Typography variant="caption" sx={fieldLabelSx}>
                Quantity <span className="text-red-600">*</span>
              </Typography>
              <TextField
                fullWidth
                size="small"
                type="number"
                required
                placeholder="e.g., 18"
                value={form.quantity}
                onChange={set("quantity")}
                slotProps={{ htmlInput: { min: 0 } }}
              />
            </div>
            <div>
              <Typography variant="caption" sx={fieldLabelSx}>
                Unit <span className="text-red-600">*</span>
              </Typography>
              <TextField fullWidth select size="small" required value={form.unit} onChange={set("unit")}>
                {units.map((unit) => (
                  <MenuItem key={unit} value={unit}>
                    {unit}
                  </MenuItem>
                ))}
              </TextField>
            </div>
          </div>
          <div>
            <Typography variant="caption" sx={fieldLabelSx}>
              Special instructions <span className="font-medium normal-case tracking-normal text-slate-400">(optional)</span>
            </Typography>
            <TextField
              fullWidth
              size="small"
              multiline
              minRows={2}
              placeholder="Handling notes, dock access, contact persons…"
              value={form.instructions}
              onChange={set("instructions")}
            />
          </div>

          <Button
            variant="contained"
            size="large"
            fullWidth
            onClick={() => void submitJob()}
            disabled={!isValid || submitting}
            startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : undefined}
            sx={{ bgcolor: "#1e3a8a", py: 1.2, "&:hover": { bgcolor: "#172554" } }}
          >
            {submitting ? "Publishing…" : "Publish Job"}
          </Button>
        </div>
      </Dialog>

      {/* Edit Job modal */}
      <Dialog
        open={editTarget !== null}
        onClose={() => {
          if (!editPending) setEditTarget(null);
        }}
        fullWidth
        maxWidth="sm"
      >
        <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-900">
            <EditRoundedIcon fontSize="small" />
          </span>
          <div className="mr-auto">
            <Typography variant="subtitle1">Edit Job</Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {editTarget ? `${editTarget.jobNumber} · draft and published jobs only` : ""}
            </Typography>
          </div>
          <IconButton
            size="small"
            onClick={() => setEditTarget(null)}
            disabled={editPending}
            aria-label="Close edit job dialog"
          >
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </div>

        {editLoading ? (
          <div className="flex items-center justify-center gap-2 p-12">
            <CircularProgress size={20} sx={{ color: "#2563eb" }} />
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              Loading job details…
            </Typography>
          </div>
        ) : (
          <div className="flex flex-col gap-4 p-5">
            <div>
              <Typography variant="caption" sx={fieldLabelSx}>Pickup location</Typography>
              <TextField fullWidth size="small" value={editForm.pickupLocation} onChange={setEdit("pickupLocation")} />
            </div>
            <div>
              <Typography variant="caption" sx={fieldLabelSx}>Delivery location</Typography>
              <TextField fullWidth size="small" value={editForm.deliveryLocation} onChange={setEdit("deliveryLocation")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Typography variant="caption" sx={fieldLabelSx}>Pickup date &amp; time</Typography>
                <TextField
                  fullWidth
                  size="small"
                  type="datetime-local"
                  value={editForm.pickupAt}
                  onChange={setEdit("pickupAt")}
                />
              </div>
              <div>
                <Typography variant="caption" sx={fieldLabelSx}>Delivery date &amp; time</Typography>
                <TextField
                  fullWidth
                  size="small"
                  type="datetime-local"
                  value={editForm.deliveryAt}
                  onChange={setEdit("deliveryAt")}
                />
              </div>
            </div>
            <Typography variant="caption" sx={{ color: "#94a3b8", display: "block", mt: -1.5 }}>
              {DRIVER_DISCOVERY_WINDOW_NOTE}
            </Typography>
            <div>
              <Typography variant="caption" sx={fieldLabelSx}>Cargo description</Typography>
              <TextField fullWidth size="small" value={editForm.cargo} onChange={setEdit("cargo")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Typography variant="caption" sx={fieldLabelSx}>Quantity</Typography>
                <TextField
                  fullWidth
                  size="small"
                  type="number"
                  value={editForm.quantity}
                  onChange={setEdit("quantity")}
                  slotProps={{ htmlInput: { min: 0 } }}
                />
              </div>
              <div>
                <Typography variant="caption" sx={fieldLabelSx}>Unit</Typography>
                <TextField fullWidth select size="small" value={editForm.unit} onChange={setEdit("unit")}>
                  {units.map((unit) => (
                    <MenuItem key={unit} value={unit}>
                      {unit}
                    </MenuItem>
                  ))}
                </TextField>
              </div>
            </div>
            <div>
              <Typography variant="caption" sx={fieldLabelSx}>Special instructions</Typography>
              <TextField
                fullWidth
                size="small"
                multiline
                minRows={2}
                placeholder="Handling notes, dock access, contact persons…"
                value={editForm.instructions}
                onChange={setEdit("instructions")}
              />
            </div>

            <Button
              variant="contained"
              size="large"
              fullWidth
              onClick={submitEdit}
              disabled={!editValid || editPending}
              startIcon={editPending ? <CircularProgress size={16} color="inherit" /> : undefined}
              sx={{ bgcolor: "#1e3a8a", py: 1.4, "&:hover": { bgcolor: "#172554" } }}
            >
              {editPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        )}
      </Dialog>

      {/* Delete confirmation*/}
      <Dialog
        open={deleteTarget !== null}
        onClose={() => {
          if (!isRowActionPending(deleteTarget?.id, "delete")) setDeleteTarget(null);
        }}
        fullWidth
        maxWidth="xs"
      >
        <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-50 text-red-600">
            <BlockRoundedIcon fontSize="small" />
          </span>
          <div className="mr-auto">
            <Typography variant="subtitle1">Delete job</Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              This action cannot be undone
            </Typography>
          </div>
          <IconButton
            size="small"
            onClick={() => setDeleteTarget(null)}
            disabled={isRowActionPending(deleteTarget?.id, "delete")}
            aria-label="Close delete confirmation"
          >
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </div>

        <div className="flex flex-col gap-4 p-5">
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Permanently delete <strong>{deleteTarget?.jobNumber}</strong>
            {deleteTarget ? ` (${deleteTarget.origin} → ${deleteTarget.destination})` : ""}? All requests, assignments
            and workflow history for this job will be removed.
          </Typography>
          <div className="flex gap-3">
            <Button
              variant="outlined"
              fullWidth
              onClick={() => setDeleteTarget(null)}
              disabled={isRowActionPending(deleteTarget?.id, "delete")}
            >
              Cancel
            </Button>
            <Button
              variant="contained"
              fullWidth
              onClick={confirmDelete}
              disabled={isRowActionPending(deleteTarget?.id, "delete")}
              startIcon={isRowActionPending(deleteTarget?.id, "delete") ? <CircularProgress size={16} color="inherit" /> : undefined}
              sx={{ bgcolor: "#dc2626", "&:hover": { bgcolor: "#b91c1c" } }}
            >
              {isRowActionPending(deleteTarget?.id, "delete") ? "Deleting…" : "Delete job"}
            </Button>
          </div>
        </div>
      </Dialog>

      <Snackbar open={snackbar !== null} anchorOrigin={{ vertical: "bottom", horizontal: "center" }} onClose={() => setSnackbar(null)}>
        <Alert severity={snackbar?.severity ?? "success"} variant="filled" onClose={() => setSnackbar(null)}>
          {snackbar?.message}
        </Alert>
      </Snackbar>
    </div>
  );
}
