"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import Avatar from "@mui/material/Avatar";
import Badge from "@mui/material/Badge";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import InputAdornment from "@mui/material/InputAdornment";
import GridViewRoundedIcon from "@mui/icons-material/GridViewRounded";
import LocalShippingOutlinedIcon from "@mui/icons-material/LocalShippingOutlined";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import BarChartRoundedIcon from "@mui/icons-material/BarChartRounded";
import PeopleAltOutlinedIcon from "@mui/icons-material/PeopleAltOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import HelpOutlineRoundedIcon from "@mui/icons-material/HelpOutlineRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import WbSunnyOutlinedIcon from "@mui/icons-material/WbSunnyOutlined";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import NotificationsNoneRoundedIcon from "@mui/icons-material/NotificationsNoneRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import MoreHorizRoundedIcon from "@mui/icons-material/MoreHorizRounded";
import AssignmentTurnedInOutlinedIcon from "@mui/icons-material/AssignmentTurnedInOutlined";
import CancelOutlinedIcon from "@mui/icons-material/CancelOutlined";
import UndoRoundedIcon from "@mui/icons-material/UndoRounded";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import CalendarMonthOutlinedIcon from "@mui/icons-material/CalendarMonthOutlined";
import FilterListRoundedIcon from "@mui/icons-material/FilterListRounded";
import FileUploadOutlinedIcon from "@mui/icons-material/FileUploadOutlined";
import UnfoldMoreRoundedIcon from "@mui/icons-material/UnfoldMoreRounded";
import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import DirectionsCarOutlinedIcon from "@mui/icons-material/DirectionsCarOutlined";
import PersonOutlineRoundedIcon from "@mui/icons-material/PersonOutlineRounded";

const kpis = [
  { label: "Total Delivered", value: "200,913", delta: "-6%", positive: false, icon: <AssignmentTurnedInOutlinedIcon fontSize="small" /> },
  { label: "On Delivery", value: "1,290", delta: "+12%", positive: true, icon: <LocalShippingOutlinedIcon fontSize="small" /> },
  { label: "Canceled", value: "102", delta: "-3%", positive: false, icon: <CancelOutlinedIcon fontSize="small" /> },
  { label: "Returned", value: "292", delta: "-2%", positive: false, icon: <UndoRoundedIcon fontSize="small" /> },
];

const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthlyValues = [2.1, 2.6, 2.2, 3.1, 2.8, 4.5, 3.2, 2.9, 2.4, 2.7, 3.0, 2.6]; 
const HIGHLIGHT_INDEX = 5;
const CHART_MAX = 4.8;

const trackingSteps = [
  { label: "Delivery", detail: "On Truck #263", time: "Today, 10:45 AM", active: true },
  { label: "Transit", detail: "At warehouse 21, 13 Simone Weil Avenue", time: "10/12/2023, 10:45 AM", active: false },
  { label: "Transit", detail: "At warehouse 10, 90 St Maurices Road", time: "09/12/2023, 10:45 AM", active: false },
];

type ShipmentStatus = "ON_DELIVERY" | "PENDING" | "DELIVERED";

interface Shipment {
  no: string;
  receipt: string;
  destination: string;
  recipient: string;
  items: string[];
  date: string;
  status: ShipmentStatus;
}

const shipments: Shipment[] = [
  { no: "1", receipt: "X1328AU2178DF", destination: "90 Glenurquhart Road, Balli…", recipient: "Jocelyn Rhiel M…", items: ["1x Phone Case", "1x iPhone 15…"], date: "22/10/2023", status: "ON_DELIVERY" },
  { no: "2", receipt: "X1324SD3182DF", destination: "27 Dunmow Road, Gretna…", recipient: "Davis Philips", items: ["1x Fan Cooler"], date: "21/10/2023", status: "ON_DELIVERY" },
  { no: "3", receipt: "X1290KD4821HG", destination: "15 Kandy Road, Kadawatha", recipient: "Nuwan Perera", items: ["2x Car Tyres"], date: "21/10/2023", status: "ON_DELIVERY" },
  { no: "4", receipt: "X1288PL5520QW", destination: "4 Galle Road, Bambalapitiya", recipient: "Sameera Fonseka", items: ["1x Tool Kit"], date: "20/10/2023", status: "PENDING" },
  { no: "5", receipt: "X1277MN9034ZX", destination: "88 Negombo Road, Kurunegala", recipient: "Kasun Silva", items: ["3x Solar Panels"], date: "20/10/2023", status: "PENDING" },
  { no: "6", receipt: "X1265QR7712AB", destination: "12 Baseline Road, Colombo 09", recipient: "Ishara Bandara", items: ["1x Generator"], date: "19/10/2023", status: "DELIVERED" },
  { no: "7", receipt: "X1260TT3348CD", destination: "45 Anuradhapura Road, Dambulla", recipient: "Dilan Jayasuriya", items: ["2x Water Pumps"], date: "18/10/2023", status: "DELIVERED" },
];

const tabs: { key: ShipmentStatus; label: string; count: string }[] = [
  { key: "ON_DELIVERY", label: "On Delivery", count: "200" },
  { key: "PENDING", label: "Pending", count: "200" },
  { key: "DELIVERED", label: "Delivered", count: "1.2k" },
];

const navMain = [
  { label: "Overview", icon: <GridViewRoundedIcon fontSize="small" />, active: true },
  { label: "Shipment", icon: <LocalShippingOutlinedIcon fontSize="small" /> },
  { label: "Tracking", icon: <PlaceOutlinedIcon fontSize="small" /> },
  { label: "Analytic", icon: <BarChartRoundedIcon fontSize="small" /> },
];

const navSecondary = [
  { label: "Inventory", icon: <Inventory2OutlinedIcon fontSize="small" /> },
  { label: "Setting", icon: <SettingsOutlinedIcon fontSize="small" /> },
  { label: "Help & Support", icon: <HelpOutlineRoundedIcon fontSize="small" /> },
];

function NavItem({
  label,
  icon,
  active,
  indent,
  collapsed,
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  indent?: boolean;
  collapsed?: boolean;
}) {
  return (
    <a
      href="#"
      title={label}
      className="flex items-center rounded-xl py-2.5 text-sm font-semibold no-underline transition-colors"
      style={{
        gap: collapsed ? 0 : 12,
        justifyContent: collapsed ? "center" : "flex-start",
        paddingLeft: collapsed ? 0 : indent ? 40 : 14,
        paddingRight: collapsed ? 0 : 14,
        color: active ? "#1e3a8a" : "rgba(15, 23, 42, 0.72)",
        backgroundColor: active ? "rgba(30, 58, 138, 0.08)" : "transparent",
      }}
    >
      <span style={{ color: active ? "#1e3a8a" : "rgba(15, 23, 42, 0.5)", display: "flex" }}>{icon}</span>
      {!collapsed && label}
    </a>
  );
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const [mode, setMode] = React.useState<"light" | "dark">("light");

  return (
    <aside
      className="sticky top-0 hidden h-screen shrink-0 flex-col border-r border-[#eef2f7] bg-white py-5 transition-[width] duration-200 md:flex"
      style={{ width: collapsed ? 76 : 240, paddingLeft: collapsed ? 12 : 16, paddingRight: collapsed ? 12 : 16 }}
    >
      {/* Logo + collapse toggle */}
      <div className={collapsed ? "flex flex-col items-center gap-3" : "flex items-center gap-2.5 px-1.5"}>
        <Image
          src="/logo.png"
          alt="SwiftMove logo"
          width={36}
          height={36}
          priority
          style={{ borderRadius: 8, flexShrink: 0 }}
        />
        {!collapsed && (
          <Typography noWrap sx={{ fontWeight: 800, fontSize: 17, color: "#0f172a", letterSpacing: "-0.01em" }}>
            SwiftMove
          </Typography>
        )}
        <IconButton
          size="small"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          sx={{ color: "rgba(15,23,42,0.45)", ml: collapsed ? 0 : "auto" }}
        >
          {collapsed ? <ChevronRightRoundedIcon fontSize="small" /> : <ChevronLeftRoundedIcon fontSize="small" />}
        </IconButton>
      </div>

      {/* Search */}
      {collapsed ? (
        <IconButton sx={{ mt: 3, mx: "auto", color: "rgba(15,23,42,0.5)" }} aria-label="search">
          <SearchRoundedIcon fontSize="small" />
        </IconButton>
      ) : (
        <TextField
          size="small"
          placeholder="Search"
          fullWidth
          sx={{
            mt: 3,
            "& .MuiOutlinedInput-root": {
              borderRadius: "12px",
              backgroundColor: "#f1f5f9",
              "& fieldset": { border: "none" },
            },
          }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchRoundedIcon sx={{ fontSize: 18, color: "rgba(15,23,42,0.4)" }} />
                </InputAdornment>
              ),
            },
          }}
        />
      )}

      {/* Navigation */}
      <nav className="mt-4 flex flex-col gap-0.5">
        {navMain.map((n) => (
          <NavItem key={n.label} {...n} collapsed={collapsed} />
        ))}
        <NavItem label="Unit" icon={<PeopleAltOutlinedIcon fontSize="small" />} collapsed={collapsed} />
        <NavItem label="Vehicle" icon={<DirectionsCarOutlinedIcon fontSize="small" />} indent collapsed={collapsed} />
        <NavItem label="Driver" icon={<PersonOutlineRoundedIcon fontSize="small" />} indent collapsed={collapsed} />
        {navSecondary.map((n) => (
          <NavItem key={n.label} {...n} collapsed={collapsed} />
        ))}
      </nav>

      <div className="flex-1" />

      {/* Light / Dark toggle */}
      {collapsed ? (
        <IconButton
          onClick={() => setMode(mode === "light" ? "dark" : "light")}
          sx={{ mx: "auto", color: "rgba(15,23,42,0.5)" }}
          aria-label="Toggle light / dark"
        >
          {mode === "light" ? <WbSunnyOutlinedIcon sx={{ fontSize: 18 }} /> : <DarkModeOutlinedIcon sx={{ fontSize: 18 }} />}
        </IconButton>
      ) : (
        <div className="mx-1 flex rounded-full bg-[#f1f5f9] p-1">
          {(["light", "dark"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full border-0 py-1.5 text-xs font-bold capitalize transition-colors"
              style={{
                backgroundColor: mode === m ? "#fff" : "transparent",
                color: mode === m ? "#0f172a" : "rgba(15,23,42,0.45)",
                boxShadow: mode === m ? "0 1px 3px rgb(0 0 0 / 0.08)" : "none",
              }}
            >
              {m === "light" ? <WbSunnyOutlinedIcon sx={{ fontSize: 15 }} /> : <DarkModeOutlinedIcon sx={{ fontSize: 15 }} />}
              {m}
            </button>
          ))}
        </div>
      )}

      {/* Profile */}
      {collapsed ? (
        <Avatar sx={{ width: 36, height: 36, bgcolor: "#1e3a8a", fontSize: 14, fontWeight: 700, mx: "auto", mt: 2 }}>
          TR
        </Avatar>
      ) : (
        <div className="mt-3 flex items-center gap-2.5 rounded-xl px-1.5 py-2">
          <Avatar sx={{ width: 36, height: 36, bgcolor: "#1e3a8a", fontSize: 14, fontWeight: 700 }}>TR</Avatar>
          <div className="min-w-0 flex-1">
            <Typography variant="body2" noWrap sx={{ fontWeight: 700, lineHeight: 1.25 }}>
              Terry Rosser
            </Typography>
            <Typography variant="caption" noWrap sx={{ color: "rgba(15,23,42,0.5)", display: "block", lineHeight: 1.25 }}>
              terryr@gmail.com
            </Typography>
          </div>
          <UnfoldMoreRoundedIcon sx={{ fontSize: 18, color: "rgba(15,23,42,0.4)" }} />
        </div>
      )}
    </aside>
  );
}

export default function OverviewPage() {
  const [activeTab, setActiveTab] = React.useState<ShipmentStatus>("ON_DELIVERY");
  const [range, setRange] = React.useState<"12m" | "3m">("12m");
  const [collapsed, setCollapsed] = React.useState(false);

  const barIndexes = range === "12m" ? monthlyValues.map((_, i) => i) : [9, 10, 11];
  const rows = shipments.filter((s) => s.status === activeTab);

  return (
    <div className="flex min-h-screen bg-[#f1f5f9]">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />

      <main className="min-w-0 flex-1 px-6 py-6 lg:px-8">
        {/* Header */}
        <div className="anim-fade-up mb-6 flex items-center justify-between gap-4">
          <Typography sx={{ fontWeight: 800, fontSize: 24, color: "#0f172a", letterSpacing: "-0.01em" }}>
            Overview
          </Typography>
          <div className="flex items-center gap-3">
            <IconButton sx={{ color: "#0f172a" }} aria-label="notifications">
              <Badge color="error" variant="dot">
                <NotificationsNoneRoundedIcon />
              </Badge>
            </IconButton>
            <span className="hover-lift inline-block">
              <Button
                component={Link}
                href="/jobs"
                variant="contained"
                startIcon={<AddRoundedIcon />}
                sx={{
                  bgcolor: "#1e3a8a",
                  borderRadius: "10px",
                  px: 2.5,
                  "&:hover": { bgcolor: "#172554" },
                }}
              >
                Add New Shipping
              </Button>
            </span>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((kpi, i) => (
            <div key={kpi.label} className="anim-fade-up hover-lift" style={{ animationDelay: `${80 + i * 70}ms` }}>
              <div className="rounded-2xl bg-white p-5" style={{ boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.05)" }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2" style={{ color: "rgba(15,23,42,0.55)" }}>
                    {kpi.icon}
                    <Typography variant="body2" sx={{ fontWeight: 600, color: "rgba(15,23,42,0.7)" }}>
                      {kpi.label}
                    </Typography>
                  </div>
                  <IconButton size="small" sx={{ color: "rgba(15,23,42,0.35)" }} aria-label="more">
                    <MoreHorizRoundedIcon fontSize="small" />
                  </IconButton>
                </div>
                <Typography sx={{ mt: 1.5, fontSize: 30, fontWeight: 800, color: "#0f172a", lineHeight: 1.1 }}>
                  {kpi.value}
                </Typography>
                <div className="mt-2 flex items-center gap-1.5">
                  <span
                    className="rounded-md px-1.5 py-0.5 text-[11px] font-bold"
                    style={
                      kpi.positive
                        ? { backgroundColor: "rgba(22,163,74,0.1)", color: "#16a34a" }
                        : { backgroundColor: "rgba(220,38,38,0.08)", color: "#dc2626" }
                    }
                  >
                    {kpi.delta}
                  </span>
                  <Typography variant="caption" sx={{ color: "rgba(15,23,42,0.45)" }}>
                    vs last month
                  </Typography>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Middle: chart + live tracking */}
        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          {/* Bar chart */}
          <div className="anim-fade-up" style={{ animationDelay: "360ms" }}>
            <div className="h-full rounded-2xl bg-white p-5" style={{ boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.05)" }}>
              <div className="flex items-center justify-between">
                <Typography sx={{ fontWeight: 800, fontSize: 16, color: "#0f172a" }}>Avg. Monthly Delivered</Typography>
                <span className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-500">
                  <CalendarMonthOutlinedIcon sx={{ fontSize: 14 }} /> 2023
                </span>
              </div>

              {/* Range toggle */}
              <div className="mt-3 flex gap-5 border-b border-slate-100">
                {(["12m", "3m"] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setRange(r)}
                    className="cursor-pointer border-0 bg-transparent pb-2 text-sm font-bold transition-colors"
                    style={{
                      color: range === r ? "#1e3a8a" : "rgba(15,23,42,0.45)",
                      borderBottom: range === r ? "2px solid #1e3a8a" : "2px solid transparent",
                    }}
                  >
                    {r === "12m" ? "12 Months" : "3 Months"}
                  </button>
                ))}
              </div>

              <div className="mt-4 flex items-center gap-2">
                <Typography sx={{ fontSize: 28, fontWeight: 800, color: "#0f172a", lineHeight: 1 }}>4,568</Typography>
                <span
                  className="rounded-md px-1.5 py-0.5 text-[11px] font-bold"
                  style={{ backgroundColor: "rgba(22,163,74,0.1)", color: "#16a34a" }}
                >
                  +12%
                </span>
                <Typography variant="caption" sx={{ color: "rgba(15,23,42,0.45)" }}>
                  vs last month
                </Typography>
              </div>

              {/* Chart */}
              <div className="relative mt-4 h-[190px]">
                {[1, 2, 3].map((g) => (
                  <div
                    key={g}
                    className="absolute inset-x-8 border-t border-dashed border-slate-200"
                    style={{ bottom: `calc(${(g / CHART_MAX) * 100}% - 18px)` }}
                  >
                    <span className="absolute -top-2 left-[-26px] text-[10px] font-semibold text-slate-400">{g}k</span>
                  </div>
                ))}
                <div className="absolute inset-x-8 inset-y-0 flex items-stretch justify-between gap-2">
                  {barIndexes.map((i) => {
                    const height = (monthlyValues[i] / CHART_MAX) * 100;
                    const highlighted = i === HIGHLIGHT_INDEX;
                    return (
                      <div key={i} className="flex min-w-0 flex-1 flex-col items-center justify-end">
                        <div className="relative flex w-full flex-1 items-end justify-center">
                          {highlighted && (
                            <span
                              className="absolute z-10 rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white"
                              style={{ bottom: `calc(${height}% + 6px)`, backgroundColor: "#0f172a" }}
                            >
                              {monthlyValues[i]}k
                            </span>
                          )}
                          <div
                            className="w-full max-w-[26px] rounded-t-md"
                            style={{
                              height: `${height}%`,
                              backgroundColor: highlighted ? "#1e3a8a" : "rgba(30, 58, 138, 0.18)",
                            }}
                          />
                        </div>
                        <span className="mt-1.5 text-[10px] font-semibold text-slate-400">{monthLabels[i]}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Live tracking */}
          <div className="anim-fade-up" style={{ animationDelay: "440ms" }}>
            <div className="h-full rounded-2xl bg-white p-5" style={{ boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.05)" }}>
              <div className="flex items-center justify-between">
                <Typography sx={{ fontWeight: 800, fontSize: 16, color: "#0f172a" }}>Live Shipment Tracking</Typography>
                <IconButton size="small" sx={{ color: "rgba(15,23,42,0.35)" }} aria-label="more">
                  <MoreHorizRoundedIcon fontSize="small" />
                </IconButton>
              </div>

              <div className="mt-2 flex items-baseline gap-1.5">
                <Typography sx={{ fontSize: 28, fontWeight: 800, color: "#0f172a", lineHeight: 1 }}>2.5km</Typography>
                <Typography variant="caption" sx={{ color: "rgba(15,23,42,0.45)", fontWeight: 600 }}>
                  Left
                </Typography>
              </div>

              <div className="mt-4 flex gap-4">
                {/* Vertical stepper */}
                <div className="min-w-0 flex-1">
                  {trackingSteps.map((step, i) => (
                    <div key={i} className="relative flex gap-3 pb-6 last:pb-0">
                      {i < trackingSteps.length - 1 && (
                        <div className="absolute left-[7px] top-5 h-[calc(100%-16px)] w-px bg-slate-200" />
                      )}
                      <span
                        className="relative z-10 mt-1 block h-[15px] w-[15px] shrink-0 rounded-full"
                        style={
                          step.active
                            ? { backgroundColor: "#1e3a8a", boxShadow: "0 0 0 4px rgba(30,58,138,0.15)" }
                            : { backgroundColor: "#fff", border: "2px solid #cbd5e1" }
                        }
                      />
                      <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Typography variant="body2" sx={{ fontWeight: 700, color: "#0f172a", lineHeight: 1.3 }}>
                            {step.label}
                          </Typography>
                          <Typography variant="caption" noWrap sx={{ color: "rgba(15,23,42,0.5)", display: "block" }}>
                            {step.detail}
                          </Typography>
                        </div>
                        <Typography variant="caption" sx={{ color: "rgba(15,23,42,0.45)", whiteSpace: "nowrap" }}>
                          {step.time}
                        </Typography>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Map placeholder */}
                <div className="relative h-[190px] w-[170px] shrink-0 overflow-hidden rounded-xl">
                  <svg viewBox="0 0 200 150" className="h-full w-full" role="img" aria-label="Route map placeholder">
                    <rect width="200" height="150" fill="#e8edf3" />
                    <rect x="18" y="18" width="52" height="34" rx="8" fill="#dcebdd" />
                    <rect x="132" y="86" width="52" height="42" rx="8" fill="#dcebdd" />
                    <path d="M0 62 H200" stroke="#ffffff" strokeWidth="9" />
                    <path d="M64 0 V150" stroke="#ffffff" strokeWidth="9" />
                    <path d="M0 112 H200" stroke="#ffffff" strokeWidth="6" />
                    <path d="M142 0 V150" stroke="#ffffff" strokeWidth="6" />
                    <path d="M22 122 C 62 112, 72 72, 102 62 S 162 42, 176 32" stroke="#1e3a8a" strokeWidth="3.5" fill="none" strokeLinecap="round" />
                    <circle cx="22" cy="122" r="5" fill="#1e3a8a" />
                    <circle cx="176" cy="32" r="5" fill="#fff" stroke="#1e3a8a" strokeWidth="3" />
                  </svg>
                  <button className="absolute inset-x-0 bottom-0 cursor-pointer border-0 bg-white/90 py-1.5 text-xs font-bold text-[#1e3a8a] backdrop-blur-sm">
                    View Details
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Shipment table */}
        <div className="anim-fade-up mt-4" style={{ animationDelay: "520ms" }}>
          <div className="rounded-2xl bg-white p-5" style={{ boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.05)" }}>
            <div className="flex items-center justify-between">
              <Typography sx={{ fontWeight: 800, fontSize: 16, color: "#0f172a" }}>Shipment</Typography>
              <div className="flex gap-2">
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<FilterListRoundedIcon fontSize="small" />}
                  sx={{ borderRadius: "10px", borderColor: "#e2e8f0", color: "#0f172a" }}
                >
                  Filter
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<FileUploadOutlinedIcon fontSize="small" />}
                  sx={{ borderRadius: "10px", borderColor: "#e2e8f0", color: "#0f172a" }}
                >
                  Export
                </Button>
              </div>
            </div>

            {/* Tabs */}
            <div className="mt-3 flex gap-6 border-b border-slate-100">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className="flex cursor-pointer items-center gap-1.5 border-0 bg-transparent pb-2 text-sm font-bold transition-colors"
                  style={{
                    color: activeTab === tab.key ? "#1e3a8a" : "rgba(15,23,42,0.45)",
                    borderBottom: activeTab === tab.key ? "2px solid #1e3a8a" : "2px solid transparent",
                  }}
                >
                  {tab.label}
                  <span
                    className="rounded-md px-1.5 py-0.5 text-[10px] font-bold"
                    style={{
                      backgroundColor: activeTab === tab.key ? "rgba(30,58,138,0.1)" : "#f1f5f9",
                      color: activeTab === tab.key ? "#1e3a8a" : "rgba(15,23,42,0.5)",
                    }}
                  >
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>

            <div className="overflow-x-auto">
              <Table size="small" sx={{ minWidth: 860 }}>
                <TableHead>
                  <TableRow>
                    {["No.", "Receipt number", "Destination", "Recipient", "Item", "Date", "Action"].map((h) => (
                      <TableCell key={h} sx={{ borderBottom: "1px solid #f1f5f9", py: 1.5 }}>
                        {h}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.receipt} hover>
                      <TableCell sx={{ borderBottom: "1px solid #f8fafc", color: "rgba(15,23,42,0.6)" }}>{row.no}</TableCell>
                      <TableCell sx={{ borderBottom: "1px solid #f8fafc" }}>
                        <span className="flex items-center gap-1.5 font-semibold text-[#0f172a]">
                          {row.receipt}
                          <ContentCopyRoundedIcon sx={{ fontSize: 13, color: "rgba(15,23,42,0.3)" }} />
                        </span>
                      </TableCell>
                      <TableCell sx={{ borderBottom: "1px solid #f8fafc", color: "rgba(15,23,42,0.75)" }}>{row.destination}</TableCell>
                      <TableCell sx={{ borderBottom: "1px solid #f8fafc", color: "rgba(15,23,42,0.75)" }}>{row.recipient}</TableCell>
                      <TableCell sx={{ borderBottom: "1px solid #f8fafc" }}>
                        {row.items.map((it) => (
                          <Typography key={it} variant="body2" sx={{ fontWeight: 600, color: "#0f172a", lineHeight: 1.35 }}>
                            {it}
                          </Typography>
                        ))}
                      </TableCell>
                      <TableCell sx={{ borderBottom: "1px solid #f8fafc", color: "rgba(15,23,42,0.75)", whiteSpace: "nowrap" }}>
                        {row.date}
                      </TableCell>
                      <TableCell sx={{ borderBottom: "1px solid #f8fafc" }}>
                        <Button
                          size="small"
                          variant="outlined"
                          sx={{
                            borderRadius: "999px",
                            borderColor: "rgba(30,58,138,0.35)",
                            color: "#1e3a8a",
                            px: 2,
                            "&:hover": { borderColor: "#1e3a8a", bgcolor: "rgba(30,58,138,0.06)" },
                          }}
                        >
                          Details
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
