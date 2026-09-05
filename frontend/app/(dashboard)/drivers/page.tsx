"use client";

import * as React from "react";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
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
import BlockRoundedIcon from "@mui/icons-material/BlockRounded";
import DeleteRoundedIcon from "@mui/icons-material/DeleteRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import PersonAddAlt1RoundedIcon from "@mui/icons-material/PersonAddAlt1Rounded";
import PowerSettingsNewRoundedIcon from "@mui/icons-material/PowerSettingsNewRounded";
import RestoreRoundedIcon from "@mui/icons-material/RestoreRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import VerifiedRoundedIcon from "@mui/icons-material/VerifiedRounded";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import StatusChip from "@/components/StatusChip";
import AddDriverDialog from "@/components/drivers/AddDriverDialog";
import EditDriverDialog from "@/components/drivers/EditDriverDialog";
import {
  fetchDrivers,
  updateDriverStatus,
  deleteDriver,
  type ApiDriverSummary,
} from "@/lib/api";
import { formatPhoneDisplay } from "@/lib/driverForm";
import { type DriverAccountStatus, type RegisteredDriver } from "@/lib/data";

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function DriversPage() {
  const [drivers, setDrivers] = React.useState<RegisteredDriver[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [addOpen, setAddOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<RegisteredDriver | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] =
    React.useState<RegisteredDriver | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);

  const loadDrivers = React.useCallback(async () => {
    try {
      const data = await fetchDrivers();
      setDrivers(
        data.map((driver) => ({
          id: driver.id,
          name: driver.name,
          phone: driver.phone,
          verified: driver.verified,
          status: driver.status,
          currentJob: driver.currentJob,
          completedTrips: driver.completedTrips,
          vehicleType: driver.vehicleType ?? undefined,
          licensePlate: driver.licensePlate ?? undefined,
        })),
      );
      setLoadError(null);
    } catch (err) {
      setDrivers([]);
      setLoadError(
        err instanceof Error ? err.message : "Could not load drivers.",
      );
    }
  }, []);

  React.useEffect(() => {
    void loadDrivers();
  }, [loadDrivers]);

  const fleet = drivers ?? [];

  const visibleDrivers = fleet.filter(
    (driver) =>
      driver.name.toLowerCase().includes(query.toLowerCase()) ||
      driver.phone.includes(query) ||
      formatPhoneDisplay(driver.phone)
        .toLowerCase()
        .includes(query.toLowerCase()) ||
      (driver.currentJob ?? "").toLowerCase().includes(query.toLowerCase()),
  );

  const updateStatus = async (id: string, status: DriverAccountStatus) => {
    setDrivers(
      (prev) =>
        prev?.map((driver) =>
          driver.id === id ? { ...driver, status } : driver,
        ) ?? prev,
    );
    try {
      await updateDriverStatus(id, status);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Could not update driver status.",
      );
      void loadDrivers();
    }
  };

  const statusCounts = {
    active: fleet.filter((driver) => driver.status === "ACTIVE").length,
    inactive: fleet.filter((driver) => driver.status === "INACTIVE").length,
    suspended: fleet.filter((driver) => driver.status === "SUSPENDED").length,
  };

  const kpiCards: {
    label: string;
    value: number;
    hint: string;
    hintColor: string;
  }[] = [
    {
      label: "Active Drivers",
      value: statusCounts.active,
      hint: "Bot access enabled",
      hintColor: "#15803d",
    },
    {
      label: "Inactive Drivers",
      value: statusCounts.inactive,
      hint: "Bot access paused",
      hintColor: "#475569",
    },
    {
      label: "Suspended Drivers",
      value: statusCounts.suspended,
      hint: "Access revoked",
      hintColor: "#b91c1c",
    },
  ];

  const handleUpdated = (updated: ApiDriverSummary) => {
    setDrivers(
      (prev) =>
        prev?.map((driver) =>
          driver.id === updated.id
            ? {
                ...driver,
                name: updated.name,
                phone: updated.phone,
                verified: updated.verified,
                status: updated.status,
                currentJob: updated.currentJob,
                completedTrips: updated.completedTrips,
                vehicleType: updated.vehicleType ?? undefined,
                licensePlate: updated.licensePlate ?? undefined,
              }
            : driver,
        ) ?? prev,
    );
    setToast(`${updated.name} was updated successfully.`);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleting(true);
    try {
      await deleteDriver(target.id);
      setDrivers(
        (prev) => prev?.filter((driver) => driver.id !== target.id) ?? prev,
      );
      setToast(`${target.name} was deleted.`);
      setDeleteTarget(null);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Could not delete the driver.",
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1500px] p-4 sm:p-6">
      {/* Page actions */}

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {kpiCards.map((card) => (
          <Card key={card.label}>
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

      <div className="mb-5 flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="contained"
          startIcon={<PersonAddAlt1RoundedIcon />}
          onClick={() => setAddOpen(true)}
          sx={{ bgcolor: "#1e3a8a", "&:hover": { bgcolor: "#172554" } }}
        >
          Add Driver
        </Button>
      </div>

      <Paper>
        <div className="border-b border-slate-200 px-4 py-3">
          <TextField
            size="small"
            placeholder="Search by name, number or job"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            sx={{ width: { xs: "100%", sm: 320 }, bgcolor: "#fff" }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRoundedIcon
                      fontSize="small"
                      sx={{ color: "#94a3b8" }}
                    />
                  </InputAdornment>
                ),
              },
            }}
          />
        </div>

        {loadError && (
          <Alert
            severity="warning"
            sx={{ m: 2, borderRadius: 2 }}
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => void loadDrivers()}
              >
                Retry
              </Button>
            }
          >
            {loadError}
          </Alert>
        )}

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
              <TableCell sx={{ width: "23%" }}>Driver</TableCell>
              <TableCell sx={{ width: "20%" }}>WhatsApp Number</TableCell>
              <TableCell sx={{ width: "13%" }}>Account Status</TableCell>
              <TableCell sx={{ width: "14%" }}>Current Job</TableCell>
              <TableCell sx={{ width: "7%" }}>Trips</TableCell>
              <TableCell align="right" sx={{ width: "23%" }}>
                Actions
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {drivers === null && (
              <TableRow>
                <TableCell colSpan={6}>
                  <div className="flex items-center justify-center gap-2 py-12">
                    <CircularProgress size={20} sx={{ color: "#2563eb" }} />
                    <Typography
                      variant="body2"
                      sx={{ color: "text.secondary" }}
                    >
                      Loading drivers…
                    </Typography>
                  </div>
                </TableCell>
              </TableRow>
            )}
            {visibleDrivers.map((driver) => (
              <TableRow
                key={driver.id}
                hover
                sx={{ "&:last-child td": { border: 0 } }}
              >
                <TableCell>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar
                      sx={{
                        width: 36,
                        height: 36,
                        fontSize: 13,
                        bgcolor: "#e0f2fe",
                        color: "#0369a1",
                        flexShrink: 0,
                      }}
                    >
                      {initials(driver.name)}
                    </Avatar>
                    <div className="min-w-0">
                      <Tooltip title={driver.name}>
                        <Typography
                          variant="body2"
                          noWrap
                          sx={{ fontWeight: 600 }}
                        >
                          {driver.name}
                        </Typography>
                      </Tooltip>
                      {(driver.vehicleType || driver.licensePlate) && (
                        <Typography
                          variant="caption"
                          noWrap
                          sx={{ color: "#94a3b8", display: "block" }}
                        >
                          {[driver.vehicleType, driver.licensePlate]
                            .filter(Boolean)
                            .join(" · ")}
                        </Typography>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex min-w-0 items-center gap-1.5">
                    <WhatsAppIcon
                      sx={{ fontSize: 17, color: "#16a34a", flexShrink: 0 }}
                    />
                    <Tooltip title={driver.phone}>
                      <Typography
                        variant="body2"
                        noWrap
                        sx={{
                          fontFamily: "var(--font-geist-mono)",
                          fontSize: 13,
                          minWidth: 0,
                        }}
                      >
                        {formatPhoneDisplay(driver.phone)}
                      </Typography>
                    </Tooltip>
                    {driver.verified ? (
                      <Tooltip title="Number verified by driver">
                        <VerifiedRoundedIcon
                          sx={{ fontSize: 16, color: "#2563eb", flexShrink: 0 }}
                        />
                      </Tooltip>
                    ) : (
                      <Tooltip title="Verification pending">
                        <Chip
                          label="UNVERIFIED"
                          size="small"
                          sx={{
                            height: 18,
                            fontSize: 9,
                            bgcolor: "#fef3c7",
                            color: "#b45309",
                            flexShrink: 0,
                          }}
                        />
                      </Tooltip>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <StatusChip status={driver.status} />
                </TableCell>
                <TableCell>
                  {driver.currentJob ? (
                    <Chip
                      label={driver.currentJob}
                      size="small"
                      sx={{
                        bgcolor: "#dbeafe",
                        color: "#1d4ed8",
                        fontWeight: 700,
                        maxWidth: "100%",
                      }}
                    />
                  ) : (
                    <Typography variant="caption" sx={{ color: "#94a3b8" }}>
                      Idle
                    </Typography>
                  )}
                </TableCell>
                <TableCell sx={{ color: "text.secondary" }}>
                  {driver.completedTrips}
                </TableCell>
                <TableCell align="right">
                  <div className="flex justify-end gap-0.5">
                    <Tooltip title="Edit driver">
                      <IconButton
                        size="small"
                        sx={{ color: "#64748b" }}
                        onClick={() => setEditTarget(driver)}
                      >
                        <EditRoundedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {driver.status === "ACTIVE" ? (
                      <Tooltip title="Deactivate bot access">
                        <IconButton
                          size="small"
                          sx={{ color: "#64748b" }}
                          onClick={() =>
                            void updateStatus(driver.id, "INACTIVE")
                          }
                        >
                          <PowerSettingsNewRoundedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    ) : (
                      <Tooltip title="Activate bot access">
                        <IconButton
                          size="small"
                          sx={{ color: "#16a34a" }}
                          onClick={() => void updateStatus(driver.id, "ACTIVE")}
                        >
                          <PowerSettingsNewRoundedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {driver.status === "SUSPENDED" ? (
                      <Tooltip title="Restore access">
                        <IconButton
                          size="small"
                          sx={{ color: "#16a34a" }}
                          onClick={() => void updateStatus(driver.id, "ACTIVE")}
                        >
                          <RestoreRoundedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    ) : (
                      <Tooltip title="Suspend driver">
                        <IconButton
                          size="small"
                          sx={{ color: "#dc2626" }}
                          onClick={() =>
                            void updateStatus(driver.id, "SUSPENDED")
                          }
                        >
                          <BlockRoundedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    <Tooltip title="Delete driver">
                      <IconButton
                        size="small"
                        sx={{ color: "#94a3b8" }}
                        onClick={() => setDeleteTarget(driver)}
                      >
                        <DeleteRoundedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {drivers !== null && visibleDrivers.length === 0 && (
              <TableRow>
                <TableCell colSpan={6}>
                  <div className="py-10 text-center">
                    <Typography
                      variant="body2"
                      sx={{ color: "text.secondary" }}
                    >
                      {query
                        ? "No drivers match your search."
                        : "No drivers registered yet. Add your first driver above."}
                    </Typography>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <AddDriverDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        existingPhones={fleet.map((driver) => driver.phone)}
        onCreated={(driver) => setDrivers((prev) => [driver, ...(prev ?? [])])}
      />

      <EditDriverDialog
        key={editTarget?.id ?? "closed"}
        open={editTarget !== null}
        driver={editTarget}
        onClose={() => setEditTarget(null)}
        existingPhones={fleet
          .filter((driver) => driver.id !== editTarget?.id)
          .map((driver) => driver.phone)}
        onUpdated={handleUpdated}
      />

      <Dialog
        open={deleteTarget !== null}
        onClose={() => (deleting ? null : setDeleteTarget(null))}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete driver</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {deleteTarget
              ? `Remove ${deleteTarget.name} and all of their conversations, requests and assignments? This cannot be undone.`
              : ""}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => void confirmDelete()}
            disabled={deleting}
            startIcon={
              deleting ? (
                <CircularProgress size={16} color="inherit" />
              ) : (
                <DeleteRoundedIcon />
              )
            }
          >
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={toast !== null}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          severity="success"
          variant="filled"
          onClose={() => setToast(null)}
          sx={{ borderRadius: 2 }}
        >
          {toast}
        </Alert>
      </Snackbar>
    </div>
  );
}
