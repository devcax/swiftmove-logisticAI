"use client";

import * as React from "react";
import Link from "next/link";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import AttachFileRoundedIcon from "@mui/icons-material/AttachFileRounded";
import CheckCircleOutlineRoundedIcon from "@mui/icons-material/CheckCircleOutlineRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import FormatQuoteRoundedIcon from "@mui/icons-material/FormatQuoteRounded";
import InboxRoundedIcon from "@mui/icons-material/InboxRounded";
import LocalOfferRoundedIcon from "@mui/icons-material/LocalOfferRounded";
import LocationOnRoundedIcon from "@mui/icons-material/LocationOnRounded";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import ReplayRoundedIcon from "@mui/icons-material/ReplayRounded";
import ReportProblemRoundedIcon from "@mui/icons-material/ReportProblemRounded";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";

import StatusChip from "@/components/StatusChip";
import {
  ApiIncidentDetail,
  ApiIncidentSummary,
  fetchIncident,
  fetchIncidents,
  incidentAction,
  releaseDriver,
  updateIncidentNotes,
} from "@/lib/api";

const SEVERITY_TONE: Record<string, { bg: string; fg: string }> = {
  CRITICAL: { bg: "#fee2e2", fg: "#b91c1c" },
  HIGH: { bg: "#ffedd5", fg: "#c2410c" },
  MEDIUM: { bg: "#fef3c7", fg: "#b45309" },
  LOW: { bg: "#e2e8f0", fg: "#475569" },
};

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  OPEN: { bg: "#fee2e2", fg: "#b91c1c" },
  UNDER_REVIEW: { bg: "#fef3c7", fg: "#b45309" },
  RESOLVED: { bg: "#dcfce7", fg: "#15803d" },
};

const FILTERS: { key: string; label: string }[] = [
  { key: "OPEN,UNDER_REVIEW", label: "Active" },
  { key: "OPEN", label: "Open" },
  { key: "UNDER_REVIEW", label: "Under review" },
  { key: "RESOLVED", label: "Resolved" },
  { key: "", label: "All" },
];

function humanize(value: string) {
  return value.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function fmtTime(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Badge({ label, tone }: { label: string; tone: { bg: string; fg: string } }) {
  return (
    <Chip
      size="small"
      label={label}
      sx={{ bgcolor: tone.bg, color: tone.fg, fontWeight: 700, fontSize: 11, height: 22 }}
    />
  );
}

export default function IncidentsPage() {
  const [filter, setFilter] = React.useState("OPEN,UNDER_REVIEW");
  const [incidents, setIncidents] = React.useState<ApiIncidentSummary[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<ApiIncidentDetail | null>(null);
  const [notes, setNotes] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async (status: string, showSpinner: boolean) => {
    if (showSpinner) setIncidents(null);
    try {
      setIncidents(await fetchIncidents(status ? { status } : undefined));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load incidents");
    }
  }, []);

  React.useEffect(() => {
    load(filter, true);
    const timer = setInterval(() => load(filter, false), 5000);
    return () => clearInterval(timer);
  }, [filter, load]);

  const openDetail = React.useCallback(async (id: string) => {
    setSelectedId(id);
    setDetail(null);
    try {
      const data = await fetchIncident(id);
      setDetail(data);
      setNotes(data.managerNotes ?? "");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to load incident");
    }
  }, []);

  const closeDetail = () => {
    setSelectedId(null);
    setDetail(null);
  };

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await load(filter, false);
      if (selectedId) await openDetail(selectedId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1500px] p-4 sm:p-6">
      {/* Filters */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Chip
            key={f.key}
            label={f.label}
            onClick={() => setFilter(f.key)}
            variant={filter === f.key ? "filled" : "outlined"}
            sx={
              filter === f.key
                ? { bgcolor: "#1e3a8a", color: "#fff", fontWeight: 700 }
                : { bgcolor: "#fff", fontWeight: 600 }
            }
          />
        ))}
        {incidents && (
          <Typography variant="caption" sx={{ ml: "auto", color: "#94a3b8" }}>
            {incidents.length} incident{incidents.length === 1 ? "" : "s"}
          </Typography>
        )}
      </div>

      {actionError && (
        <Paper sx={{ mb: 2, p: 1.5, bgcolor: "#fef2f2", border: "1px solid #fecaca" }}>
          <Typography variant="body2" sx={{ color: "#b91c1c", fontWeight: 600 }}>
            {actionError}
          </Typography>
        </Paper>
      )}

      <Paper>
        <div className="w-full overflow-x-auto">
        <Table
          size="small"
          sx={{
            tableLayout: "fixed",
            width: "100%",
            minWidth: 760,
            "& .MuiTableCell-root": { px: 1, verticalAlign: "middle", whiteSpace: "normal", overflowWrap: "break-word" },
            "& .MuiTableCell-root:first-of-type": { pl: 2 },
            "& .MuiTableCell-root:last-of-type": { pr: 2 },
          }}
        >
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: "10%" }}>Severity</TableCell>
              <TableCell sx={{ width: "30%" }}>Incident</TableCell>
              <TableCell sx={{ width: "12%" }}>Job</TableCell>
              <TableCell sx={{ width: "16%" }}>Driver</TableCell>
              <TableCell sx={{ width: "14%" }}>Reported</TableCell>
              <TableCell sx={{ width: "12%" }}>Status</TableCell>
              <TableCell align="right" sx={{ width: "6%" }} />
            </TableRow>
          </TableHead>
            <TableBody>
              {incidents === null && !error && (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 6 }}>
                    <CircularProgress size={28} />
                  </TableCell>
                </TableRow>
              )}

              {error && (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 6 }}>
                    <Typography variant="body2" sx={{ color: "#b91c1c", fontWeight: 600 }}>
                      {error}
                    </Typography>
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                      Is the backend running on port 4000?
                    </Typography>
                  </TableCell>
                </TableRow>
              )}

              {incidents !== null && incidents.length === 0 && !error && (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 7 }}>
                    <InboxRoundedIcon sx={{ fontSize: 40, color: "#cbd5e1", mb: 1 }} />
                    <Typography variant="body2" sx={{ color: "text.secondary", fontWeight: 600 }}>
                      No incidents here
                    </Typography>
                  </TableCell>
                </TableRow>
              )}

              {incidents?.map((incident) => (
                <TableRow
                  key={incident.id}
                  hover
                  onClick={() => openDetail(incident.id)}
                  sx={{ cursor: "pointer", "&:last-child td": { border: 0 } }}
                >
                  <TableCell>
                    <Badge label={incident.severity} tone={SEVERITY_TONE[incident.severity] ?? SEVERITY_TONE.LOW} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <ReportProblemRoundedIcon sx={{ fontSize: 16, color: "#f59e0b", flexShrink: 0 }} />
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {humanize(incident.type)}
                      </Typography>
                    </div>
                    <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
                      {incident.description ?? "-"}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography
                      variant="body2"
                      component={Link}
                      href={`/jobs/${incident.job.id}`}
                      onClick={(e) => e.stopPropagation()}
                      sx={{ fontWeight: 700, color: "#1d4ed8", textDecoration: "none", "&:hover": { textDecoration: "underline" }, whiteSpace: "nowrap" }}
                    >
                      {incident.job.jobNumber}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap", color: "text.secondary" }}>{incident.driver}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap", color: "text.secondary" }}>{fmtTime(incident.reportedAt)}</TableCell>
                  <TableCell>
                    <Badge label={humanize(incident.status)} tone={STATUS_TONE[incident.status] ?? STATUS_TONE.OPEN} />
                  </TableCell>
                  <TableCell align="right">
                    <OpenInNewRoundedIcon sx={{ fontSize: 16, color: "#94a3b8" }} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
        </Table>
        </div>
      </Paper>

      {/* Detail drawer */}
      <Drawer anchor="right" open={selectedId !== null} onClose={closeDetail} sx={{ "& .MuiDrawer-paper": { width: { xs: "100%", sm: 440 } } }}>
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <Typography sx={{ fontWeight: 800 }}>Incident detail</Typography>
            <IconButton onClick={closeDetail} size="small">
              <CloseRoundedIcon />
            </IconButton>
          </div>

          <div className="slim-scroll flex-1 overflow-y-auto p-5">
            {!detail ? (
              <div className="flex justify-center py-16">
                <CircularProgress size={28} />
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge label={detail.severity} tone={SEVERITY_TONE[detail.severity] ?? SEVERITY_TONE.LOW} />
                  <Badge label={humanize(detail.status)} tone={STATUS_TONE[detail.status] ?? STATUS_TONE.OPEN} />
                  {detail.backupVehicle === "REQUESTED" && (
                    <Badge label="Backup vehicle requested" tone={{ bg: "#fee2e2", fg: "#b91c1c" }} />
                  )}
                  {detail.backupVehicle === "DECLINED" && (
                    <Badge label="No backup needed" tone={{ bg: "#dcfce7", fg: "#15803d" }} />
                  )}
                </div>

                <Typography variant="h6" sx={{ mt: 2, fontWeight: 800 }}>
                  {humanize(detail.type)}
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.5, color: "text.secondary" }}>
                  {detail.description ?? "No description given."}
                </Typography>

                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    Job{" "}
                    <Link href={`/jobs/${detail.job.id}`} className="font-bold text-blue-700 no-underline hover:underline">
                      {detail.job.jobNumber}
                    </Link>
                  </Typography>
                  <StatusChip status={detail.job.status} />
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    Driver: <b>{detail.driver}</b>
                  </Typography>
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    Reported {fmtTime(detail.reportedAt)}
                  </Typography>
                  {detail.resolvedAt && (
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                      Resolved {fmtTime(detail.resolvedAt)}
                    </Typography>
                  )}
                </div>

                {detail.location && (
                  <>
                    <Divider sx={{ my: 3 }} />
                    <div className="flex items-start gap-1.5">
                      <LocationOnRoundedIcon sx={{ fontSize: 18, color: "#dc2626" }} />
                      <div>
                        <Typography variant="body2">
                          <Link
                            href={`https://www.google.com/maps?q=${detail.location.lat},${detail.location.lng}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-bold text-blue-700 no-underline hover:underline"
                          >
                            Driver location ({detail.location.lat.toFixed(4)}, {detail.location.lng.toFixed(4)})
                            <OpenInNewRoundedIcon sx={{ fontSize: 13 }} />
                          </Link>
                        </Typography>
                        <Typography variant="caption" sx={{ color: "#94a3b8" }}>
                          Shared over WhatsApp · {fmtTime(detail.location.receivedAt)}
                        </Typography>
                      </div>
                    </div>
                  </>
                )}

                {detail.sourceMessage && (
                  <>
                    <Divider sx={{ my: 3 }} />
                    <div className="flex items-start gap-1.5">
                      <FormatQuoteRoundedIcon sx={{ fontSize: 18, color: "#94a3b8", transform: "scaleX(-1)" }} />
                      <div>
                        <Typography variant="body2" sx={{ fontStyle: "italic", color: "#475569" }}>
                          {detail.sourceMessage.text}
                        </Typography>
                        <Typography variant="caption" sx={{ color: "#94a3b8" }}>
                          Driver&apos;s original WhatsApp message · {fmtTime(detail.sourceMessage.time)}
                        </Typography>
                      </div>
                    </div>
                  </>
                )}

                {detail.attachments.length > 0 && (
                  <>
                    <Divider sx={{ my: 3 }} />
                    <Typography variant="body2" sx={{ fontWeight: 700, mb: 1 }}>
                      Attachments
                    </Typography>
                    {detail.attachments.map((a) => (
                      <div key={a.id} className="mb-1 flex items-center gap-1.5">
                        {a.publicUrl ? (
                          <LocalOfferRoundedIcon sx={{ fontSize: 15, color: "#1d4ed8" }} />
                        ) : (
                          <AttachFileRoundedIcon sx={{ fontSize: 15, color: "#64748b" }} />
                        )}
                        {a.publicUrl ? (
                          <Typography
                            variant="caption"
                            component="a"
                            href={a.publicUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            sx={{ color: "#1d4ed8", fontWeight: 700, textDecoration: "none", "&:hover": { textDecoration: "underline" } }}
                          >
                            {a.filename ?? humanize(a.type)} - open photo
                          </Typography>
                        ) : (
                          <Typography variant="caption" sx={{ color: "text.secondary" }}>
                            {a.filename ?? humanize(a.type)}
                            {a.mimeType ? ` (${a.mimeType})` : ""}
                          </Typography>
                        )}
                      </div>
                    ))}
                  </>
                )}

                <Divider sx={{ my: 3 }} />
                <Typography variant="body2" sx={{ fontWeight: 700, mb: 1 }}>
                  Manager notes
                </Typography>
                <TextField
                  fullWidth
                  multiline
                  minRows={3}
                  size="small"
                  placeholder="e.g. Mechanic dispatched, ETA 40 min…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
                <div className="mt-2 flex justify-end">
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={busy || notes === (detail.managerNotes ?? "")}
                    onClick={() => run(() => updateIncidentNotes(detail.id, notes))}
                  >
                    Save Notes
                  </Button>
                </div>
              </>
            )}
          </div>

          {detail && (
            <div className="flex flex-wrap gap-2 border-t border-slate-200 px-5 py-4">
              {detail.status === "OPEN" && (
                <Button
                  size="small"
                  variant="outlined"
                  color="warning"
                  disabled={busy}
                  startIcon={<VisibilityOutlinedIcon />}
                  onClick={() => run(() => incidentAction(detail.id, "under-review", notes || undefined))}
                >
                  Start Review
                </Button>
              )}
              {detail.status !== "RESOLVED" && (
                <>
                  <Button
                    size="small"
                    variant="contained"
                    color="success"
                    disabled={busy}
                    startIcon={<CheckCircleOutlineRoundedIcon />}
                    onClick={() => run(() => incidentAction(detail.id, "resolve", notes || undefined))}
                  >
                    Resolve
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    color="warning"
                    disabled={busy}
                    startIcon={<CheckCircleOutlineRoundedIcon />}
                    onClick={() =>
                      run(async () => {
                        await incidentAction(detail.id, "resolve", notes || undefined);
                        await releaseDriver(
                          detail.job.id,
                          `Released after resolving ${humanize(detail.type).toLowerCase()} incident`,
                        );
                      })
                    }
                  >
                    Resolve &amp; release driver
                  </Button>
                </>
              )}
              {detail.status === "RESOLVED" && (
                <Button
                  size="small"
                  variant="outlined"
                  disabled={busy}
                  startIcon={<ReplayRoundedIcon />}
                  onClick={() => run(() => incidentAction(detail.id, "keep-open", notes || undefined))}
                >
                  Reopen
                </Button>
              )}
            </div>
          )}
        </div>
      </Drawer>
    </div>
  );
}
