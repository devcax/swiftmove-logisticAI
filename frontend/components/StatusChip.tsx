"use client";

import Chip from "@mui/material/Chip";
import CircleIcon from "@mui/icons-material/Circle";

type Tone = "success" | "warning" | "error" | "info" | "neutral";

const tones: Record<Tone, { bg: string; fg: string; dot: string }> = {
  success: { bg: "#dcfce7", fg: "#15803d", dot: "#16a34a" },
  warning: { bg: "#fef3c7", fg: "#b45309", dot: "#d97706" },
  error: { bg: "#fee2e2", fg: "#b91c1c", dot: "#dc2626" },
  info: { bg: "#dbeafe", fg: "#1d4ed8", dot: "#2563eb" },
  neutral: { bg: "#e2e8f0", fg: "#475569", dot: "#64748b" },
};

const statusTone: Record<string, Tone> = {
  LOADED: "success",
  DELIVERED: "success",
  DELIVERED_WITH_EXCEPTION: "warning",
  COMPLETED: "success",
  ACTIVE: "success",
  EN_ROUTE: "info",
  IN_PROGRESS: "info",
  PUBLISHED: "info",
  DRIVER_REQUESTED: "info",
  MANAGER_APPROVED: "info",
  ASSIGNMENT_SENT: "info",
  ASSIGNED: "info",
  ARRIVED_AT_PICKUP: "info",
  LOADING_STARTED: "info",
  DEPARTED: "info",
  ARRIVED_AT_DELIVERY: "info",
  UNLOADING_STARTED: "info",
  UNLOADED: "info",
  DRIVER_SUBMITTED_COMPLETION: "info",
  MANAGER_REVIEW: "info",
  AWAITING_PICKUP: "neutral",
  AWAITING_COMPLETION: "neutral",
  DELAYED: "warning",
  REQUIRES_CORRECTION: "warning",
  CANCELLATION_REVIEW: "warning",
  INCIDENT: "error",
  INCIDENT_OPEN: "error",
  FAILED_DELIVERY: "error",
  SUSPENDED: "error",
  DRAFT: "neutral",
  INACTIVE: "neutral",
  CANCELLED: "neutral",
};


const statusLabel: Record<string, string> = {
  IN_PROGRESS: "STARTED",
  ARRIVED_AT_PICKUP: "AT PICKUP",
  ARRIVED_AT_DELIVERY: "AT DELIVERY",
  DRIVER_SUBMITTED_COMPLETION: "CLOSURE REQUESTED",
  MANAGER_REVIEW: "CLOSURE REVIEW",
  MANAGER_APPROVED: "MANAGER APPROVED",
  ASSIGNMENT_SENT: "ASSIGNMENT SENT",
  PENDING_DRIVER_ACCEPTANCE: "AWAITING DRIVER ACCEPTANCE",
};

export default function StatusChip({
  status,
  size = "small",
}: {
  status: string;
  size?: "small" | "medium";
}) {
  const tone = statusTone[status] ?? "neutral";
  const { bg, fg, dot } = tones[tone];

  return (
    <Chip
      size={size}
      label={statusLabel[status] ?? status.replace(/_/g, " ")}
      icon={<CircleIcon sx={{ fontSize: 8, color: `${dot} !important` }} />}
      sx={{
        bgcolor: bg,
        color: fg,
        fontWeight: 700,
        fontSize: "0.72rem",
        letterSpacing: "0.04em",
        maxWidth: "100%",
        "& .MuiChip-icon": { marginLeft: "10px" },
      }}
    />
  );
}
