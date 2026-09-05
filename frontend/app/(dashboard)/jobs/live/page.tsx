"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Avatar from "@mui/material/Avatar";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import PlaylistAddCheckRoundedIcon from "@mui/icons-material/PlaylistAddCheckRounded";
import ReportProblemRoundedIcon from "@mui/icons-material/ReportProblemRounded";
import SensorsRoundedIcon from "@mui/icons-material/SensorsRounded";
import StatusChip from "@/components/StatusChip";
import { fetchLiveJobs, type ApiLiveJob } from "@/lib/api";

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function timeAgo(iso: string | null) {
  if (!iso) return "no updates yet";
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

export default function LiveJobsPage() {
  const router = useRouter();
  const [jobs, setJobs] = React.useState<ApiLiveJob[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setJobs(null);
    try {
      const data = await fetchLiveJobs();
      setJobs(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load live jobs");
    }
  }, []);

  React.useEffect(() => {
    load(true);
    const timer = setInterval(() => load(false), 5000);
    return () => clearInterval(timer);
  }, [load]);

  const liveCount = jobs?.length ?? 0;

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 p-4 sm:p-6">
      <div className="mb-4 flex w-full flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-black-600">
            <SensorsRoundedIcon fontSize="small" />
          </span>
          <Typography
            variant="h5"
            sx={{ fontWeight: 800, letterSpacing: "-0.01em" }}
          >
            Live Jobs
          </Typography>
          <Chip
            label={`${liveCount} live`}
            size="small"
            sx={{
              bgcolor: liveCount > 0 ? "#dcfce7" : "#e2e8f0",
              color: liveCount > 0 ? "#15803d" : "#475569",
              fontWeight: 700,
            }}
          />
        </div>
        <Button
          component={Link}
          href="/requests"
          variant="outlined"
          size="small"
          startIcon={<PlaylistAddCheckRoundedIcon />}
          sx={{
            bgcolor: "#fff",
            color: "#1e3a8a",
            borderColor: "#1e3a8a",
            fontWeight: 700,
            "&:hover": {
              borderColor: "#172554",
              color: "#172554",
              bgcolor: "rgba(30, 58, 138, 0.06)",
            },
          }}
        >
          Open Requests
        </Button>
      </div>

      {error && (
        <Paper sx={{ p: 1.5, bgcolor: "#fef2f2", border: "1px solid #fecaca" }}>
          <Typography
            variant="body2"
            sx={{ color: "#b91c1c", fontWeight: 600 }}
          >
            {error}
          </Typography>
        </Paper>
      )}

      {jobs === null && !error && (
        <div className="flex items-center justify-center py-16">
          <CircularProgress size={28} />
        </div>
      )}

      {jobs !== null && jobs.length === 0 && !error && (
        <Paper sx={{ px: 3 }}>
          <div className="flex h-32 flex-row items-center justify-center gap-2">
            <SensorsRoundedIcon sx={{ fontSize: 18, color: "#cbd5e1" }} />
            <Typography
              variant="body2"
              sx={{ color: "text.secondary", fontWeight: 600 }}
            >
              No live trips right now
            </Typography>
          </div>
        </Paper>
      )}

      {jobs !== null && jobs.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {jobs.map((job) => (
            <div
              key={job.id}
              onClick={() => router.push(`/jobs/${job.id}`)}
              className="cursor-pointer rounded-lg border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md"
            >
              {/* Card header*/}
              <div className="flex items-start justify-between gap-2">
                <Typography
                  sx={{ fontWeight: 800, fontSize: 15, lineHeight: 1.3 }}
                >
                  {job.jobNumber}
                </Typography>
                <div className="flex shrink-0 items-center gap-1.5">
                  {job.openIncidents > 0 && (
                    <Chip
                      size="small"
                      icon={<ReportProblemRoundedIcon sx={{ fontSize: 14 }} />}
                      label={`${job.openIncidents} incident${job.openIncidents === 1 ? "" : "s"}`}
                      sx={{
                        bgcolor: "#fee2e2",
                        color: "#b91c1c",
                        fontWeight: 700,
                        fontSize: 10,
                        height: 20,
                        "& .MuiChip-icon": { color: "#b91c1c" },
                      }}
                    />
                  )}
                  <StatusChip status={job.status} />
                </div>
              </div>

              {/* Card body*/}
              <div className="mt-3">
                <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[13px] text-slate-600">
                  <span className="min-w-0 break-words">
                    {job.pickup ?? "-"}
                  </span>
                  <ArrowForwardRoundedIcon
                    sx={{ fontSize: 14, color: "#94a3b8", flexShrink: 0 }}
                  />
                  <span className="min-w-0 break-words font-semibold text-slate-800">
                    {job.delivery ?? "-"}
                  </span>
                </div>
                <Typography
                  variant="body2"
                  className="mt-1 text-sm text-slate-500"
                >
                  {job.cargo}
                  {job.quantity ? ` · ${job.quantity}` : ""}
                </Typography>
              </div>

              {/* Card footer */}
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                {job.driver ? (
                  <div className="flex min-w-0 items-center gap-2">
                    <Avatar
                      sx={{
                        width: 30,
                        height: 30,
                        fontSize: 12,
                        bgcolor: "#e0f2fe",
                        color: "#0369a1",
                        flexShrink: 0,
                      }}
                    >
                      {initials(job.driver)}
                    </Avatar>
                    <div className="min-w-0">
                      <Typography
                        variant="body2"
                        sx={{ fontWeight: 600, whiteSpace: "nowrap" }}
                      >
                        {job.driver}
                      </Typography>
                      {job.driverPhone && (
                        <Typography
                          variant="caption"
                          sx={{ color: "#94a3b8", display: "block" }}
                        >
                          {job.driverPhone}
                        </Typography>
                      )}
                    </div>
                  </div>
                ) : (
                  <Typography variant="caption" sx={{ color: "#94a3b8" }}>
                    Awaiting driver
                  </Typography>
                )}
                <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
                  <Typography
                    variant="caption"
                    sx={{
                      color: "#cbd5e1",
                      fontSize: 9.5,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                    }}
                  >
                    Latest update
                  </Typography>
                  <div className="flex items-center gap-1.5">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                    </span>
                    <Typography
                      variant="body2"
                      sx={{
                        color: "text.secondary",
                        fontSize: 12.5,
                        fontWeight: 600,
                      }}
                    >
                      {job.lastEventType
                        ? job.lastEventType.replace(/_/g, " ")
                        : "No updates yet"}
                    </Typography>
                  </div>
                  <Typography variant="caption" sx={{ color: "#94a3b8" }}>
                    {timeAgo(job.lastEventAt)}
                  </Typography>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
