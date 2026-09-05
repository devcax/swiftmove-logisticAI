"use client";

import * as React from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import Snackbar from "@mui/material/Snackbar";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import PersonAddAlt1RoundedIcon from "@mui/icons-material/PersonAddAlt1Rounded";
import { createDriver } from "@/lib/api";
import type { RegisteredDriver } from "@/lib/data";
import {
  formatPhoneInput,
  formatPlateInput,
  toE164,
  validateDriverForm,
  vehicleTypes,
  type DriverFormErrors,
} from "@/lib/driverForm";

const initialForm = { fullName: "", phone: "", vehicleType: "", licensePlate: "" };

const fieldLabelSx = {
  color: "#64748b",
  fontWeight: 700,
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  mb: 0.75,
  display: "block",
} as const;

interface AddDriverDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (driver: RegisteredDriver) => void;
  existingPhones?: string[];
}

export default function AddDriverDialog({ open, onClose, onCreated, existingPhones = [] }: AddDriverDialogProps) {
  const [form, setForm] = React.useState(initialForm);
  const [touched, setTouched] = React.useState<Partial<Record<keyof typeof initialForm, boolean>>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [toast, setToast] = React.useState<{ severity: "success" | "error"; message: string } | null>(null);

  const errors: DriverFormErrors = validateDriverForm(form);
  const errorFor = (key: keyof typeof initialForm) => (touched[key] ? errors[key] : undefined);

  const set =
    (key: keyof typeof initialForm) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const raw = event.target.value;
      const value = key === "phone" ? formatPhoneInput(raw) : key === "licensePlate" ? formatPlateInput(raw) : raw;
      setForm((prev) => ({ ...prev, [key]: value }));
      if (key === "vehicleType") setTouched((prev) => ({ ...prev, vehicleType: true }));
    };

  const blur = (key: keyof typeof initialForm) => () => setTouched((prev) => ({ ...prev, [key]: true }));

  const reset = () => {
    setForm(initialForm);
    setTouched({});
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const submit = async () => {
    setTouched({ fullName: true, phone: true, vehicleType: true, licensePlate: true });
    if (Object.keys(errors).length > 0) return;

    const e164 = toE164(form.phone);
    if (!e164) return;
    if (existingPhones.some((phone) => phone.replace(/\D/g, "") === e164.replace(/\D/g, ""))) {
      setToast({ severity: "error", message: "A driver with this phone number is already registered" });
      return;
    }

    setSubmitting(true);
    try {
      const driver = await createDriver({
        name: form.fullName.trim(),
        phone: e164,
        vehicleType: form.vehicleType,
        licensePlate: form.licensePlate.trim().toUpperCase(),
      });
      onCreated?.({ ...driver, vehicleType: driver.vehicleType ?? undefined, licensePlate: driver.licensePlate ?? undefined });
      setToast({ severity: "success", message: `${driver.name} added! WhatsApp invite sent to ${driver.phone}` });
      reset();
      onClose();
    } catch (err) {
      setToast({
        severity: "error",
        message: err instanceof Error ? err.message : "Could not add the driver. Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onClose={handleClose} fullWidth maxWidth="xs">
        <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-900">
            <PersonAddAlt1RoundedIcon fontSize="small" />
          </span>
          <div className="min-w-0 flex-1">
            <Typography variant="subtitle1">Add Driver</Typography>
          </div>
          <IconButton size="small" onClick={handleClose} disabled={submitting} aria-label="Close dialog">
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </div>

        <div className="flex flex-col gap-4 px-5 py-5">
          <div>
            <Typography variant="caption" sx={fieldLabelSx}>
              Full name
            </Typography>
            <TextField
              fullWidth
              size="small"
              placeholder="e.g. Nuwan Perera"
              value={form.fullName}
              onChange={set("fullName")}
              onBlur={blur("fullName")}
              error={errorFor("fullName") !== undefined}
              helperText={errorFor("fullName")}
              disabled={submitting}
              autoComplete="name"
            />
          </div>
          <div>
            <Typography variant="caption" sx={fieldLabelSx}>
              Phone number
            </Typography>
            <TextField
              fullWidth
              size="small"
              placeholder="77 123 4567"
              value={form.phone}
              onChange={set("phone")}
              onBlur={blur("phone")}
              error={errorFor("phone") !== undefined}
              helperText={errorFor("phone") }
              disabled={submitting}
              autoComplete="tel"
              slotProps={{ input: { inputMode: "numeric", startAdornment: <InputAdornment position="start">+94</InputAdornment> } }}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Typography variant="caption" sx={fieldLabelSx}>
                Vehicle type
              </Typography>
              <TextField
                fullWidth
                select
                size="small"
                value={form.vehicleType}
                onChange={set("vehicleType")}
                onBlur={blur("vehicleType")}
                error={errorFor("vehicleType") !== undefined}
                helperText={errorFor("vehicleType")}
                disabled={submitting}
              >
                {vehicleTypes.map((type) => (
                  <MenuItem key={type} value={type}>
                    {type}
                  </MenuItem>
                ))}
              </TextField>
            </div>
            <div>
              <Typography variant="caption" sx={fieldLabelSx}>
                License plate
              </Typography>
              <TextField
                fullWidth
                size="small"
                placeholder="ED-1234"
                value={form.licensePlate}
                onChange={set("licensePlate")}
                onBlur={blur("licensePlate")}
                error={errorFor("licensePlate") !== undefined}
                helperText={errorFor("licensePlate")}
                disabled={submitting}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <Button variant="outlined" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => void submit()}
            disabled={submitting}
            startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {submitting ? "Adding…" : "Add Driver"}
          </Button>
        </div>
      </Dialog>

      <Snackbar
        open={toast !== null}
        autoHideDuration={4200}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity={toast?.severity ?? "info"} variant="filled" onClose={() => setToast(null)}>
          {toast?.message}
        </Alert>
      </Snackbar>
    </>
  );
}
