"use client";

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { verifyPin } from "@/app/actions/auth";

const PIN_LENGTH = 4;

export default function LoginPage() {
  const router = useRouter();
  const [pin, setPin] = React.useState<string[]>(Array(PIN_LENGTH).fill(""));
  const inputRefs = React.useRef<(HTMLInputElement | null)[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const pinValue = pin.join("");

  const focusInput = (index: number) => {
    inputRefs.current[index]?.focus();
    inputRefs.current[index]?.select();
  };

  const handleChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    setPin((prev) => {
      const next = [...prev];
      next[index] = digit;
      return next;
    });
    if (digit && index < PIN_LENGTH - 1) {
      focusInput(index + 1);
    }
  };

  const handleKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && !pin[index] && index > 0) {
      event.preventDefault();
      setPin((prev) => {
        const next = [...prev];
        next[index - 1] = "";
        return next;
      });
      focusInput(index - 1);
    } else if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      focusInput(index - 1);
    } else if (event.key === "ArrowRight" && index < PIN_LENGTH - 1) {
      event.preventDefault();
      focusInput(index + 1);
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const digits = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, PIN_LENGTH);
    if (!digits) return;
    const next = Array(PIN_LENGTH).fill("");
    digits.split("").forEach((digit, i) => {
      next[i] = digit;
    });
    setPin(next);
    focusInput(Math.min(digits.length, PIN_LENGTH - 1));
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pinValue.length !== PIN_LENGTH || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await verifyPin(pinValue);
        if (result.success) {
          router.replace("/");
          router.refresh();
        } else {
          setError(result.error);
          setPin(Array(PIN_LENGTH).fill(""));
          focusInput(0);
        }
      } catch {
        setError("Could not reach the server. Please try again.");
      }
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f1f5f9] px-4">
      <Paper
        elevation={0}
        sx={{
          width: "100%",
          maxWidth: 400,
          p: { xs: 4, sm: 5 },
          borderRadius: 3,
          border: "1px solid rgba(30, 58, 138, 0.28)",
          bgcolor: "#ffffff",
          boxShadow: "0 12px 32px rgba(30, 58, 138, 0.12)",
        }}
      >
        {/* Brand — logo already contains the SwiftMove wordmark */}
        <div className="mb-8 flex flex-col items-center justify-center gap-3">
          <Image
            src="/logo.png"
            alt="SwiftMove Logistics logo"
            width={150}
            height={150}
            priority
            className="mx-auto"
          />
          <Typography variant="caption" sx={{ color: "#94a3b8", letterSpacing: "0.16em", fontSize: 10 }}>
            CONTROL ROOM
          </Typography>
        </div>

        <div className="mb-6 text-center">
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Welcome back
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Enter your 4-digit admin PIN to continue
          </Typography>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex justify-center gap-4 my-6">
            {pin.map((digit, index) => (
              <input
                key={index}
                ref={(el) => {
                  inputRefs.current[index] = el;
                }}
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={1}
                value={digit}
                autoFocus={index === 0}
                autoComplete={index === 0 ? "one-time-code" : "off"}
                disabled={pending}
                aria-label={`PIN digit ${index + 1}`}
                onChange={(event) => handleChange(index, event.target.value)}
                onKeyDown={(event) => handleKeyDown(index, event)}
                onPaste={handlePaste}
                className="w-14 h-16 text-center text-2xl font-bold border-2 border-slate-200 rounded-xl focus:border-blue-900 focus:ring-2 focus:ring-blue-900 outline-none transition-all disabled:opacity-50"
              />
            ))}
          </div>

          {error && (
            <Alert severity="error" sx={{ borderRadius: 2 }}>
              {error}
            </Alert>
          )}

          <Button
            type="submit"
            variant="contained"
            size="large"
            fullWidth
            disabled={pinValue.length !== PIN_LENGTH || pending}
            startIcon={pending ? <CircularProgress size={16} color="inherit" /> : undefined}
            sx={{ bgcolor: "#1e3a8a", py: 1.4, fontWeight: 700, "&:hover": { bgcolor: "#172554" } }}
          >
            {pending ? "Verifying…" : "Login"}
          </Button>
        </form>
      </Paper>
    </div>
  );
}
