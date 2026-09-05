"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import AppBar from "@mui/material/AppBar";
import Avatar from "@mui/material/Avatar";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemIcon from "@mui/material/ListItemIcon";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Toolbar from "@mui/material/Toolbar";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import ChatBubbleOutlineRoundedIcon from "@mui/icons-material/ChatBubbleOutlineRounded";
import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import ExpandLessRoundedIcon from "@mui/icons-material/ExpandLessRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import GridViewRoundedIcon from "@mui/icons-material/GridViewRounded";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import ListAltOutlinedIcon from "@mui/icons-material/ListAltOutlined";
import SensorsRoundedIcon from "@mui/icons-material/SensorsRounded";
import MenuRoundedIcon from "@mui/icons-material/MenuRounded";
import PeopleAltOutlinedIcon from "@mui/icons-material/PeopleAltOutlined";
import ReportProblemOutlinedIcon from "@mui/icons-material/ReportProblemOutlined";
import PlaylistAddCheckRoundedIcon from "@mui/icons-material/PlaylistAddCheckRounded";
import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import {
  fetchSidebarCounts,
  fetchSidebarNotifications,
  type ApiSidebarNotifications,
} from "@/lib/api";
import { logout } from "@/app/actions/auth";

const DRAWER_WIDTH = 288;
const COLLAPSED_WIDTH = 76;

interface NavChild {
  label: string;
  href: string;
  icon: React.ReactNode;
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  badgeKey?: keyof SidebarBadgeCounts;
  children?: NavChild[];
}

interface SidebarBadgeCounts {
  jobs: number;
  conversations: number;
  incidents: number;
  requests: number;
}

const navItems: NavItem[] = [
  { label: "Operations", href: "/", icon: <GridViewRoundedIcon sx={{ fontSize: 22 }} /> },
  {
    label: "Jobs",
    href: "/jobs",
    icon: <Inventory2OutlinedIcon sx={{ fontSize: 22 }} />,
    badgeKey: "jobs",
    children: [
      { label: "Manage Jobs", href: "/jobs", icon: <ListAltOutlinedIcon sx={{ fontSize: 16 }} /> },
      { label: "Live", href: "/jobs/live", icon: <SensorsRoundedIcon sx={{ fontSize: 16 }} /> },
    ],
  },
  { label: "Requests", href: "/requests", icon: <PlaylistAddCheckRoundedIcon sx={{ fontSize: 22 }} />, badgeKey: "requests" },
  { label: "Conversations", href: "/conversations", icon: <ChatBubbleOutlineRoundedIcon sx={{ fontSize: 22 }} />, badgeKey: "conversations" },
  { label: "Incidents", href: "/incidents", icon: <ReportProblemOutlinedIcon sx={{ fontSize: 22 }} />, badgeKey: "incidents" },
  { label: "Drivers", href: "/drivers", icon: <PeopleAltOutlinedIcon sx={{ fontSize: 22 }} /> },
];

function navButtonSx(active: boolean, collapsed = false) {
  return {
    borderRadius: 3,
    py: 1.5,
    px: collapsed ? 0 : 2,
    width: "100%",
    justifyContent: collapsed ? "center" : "flex-start",
    color: active ? "#fff" : "#334155",
    backgroundColor: active ? "#1e3a8a" : "transparent",
    transition: "all 0.2s ease-in-out",
    "& .MuiListItemIcon-root": {
      color: active ? "#fff" : "#475569",
      transition: "color 0.2s ease-in-out",
    },
    "&.Mui-selected": {
      backgroundColor: "#1e3a8a",
      "&:hover": { backgroundColor: "#172554" },
    },
    "&:hover": {
      backgroundColor: active ? "#172554" : "#e2e8f0",
      color: active ? "#fff" : "#0f172a",
      "& .MuiListItemIcon-root": { color: active ? "#fff" : "#0f172a" },
    },
  } as const;
}

interface PageMeta {
  title: string;
  subtitle: string;
}

function pageMetaFor(pathname: string, today: string): PageMeta {
  if (pathname === "/" || pathname === "/dashboard") {
    return {
      title: "Operations Overview",
      subtitle: today ? `${today} · live feed from the WhatsApp bot` : "live feed from the WhatsApp bot",
    };
  }
  if (pathname.startsWith("/jobs/live")) {
    return {
      title: "Live Job Tracking",
      subtitle: "",
    };
  }
  if (pathname.startsWith("/jobs")) {
    return {
      title: "Job Management & Publication",
      subtitle: "",
    };
  }
  if (pathname.startsWith("/requests")) {
    return { title: "Driver Request Queue", subtitle: "" };
  }
  if (pathname.startsWith("/conversations")) {
    return { title: "Manager · Driver Conversations", subtitle: "" };
  }
  if (pathname.startsWith("/incidents")) {
    return { title: "Incident Center", subtitle: "" };
  }
  if (pathname.startsWith("/drivers")) {
    return { title: "Driver Registry", subtitle: "" };
  }
  return { title: "SwiftMove", subtitle: "" };
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isJobsChildActive(pathname: string, href: string) {
  if (href === "/jobs") {
    return pathname === "/jobs" || (pathname.startsWith("/jobs/") && !pathname.startsWith("/jobs/live"));
  }
  return isActive(pathname, href);
}

function notificationCount(currentIds: string[], previousIds: string[]) {
  const previous = new Set(previousIds);
  return currentIds.filter((id) => !previous.has(id)).length;
}

function SidebarNotificationBadge({
  count,
  incident = false,
}: {
  count: number;
  incident?: boolean;
}) {
  if (count === 0) return null;
  return (
    <span
      className={`flex h-[20px] min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold text-white ${
        incident ? "bg-red-600" : "bg-orange-500"
      }`}
      aria-label={`${count} new ${incident ? "incident" : "notification"}${count === 1 ? "" : "s"}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function SidebarContent({
  collapsed = false,
  counts,
  onToggle,
  onNavigate,
}: {
  collapsed?: boolean;
  counts: SidebarBadgeCounts;
  onToggle?: () => void;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>({});

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      style={{ backgroundColor: "#f8fafc", borderRight: "1px solid #e2e8f0" }}
    >
      
      <div
        className={collapsed ? "flex flex-col items-center gap-2" : "relative flex flex-col items-center justify-center mt-2"}
        style={{ padding: collapsed ? "12px 8px" : "12px 24px 8px" }}
      >
        <Link
          href="/"
          className={collapsed ? "flex min-w-0 items-center no-underline" : "flex min-w-0 flex-col items-center no-underline"}
          onClick={onNavigate}
        >
          <Image
            src="/logo.png"
            alt="SwiftMove logo"
            width={collapsed ? 40 : 96}
            height={collapsed ? 40 : 96}
            priority
            className={collapsed ? "" : "w-24 h-auto"}
            style={{ borderRadius: 8, flexShrink: 0, display: "block" }}
          />
          {!collapsed && (
            <p className="text-xs text-slate-500 tracking-widest uppercase mt-1 font-semibold">Control Room</p>
          )}
        </Link>
        {onToggle && (
          <IconButton
            size="small"
            onClick={onToggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            sx={
              collapsed
                ? { color: "#64748b", "&:hover": { color: "#0f172a" } }
                : { color: "#64748b", position: "absolute", top: 4, right: 8, "&:hover": { color: "#0f172a" } }
            }
          >
            {collapsed ? <ChevronRightRoundedIcon fontSize="small" /> : <ChevronLeftRoundedIcon fontSize="small" />}
          </IconButton>
        )}
      </div>

      
      <List sx={{ px: collapsed ? 1.5 : 2, pt: 1, flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
        {navItems.map((item) => {
          const active = isActive(pathname, item.href);
          const badgeCount = item.badgeKey ? counts[item.badgeKey] : 0;

          if (item.children && !collapsed) {
            const childActive = item.children.some((child) => isJobsChildActive(pathname, child.href));
            const expanded = openGroups[item.label] ?? childActive;
            return (
              <div key={item.label}>
                <ListItemButton
                  onClick={() => setOpenGroups((prev) => ({ ...prev, [item.label]: !expanded }))}
                  sx={navButtonSx(childActive)}
                >
                  <ListItemIcon sx={{ minWidth: 38, justifyContent: "center" }}>
                    {item.icon}
                  </ListItemIcon>
                  <ListItemText
                    primary={item.label}
                    slotProps={{ primary: { sx: { fontSize: 14.5, fontWeight: childActive ? 700 : 500 } } }}
                  />
                  <SidebarNotificationBadge
                    count={badgeCount}
                    incident={item.badgeKey === "incidents"}
                  />
                  {expanded ? (
                    <ExpandLessRoundedIcon sx={{ fontSize: 18, color: "#94a3b8" }} />
                  ) : (
                    <ExpandMoreRoundedIcon sx={{ fontSize: 18, color: "#94a3b8" }} />
                  )}
                </ListItemButton>
                {expanded && (
                  <div style={{ marginLeft: 35, marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                    {item.children.map((child) => {
                      const activeChild = isJobsChildActive(pathname, child.href);
                      return (
                        <Link key={child.href} href={child.href} onClick={onNavigate} className="block w-full no-underline">
                          <ListItemButton
                            selected={activeChild}
                            sx={{
                              py: 1,
                              px: 2,
                              width: "100%",
                              justifyContent: "flex-start",
                              borderLeft: "2px solid",
                              borderColor: activeChild ? "#1e3a8a" : "#cbd5e1",
                              borderRadius: "0 8px 8px 0",
                              color: activeChild ? "#1e3a8a" : "#475569",
                              backgroundColor: activeChild ? "rgba(30, 58, 138, 0.08)" : "transparent",
                              transition: "all 0.2s ease-in-out",
                              "&.Mui-selected": {
                                backgroundColor: "rgba(30, 58, 138, 0.08)",
                                "&:hover": { backgroundColor: "rgba(30, 58, 138, 0.14)" },
                              },
                              "&:hover": {
                                backgroundColor: "#e2e8f0",
                                color: "#0f172a",
                                "& .MuiListItemIcon-root": { color: "#0f172a" },
                              },
                            }}
                          >
                            <ListItemIcon
                              sx={{
                                minWidth: 24,
                                justifyContent: "center",
                                color: activeChild ? "#1e3a8a" : "#64748b",
                                transition: "color 0.2s ease-in-out",
                              }}
                            >
                              {child.icon}
                            </ListItemIcon>
                            <ListItemText
                              primary={child.label}
                              slotProps={{ primary: { sx: { fontSize: 14, fontWeight: activeChild ? 700 : 500 } } }}
                            />
                          </ListItemButton>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className="block w-full no-underline"
            >
              <Tooltip title={collapsed ? item.label : ""} placement="right" arrow>
                <ListItemButton
                  selected={active}
                  sx={navButtonSx(active, collapsed)}
                >
                  <ListItemIcon sx={{ minWidth: collapsed ? 0 : 38, justifyContent: "center" }}>
                    {collapsed ? (
                      <Badge
                        badgeContent={badgeCount}
                        color={item.badgeKey === "incidents" ? "error" : "warning"}
                        invisible={badgeCount === 0}
                        max={99}
                      >
                        {item.icon}
                      </Badge>
                    ) : (
                      item.icon
                    )}
                  </ListItemIcon>
                  {!collapsed && (
                    <>
                      <ListItemText
                        primary={item.label}
                        slotProps={{ primary: { sx: { fontSize: 14.5, fontWeight: active ? 700 : 500 } } }}
                      />
                     
                      <SidebarNotificationBadge
                        count={badgeCount}
                        incident={item.badgeKey === "incidents"}
                      />
                    </>
                  )}
                </ListItemButton>
              </Tooltip>
            </Link>
          );
        })}
      </List>

      
          </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up("md"));
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);
  const [counts, setCounts] = React.useState<SidebarBadgeCounts>({
    jobs: 0,
    conversations: 0,
    incidents: 0,
    requests: 0,
  });
  const notificationSnapshot = React.useRef<ApiSidebarNotifications | null>(null);
  const [userMenuAnchor, setUserMenuAnchor] = React.useState<null | HTMLElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const [today, setToday] = React.useState("");
  React.useEffect(() => {
    setToday(new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }));
  }, []);
  const meta = pageMetaFor(pathname, today);
  const sidebarWidth = collapsed ? COLLAPSED_WIDTH : DRAWER_WIDTH;

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [sidebarCounts, notifications] = await Promise.all([
          fetchSidebarCounts(),
          fetchSidebarNotifications(),
        ]);
        if (cancelled) return;

        const previous = notificationSnapshot.current;
        notificationSnapshot.current = notifications;

        const path = window.location.pathname;
        const onJobs = path.startsWith("/jobs");
        const onRequests = path.startsWith("/requests");

        if (previous === null) {
          setCounts({
            jobs: 0,
            conversations: sidebarCounts.conversations,
            incidents: notifications.incidentIds.length,
            requests: onRequests ? 0 : notifications.jobRequestIds.length,
          });
          return;
        }

        const newLiveJobs = notificationCount(
          notifications.liveJobStamps,
          previous.liveJobStamps,
        );
        const newIncidents = notificationCount(
          notifications.incidentIds,
          previous.incidentIds,
        );
        const newRequests = notificationCount(
          notifications.jobRequestIds,
          previous.jobRequestIds,
        );

        setCounts((current) => ({
          jobs: onJobs ? 0 : current.jobs + newLiveJobs,
          conversations: sidebarCounts.conversations,
          incidents: current.incidents + newIncidents,
          requests: onRequests ? 0 : current.requests + newRequests,
        }));
      } catch {
      }
    };
    void load();
    const interval = setInterval(() => void load(), 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  React.useEffect(() => {
    if (pathname.startsWith("/jobs")) {
      setCounts((current) =>
        current.jobs === 0 ? current : { ...current, jobs: 0 },
      );
    }
    if (pathname.startsWith("/requests")) {
      setCounts((current) =>
        current.requests === 0 ? current : { ...current, requests: 0 },
      );
    }
  }, [pathname]);

  return (
    <Box className="flex h-screen overflow-hidden bg-[#f6f8fb]">
      {/* Persistent sidebar (desktop) */}
      {isDesktop && (
        <Drawer
          variant="permanent"
          sx={{
            width: sidebarWidth,
            flexShrink: 0,
            transition: "width 0.2s ease",
            "& .MuiDrawer-paper": {
              width: sidebarWidth,
              boxSizing: "border-box",
              border: "none",
              transition: "width 0.2s ease",
              overflowX: "hidden",
            },
          }}
        >
          <SidebarContent collapsed={collapsed} counts={counts} onToggle={() => setCollapsed((c) => !c)} />
        </Drawer>
      )}

      {/* Temporary sidebar (mobile) */}
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{ "& .MuiDrawer-paper": { width: DRAWER_WIDTH, border: "none" } }}
      >
        <SidebarContent counts={counts} onNavigate={() => setMobileOpen(false)} />
      </Drawer>

      {/* Main column */}
      <Box className="flex min-w-0 flex-1 flex-col">
        <AppBar
          position="static"
          elevation={0}
          sx={{ bgcolor: "#fff", borderBottom: "1px solid #e8edf3", color: "text.primary" }}
        >
          <Toolbar
            className="flex w-full flex-row items-center justify-between"
            sx={{ minHeight: { xs: 64, sm: 76 }, gap: 2, px: { xs: 2, sm: 3 } }}
          >
            {!isDesktop && (
              <IconButton edge="start" onClick={() => setMobileOpen(true)} sx={{ color: "#334155" }}>
                <MenuRoundedIcon />
              </IconButton>
            )}

            <Box sx={{ mr: "auto", minWidth: 0 }}>
              <Typography variant="h6" sx={{ fontSize: { xs: 17, sm: 20 }, fontWeight: 800, lineHeight: 1.2 }} noWrap>
                {meta.title}
              </Typography>
              {meta.subtitle && (
                <Typography variant="caption" sx={{ color: "text.secondary", fontSize: 12.5 }} noWrap>
                  {meta.subtitle}
                </Typography>
              )}
            </Box>

            <Tooltip title="Manager menu">
              <IconButton onClick={(event) => setUserMenuAnchor(event.currentTarget)} sx={{ p: 0 }}>
                <Avatar sx={{ width: 36, height: 36, bgcolor: "#1e3a8a", fontSize: 13, fontWeight: 700 }}>YR</Avatar>
              </IconButton>
            </Tooltip>
            <Menu
              anchorEl={userMenuAnchor}
              open={Boolean(userMenuAnchor)}
              onClose={() => setUserMenuAnchor(null)}
              slotProps={{ paper: { sx: { minWidth: 160 } } }}
            >
              <MenuItem
                onClick={async () => {
                  setUserMenuAnchor(null);
                  await logout();
                  router.replace("/login");
                  router.refresh();
                }}
              >
                <ListItemIcon>
                  <LogoutRoundedIcon fontSize="small" />
                </ListItemIcon>
                Logout
              </MenuItem>
            </Menu>
          </Toolbar>
        </AppBar>

        <Box component="main" className="slim-scroll min-h-0 flex-1 overflow-y-auto">
          {children}
        </Box>
      </Box>

    </Box>
  );
}
