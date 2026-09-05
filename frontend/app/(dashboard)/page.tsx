"use client";

import * as React from "react";
import Link from "next/link";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import StatusChip from "@/components/StatusChip";
import {
  fetchOperationsOverview,
  type ApiOperationsOverview,
  type ApiOverviewJob,
} from "@/lib/api";

const JOBS_PAGE_SIZE = 8;

const hintColors: Record<string, string> = {
  primary: "#2563eb",
  info: "#64748b",
  success: "#16a34a",
  warning: "#64748b",
  error: "#dc2626",
  neutral: "#64748b",
};

const feedTone: Record<string, { bg: string; fg: string }> = {
  success: { bg: "#e8f7ee", fg: "#15803d" },
  warning: { bg: "#fef3c7", fg: "#b45309" },
  error: { bg: "#fdecec", fg: "#b91c1c" },
  info: { bg: "#e7effe", fg: "#1d4ed8" },
};

function isException(job: ApiOverviewJob) {
  return job.status.includes("INCIDENT") || job.status === "DELAYED";
}

export default function OperationsOverviewPage() {
  const [data, setData] = React.useState<ApiOperationsOverview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [jobsPage, setJobsPage] = React.useState(0);

  const load = React.useCallback(async () => {
    try {
      const result = await fetchOperationsOverview();
      setData(result);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not load the operations overview.",
      );
    }
  }, []);

  React.useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 15_000);
    return () => clearInterval(interval);
  }, [load]);

  const totalJobPages = data
    ? Math.max(1, Math.ceil(data.activeJobs.length / JOBS_PAGE_SIZE))
    : 1;
  const currentJobsPage = Math.min(jobsPage, totalJobPages - 1);
  const visibleJobs = data
    ? data.activeJobs.slice(
        currentJobsPage * JOBS_PAGE_SIZE,
        currentJobsPage * JOBS_PAGE_SIZE + JOBS_PAGE_SIZE,
      )
    : [];

  return (
    <div className="mx-auto flex h-full w-full max-w-[1500px] flex-col gap-3 overflow-y-auto p-3 sm:p-4 xl:overflow-hidden">
      {error && (
        <Alert
          severity="warning"
          className="shrink-0"
          sx={{ borderRadius: 2 }}
          action={
            <Button color="inherit" size="small" onClick={() => void load()}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {data === null && !error && (
        <div className="flex flex-1 items-center justify-center gap-2">
          <CircularProgress size={22} sx={{ color: "#2563eb" }} />
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Loading live operations…
          </Typography>
        </div>
      )}

      {data && (
        <>
          <div className="grid shrink-0 grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {data.kpis.map((kpi) => (
              <Card key={kpi.label}>
                <CardContent sx={{ px: 1.5, py: 1, "&:last-child": { pb: 1 } }}>
                  <Typography
                    variant="body2"
                    sx={{ color: "text.secondary", fontWeight: 600 }}
                  >
                    {kpi.label}
                  </Typography>
                  <Typography
                    sx={{ fontSize: 24, fontWeight: 800, lineHeight: 1.1 }}
                  >
                    {kpi.value}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      color: hintColors[kpi.tone],
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      fontSize: 10.5,
                    }}
                  >
                    {kpi.hint}
                  </Typography>
                </CardContent>
              </Card>
            ))}
          </div>

          <Paper className="flex min-h-[280px] flex-[1.15] flex-col">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
              <div>
                <Typography variant="subtitle1">Active Jobs Board</Typography>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  {data.activeJobs.length} jobs currently on the road
                </Typography>
              </div>
              <Link
                href="/jobs"
                className="flex items-center gap-1 text-sm font-semibold text-blue-900 no-underline hover:text-blue-950 hover:underline"
              >
                View all <ArrowForwardRoundedIcon sx={{ fontSize: 16 }} />
              </Link>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <Table
                size="small"
                sx={{
                  tableLayout: "fixed",
                  width: "100%",
                  "& .MuiTableCell-root": {
                    px: 1,
                    py: 0.5,
                    verticalAlign: "middle",
                    whiteSpace: "normal",
                    overflowWrap: "break-word",
                  },
                  "& .MuiTableCell-head": { py: 0.75 },
                  "& .MuiTableCell-root:first-of-type": { pl: 2 },
                  "& .MuiTableCell-root:last-of-type": { pr: 2 },
                }}
              >
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: "10%" }}>Job</TableCell>
                    <TableCell sx={{ width: "13%" }}>Driver</TableCell>
                    <TableCell sx={{ width: "24%" }}>Route</TableCell>
                    <TableCell sx={{ width: "13%" }}>Status</TableCell>
                    <TableCell sx={{ width: "27%" }}>Last Update</TableCell>
                    <TableCell sx={{ width: "13%" }}>Exception</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {visibleJobs.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6}>
                        <div className="py-6 text-center">
                          <Typography
                            variant="body2"
                            sx={{ color: "text.secondary" }}
                          >
                            No jobs are on the road right now.
                          </Typography>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  {visibleJobs.map((job) => (
                    <TableRow
                      key={job.jobNumber}
                      hover
                      sx={{ "&:last-child td": { border: 0 } }}
                    >
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 800 }}>
                          {job.jobNumber}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {job.driver}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[13px] text-slate-600">
                          <span className="min-w-0 break-words">
                            {job.origin}
                          </span>
                          <ArrowForwardRoundedIcon
                            sx={{
                              fontSize: 14,
                              color: "#94a3b8",
                              flexShrink: 0,
                            }}
                          />
                          <span className="min-w-0 break-words font-semibold text-slate-800">
                            {job.destination}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusChip status={job.status} />
                      </TableCell>
                      <TableCell>
                        <div className="min-w-0">
                          <Typography variant="body2">
                            {job.lastUpdate}
                          </Typography>
                          <Typography
                            variant="caption"
                            sx={{
                              color: "#94a3b8",
                              letterSpacing: "0.06em",
                              textTransform: "uppercase",
                              fontSize: 10,
                            }}
                          >
                            {job.lastUpdateAgo}
                          </Typography>
                        </div>
                      </TableCell>
                      <TableCell>
                        {job.exception ? (
                          <Box
                            className="inline-flex max-w-full items-start gap-1 rounded-md px-2 py-1"
                            sx={{
                              bgcolor: isException(job) ? "#fdecec" : "#fef3c7",
                              color: isException(job) ? "#b91c1c" : "#b45309",
                            }}
                          >
                            <WarningAmberRoundedIcon
                              sx={{ fontSize: 15, flexShrink: 0, mt: "1px" }}
                            />
                            <Typography
                              variant="caption"
                              sx={{
                                fontWeight: 700,
                                color: "inherit",
                                whiteSpace: "normal",
                                overflowWrap: "break-word",
                              }}
                            >
                              {job.exception}
                            </Typography>
                          </Box>
                        ) : (
                          <Typography
                            variant="caption"
                            sx={{ color: "#cbd5e1" }}
                          >
                            —
                          </Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-1.5">
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                Page {currentJobsPage + 1} of {totalJobPages} ·{" "}
                {data.activeJobs.length} jobs total
              </Typography>
              <div className="flex items-center gap-2">
                <Button
                  variant="outlined"
                  size="small"
                  disabled={currentJobsPage === 0}
                  onClick={() => setJobsPage(Math.max(0, currentJobsPage - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  disabled={currentJobsPage >= totalJobPages - 1}
                  onClick={() =>
                    setJobsPage(
                      Math.min(totalJobPages - 1, currentJobsPage + 1),
                    )
                  }
                >
                  Next
                </Button>
              </div>
            </div>
          </Paper>

          <div className="flex min-h-[220px] flex-1 flex-col gap-3 xl:min-h-0 xl:flex-row">
            <Paper className="flex flex-col xl:min-h-0 xl:flex-1">
              <div className="shrink-0 border-b border-slate-200 px-4 py-2.5">
                <Typography variant="subtitle1">Open incidents</Typography>
              </div>
              <div className="slim-scroll flex flex-col gap-2 p-3 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
                {data.openIncidents.length === 0 && (
                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    No open incidents.
                  </Typography>
                )}
                {data.openIncidents.map((incident) => (
                  <div
                    key={incident.id}
                    className="rounded-lg border border-red-100 bg-[#fdecec] p-2.5"
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <Typography
                        variant="caption"
                        sx={{
                          fontWeight: 800,
                          color: "#b91c1c",
                          fontFamily: "var(--font-geist-mono)",
                        }}
                      >
                        {incident.id}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{ color: "#94a3b8", fontWeight: 600 }}
                      >
                        {incident.jobNumber}
                      </Typography>
                    </div>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {incident.summary}
                    </Typography>
                  </div>
                ))}
              </div>
            </Paper>

            <Paper className="flex flex-col xl:min-h-0 xl:flex-1">
              <div className="shrink-0 border-b border-slate-200 px-4 py-2.5">
                <Typography variant="subtitle1">AI extraction feed</Typography>
              </div>
              <div className="slim-scroll flex flex-col gap-2 p-3 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
                {data.recentAiEvents.length === 0 && (
                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    No AI events yet.
                  </Typography>
                )}
                {data.recentAiEvents.map((event, index) => {
                  const tone = feedTone[event.tone] ?? feedTone.info;
                  return (
                    <div
                      key={index}
                      className="rounded-lg border border-slate-100 bg-slate-50 p-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Typography
                          variant="caption"
                          sx={{
                            fontWeight: 800,
                            color: tone.fg,
                            letterSpacing: "0.04em",
                          }}
                        >
                          {event.intent}
                        </Typography>
                        <Typography
                          variant="caption"
                          sx={{ color: "#94a3b8", fontWeight: 700 }}
                        >
                          {event.confidence}%
                        </Typography>
                      </div>
                      <Typography
                        variant="caption"
                        sx={{ color: "text.secondary" }}
                      >
                        {event.detail}
                      </Typography>
                    </div>
                  );
                })}
              </div>
            </Paper>
          </div>
        </>
      )}
    </div>
  );
}
