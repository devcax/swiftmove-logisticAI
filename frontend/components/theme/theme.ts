"use client";

import { createTheme } from "@mui/material/styles";

const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#1e3a8a",
      dark: "#172554",
      light: "#4c62a6",
    },
    secondary: {
      main: "#0f172a",
    },
    success: { main: "#16a34a" },
    warning: { main: "#d97706" },
    error: { main: "#dc2626" },
    info: { main: "#0284c7" },
    background: {
      default: "#f1f5f9",
      paper: "#ffffff",
    },
    text: {
      primary: "#0f172a",
      secondary: "#64748b",
    },
    divider: "#e2e8f0",
  },
  shape: {
    borderRadius: 8,
  },
  typography: {
    fontFamily:
      "var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, sans-serif",
    button: {
      textTransform: "none",
      fontWeight: 600,
    },
    h4: { fontWeight: 700 },
    h5: { fontWeight: 700 },
    h6: { fontWeight: 700 },
    subtitle2: { fontWeight: 600 },
  },
  components: {
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: "none",
          border: "1px solid #e2e8f0",
          boxShadow: "none",
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: 8,
          paddingInline: 18,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600 },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          fontWeight: 700,
          color: "#475569",
          fontSize: "0.75rem",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          background: "#f8fafc",
          whiteSpace: "nowrap",
        },
        root: { borderColor: "#eef2f7" },
      },
    },
    MuiTooltip: {
      defaultProps: { arrow: true },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundImage: "none",
          border: "1px solid #e2e8f0",
          boxShadow: "0 8px 24px rgba(15,23,42,0.12)",
        },
      },
    },
  },
});

export default theme;
