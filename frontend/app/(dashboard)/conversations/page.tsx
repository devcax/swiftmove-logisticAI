"use client";

import * as React from "react";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import AttachFileRoundedIcon from "@mui/icons-material/AttachFileRounded";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import DeleteSweepRoundedIcon from "@mui/icons-material/DeleteSweepRounded";
import DoneAllRoundedIcon from "@mui/icons-material/DoneAllRounded";
import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";
import EmojiEmotionsOutlinedIcon from "@mui/icons-material/EmojiEmotionsOutlined";
import MoreVertRoundedIcon from "@mui/icons-material/MoreVertRounded";
import LocationOnRoundedIcon from "@mui/icons-material/LocationOnRounded";
import VideocamRoundedIcon from "@mui/icons-material/VideocamRounded";
import ScheduleRoundedIcon from "@mui/icons-material/ScheduleRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import SmartToyRoundedIcon from "@mui/icons-material/SmartToyRounded";
import SupportAgentRoundedIcon from "@mui/icons-material/SupportAgentRounded";
import { type ChatMessage, type Conversation } from "@/lib/data";
import {
  fetchConversations,
  fetchConversationMessages,
  markConversationRead,
  sendManagerMessage,
  setConversationTakeover,
  clearConversation,
  deleteConversation,
} from "@/lib/api";

const POLL_INTERVAL_MS = 2000;

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function timeLabel(iso: string | null | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}


function renderWhatsAppText(text: string) {
  return text.split(/(\*[^*]+\*)/g).map((part, index) =>
    part.length > 2 && part.startsWith("*") && part.endsWith("*") ? (
      <strong key={index}>{part.slice(1, -1)}</strong>
    ) : (
      <React.Fragment key={index}>{part}</React.Fragment>
    ),
  );
}

function StatusTick({ status }: { status?: ChatMessage["deliveryStatus"] }) {
  if (status === "FAILED") return <ErrorOutlineRoundedIcon sx={{ fontSize: 13, color: "#dc2626" }} />;
  if (status === "QUEUED") return <ScheduleRoundedIcon sx={{ fontSize: 13, color: "#94a3b8" }} />;
  if (status === "SENT") return <CheckRoundedIcon sx={{ fontSize: 14, color: "#94a3b8" }} />;
  if (status === "READ") return <DoneAllRoundedIcon sx={{ fontSize: 13, color: "#53bdeb" }} />;
  return <DoneAllRoundedIcon sx={{ fontSize: 13, color: "#94a3b8" }} />;
}


function DriverBubble({ message }: { message: ChatMessage }) {
  const isLocation = message.type === "LOCATION";
  const isVideo = message.type === "VIDEO";
  const image = message.attachments?.find(
    (attachment) => attachment.type === "IMAGE" && attachment.publicUrl,
  );
  const caption = message.text !== "[Image]" ? message.text : "";
  return (
    <div className="flex flex-col items-start">
      <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-white px-4 py-2.5 shadow-sm sm:max-w-[62%]">
        {image?.publicUrl ? (
          <>
            <a href={image.publicUrl} target="_blank" rel="noreferrer" className="block">
              <Box
                component="img"
                src={image.publicUrl}
                alt={image.filename ?? "Image sent by driver"}
                loading="lazy"
                sx={{
                  display: "block",
                  maxWidth: "100%",
                  maxHeight: 320,
                  borderRadius: 1.5,
                  objectFit: "contain",
                  bgcolor: "#f1f5f9",
                }}
              />
            </a>
            {caption && (
              <Typography variant="body2" sx={{ mt: 1, whiteSpace: "pre-wrap" }}>
                {caption}
              </Typography>
            )}
          </>
        ) : isLocation ? (
          <a
            href={`https://www.google.com/maps?q=${encodeURIComponent(message.text)}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 no-underline"
          >
            <LocationOnRoundedIcon sx={{ fontSize: 16, color: "#16a34a" }} />
            <Typography variant="body2" sx={{ fontWeight: 700, color: "#15803d" }}>
              {message.text}
            </Typography>
            <Typography variant="caption" sx={{ color: "#94a3b8" }}>
              open in maps
            </Typography>
          </a>
        ) : isVideo ? (
          <Chip
            size="small"
            icon={<VideocamRoundedIcon />}
            label="Video (unsupported)"
            sx={{ bgcolor: "#fee2e2", color: "#b91c1c", fontWeight: 700 }}
          />
        ) : (
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
            {message.text}
          </Typography>
        )}
        <Typography variant="caption" sx={{ display: "block", textAlign: "right", color: "#94a3b8", fontSize: 10.5 }}>
          {message.time}
        </Typography>
      </div>
      {message.interpretation && <AiCard message={message} />}
    </div>
  );
}

function AiCard({ message }: { message: ChatMessage }) {
  const ai = message.interpretation;
  if (!ai) return null;
  return (
    <div className="mt-1.5 w-full max-w-[86%] rounded-2xl border border-blue-100 bg-[#eaf1fe] p-3.5 sm:max-w-[68%]">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <AutoAwesomeRoundedIcon sx={{ fontSize: 15, color: "#2563eb" }} />
          <Typography variant="caption" sx={{ fontWeight: 800, color: "#1d4ed8", letterSpacing: "0.1em", fontSize: 11 }}>
            AI INTERPRETATION
          </Typography>
        </div>
        <Typography variant="caption" sx={{ color: "#64748b", fontSize: 11 }}>
          {Math.round(ai.confidence * 100)}% · {message.time}
        </Typography>
      </div>
      <div className="flex items-center justify-between border-b border-blue-100/70 py-1.5">
        <Typography variant="caption" sx={{ color: "#64748b" }}>
          Intent
        </Typography>
        <Typography variant="caption" sx={{ fontWeight: 800, fontFamily: "var(--font-geist-mono)", letterSpacing: "0.04em" }}>
          {ai.intent}
        </Typography>
      </div>
      {ai.fields.map((field) => (
        <div key={field.label} className="flex items-center justify-between border-b border-blue-100/70 py-1.5 last:border-b-0">
          <Typography variant="caption" sx={{ color: "#64748b" }}>
            {field.label}
          </Typography>
          <Typography variant="caption" sx={{ fontWeight: 700 }}>
            {field.value}
          </Typography>
        </div>
      ))}
    </div>
  );
}

function ManagerBubble({ message }: { message: ChatMessage }) {
  const failed = message.deliveryStatus === "FAILED";
  return (
    <div className="flex flex-col items-end">
      <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-[#d9fdd3] px-4 py-2.5">
        <Typography variant="caption" sx={{ color: "#15803d", fontWeight: 700, fontSize: 11, }}>
          Manager
        </Typography>
        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "break-word" }}>
          {renderWhatsAppText(message.text)}
        </Typography>
        <div className="flex items-center justify-end gap-1">
          {failed && (
            <Typography variant="caption" sx={{ color: "#dc2626", fontSize: 10.5, fontWeight: 700 }}>
              Failed to send
            </Typography>
          )}
          <Typography variant="caption" sx={{ color: "#64748b", fontSize: 10.5 }}>
            {message.time}
          </Typography>
          <StatusTick status={message.deliveryStatus} />
        </div>
      </div>
    </div>
  );
}

function BotBubble({ message }: { message: ChatMessage }) {
  return (
    <div className="flex flex-col items-end">
      <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-blue-50 px-4 py-2.5">
        <div className="flex items-start gap-2">
          <Typography variant="body2" sx={{ color: "#334155", whiteSpace: "pre-wrap", overflowWrap: "break-word", lineHeight: 1.55 }}>
            {renderWhatsAppText(message.text)}
          </Typography>
        </div>
        <Typography
          variant="caption"
          sx={{ display: "block", mt: 0.5, textAlign: "right", color: "#64748b", fontSize: 10, letterSpacing: "0.08em", fontWeight: 600 }}
        >
          <span className="inline-flex items-center gap-1">
            <SmartToyRoundedIcon sx={{ fontSize: 13 }} />
            BOT CONFIRMATION · {message.time}
          </span>
        </Typography>
      </div>
    </div>
  );
}


export default function ConversationsPage() {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up("md"));

  const [threads, setThreads] = React.useState<Conversation[]>([]);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [draft, setDraft] = React.useState("");
  const [backendError, setBackendError] = React.useState<string | null>(null);
  const [sending, setSending] = React.useState(false);
  const [menuAnchor, setMenuAnchor] = React.useState<HTMLElement | null>(null);
  const [confirmAction, setConfirmAction] = React.useState<"clear" | "delete" | null>(null);
  const [actionPending, setActionPending] = React.useState(false);
  const [takeoverPending, setTakeoverPending] = React.useState(false);
  const feedRef = React.useRef<HTMLDivElement>(null);

  const active = threads.find((thread) => thread.id === activeId) ?? null;

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visibleThreads = normalizedQuery
    ? threads.filter(
        (thread) =>
          thread.driver.toLowerCase().includes(normalizedQuery) ||
          thread.phone.toLowerCase().includes(normalizedQuery),
      )
    : threads;

  const refreshConversations = React.useCallback(async () => {
    const data = await fetchConversations();
    setThreads((prev) =>
      data.map((summary) => {
        const existing = prev.find((thread) => thread.id === summary.id);
        return {
          id: summary.id,
          driver: summary.driver,
          phone: summary.phone,
          jobNumber: summary.jobNumber,
          route: "",
          lastMessage: summary.lastMessage,
          lastActivity: timeLabel(summary.lastActivity),
          unread: summary.unread,
          online: false,
          verified: summary.verified,
          aiPaused: summary.aiPaused,
          messages: existing?.messages ?? [],
        };
      }),
    );
  }, []);

  const refreshMessages = React.useCallback(async (conversationId: string) => {
    const data = await fetchConversationMessages(conversationId);
    setThreads((prev) =>
      prev.map((thread) =>
        thread.id === conversationId
          ? {
              ...thread,
              messages: data.map((message) => ({
                id: message.id,
                kind: message.kind,
                type: message.type,
                text: message.text,
                time: timeLabel(message.time),
                deliveryStatus: message.deliveryStatus,
                interpretation: message.interpretation,
                attachments: message.attachments,
              })),
            }
          : thread,
      ),
    );
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        await refreshConversations();
        if (activeId) await refreshMessages(activeId);
        if (!cancelled) setBackendError(null);
      } catch {
        if (!cancelled) setBackendError("Cannot reach the backend - is it running on port 4000?");
      }
    }

    tick();
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeId, refreshConversations, refreshMessages]);

  React.useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [activeId, active?.messages.length]);

  const openThread = (id: string) => {
    setActiveId(id);
    setThreads((prev) => prev.map((thread) => (thread.id === id ? { ...thread, unread: 0 } : thread)));
    void markConversationRead(id)
      .then(refreshConversations)
      .catch(() => {
        // The next poll will synchronize the server state; keep the thread usable meanwhile.
      });
  };

  const sendMessage = async () => {
    const text = draft.trim();
    if (!text || !activeId || sending) return;
    setDraft("");

    const tempId = `local-${Date.now()}`;
    const optimistic: ChatMessage = {
      id: tempId,
      kind: "MANAGER",
      text,
      time: nowTime(),
      deliveryStatus: "QUEUED",
    };
    setThreads((prev) =>
      prev.map((thread) =>
        thread.id === activeId
          ? { ...thread, messages: [...thread.messages, optimistic], lastMessage: text, lastActivity: optimistic.time }
          : thread,
      ),
    );

    setSending(true);
    try {
      await sendManagerMessage(activeId, text);
      await Promise.all([refreshMessages(activeId), refreshConversations()]);
    } catch (err) {
      setBackendError(err instanceof Error ? err.message : "Failed to send message");
      setThreads((prev) =>
        prev.map((thread) =>
          thread.id === activeId
            ? {
                ...thread,
                messages: thread.messages.map((m) =>
                  m.id === tempId ? { ...m, deliveryStatus: "FAILED" as const } : m,
                ),
              }
            : thread,
        ),
      );
    } finally {
      setSending(false);
    }
  };

  const handleConfirmAction = async () => {
    if (!activeId || !confirmAction || actionPending) return;
    setActionPending(true);
    try {
      if (confirmAction === "clear") {
        await clearConversation(activeId);
        setThreads((prev) =>
          prev.map((thread) =>
            thread.id === activeId ? { ...thread, messages: [], lastMessage: "", lastActivity: "" } : thread,
          ),
        );
      } else {
        await deleteConversation(activeId);
        setThreads((prev) => prev.filter((thread) => thread.id !== activeId));
        setActiveId(null);
      }
      setConfirmAction(null);
      await refreshConversations();
    } catch (err) {
      setBackendError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionPending(false);
    }
  };

  const toggleTakeover = async () => {
    if (!active || takeoverPending) return;
    setTakeoverPending(true);
    try {
      const result = await setConversationTakeover(active.id, !active.aiPaused);
      setThreads((prev) =>
        prev.map((thread) =>
          thread.id === active.id
            ? { ...thread, aiPaused: result.aiPaused }
            : thread,
        ),
      );
    } catch (err) {
      setBackendError(
        err instanceof Error ? err.message : "Could not update AI takeover",
      );
    } finally {
      setTakeoverPending(false);
    }
  };

  const showList = isDesktop || activeId === null;
  const showChat = isDesktop || activeId !== null;

  return (
    <div className="flex h-full min-h-0 bg-white">
      {/* Left pane — conversation list */}
      <Box
        sx={{ display: showList ? "flex" : "none", flexDirection: "column" }}
        className="w-full shrink-0 border-r border-slate-200 md:w-[340px]"
      >
        <div className="border-b border-slate-200 px-4 py-3.5">
          <TextField
            size="small"
            fullWidth
            placeholder="Search or start new chat"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            sx={{ "& .MuiOutlinedInput-root": { bgcolor: "#f6f8fb", borderRadius: 1, fontSize: 13.5 } }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRoundedIcon fontSize="small" sx={{ color: "#94a3b8" }} />
                  </InputAdornment>
                ),
              },
            }}
          />
        </div>

        {backendError && (
          <Typography variant="caption" sx={{ px: 2.5, py: 1.5, color: "#b45309", bgcolor: "#fef3c7", fontWeight: 600 }}>
            {backendError}
          </Typography>
        )}

        <List className="slim-scroll flex-1 overflow-y-auto" disablePadding>
          {threads.length === 0 && !backendError && (
            <Typography variant="body2" sx={{ px: 3, py: 6, color: "#94a3b8", textAlign: "center" }}>
              No conversations yet. They appear here when a registered driver messages the official WhatsApp number.
            </Typography>
          )}
          {threads.length > 0 && visibleThreads.length === 0 && (
            <Typography variant="body2" sx={{ px: 3, py: 6, color: "#94a3b8", textAlign: "center" }}>
              No chats match “{searchQuery}”.
            </Typography>
          )}
          {visibleThreads.map((thread) => {
            const selected = thread.id === activeId;
            return (
              <ListItemButton
                key={thread.id}
                selected={selected}
                onClick={() => openThread(thread.id)}
                sx={{
                  px: 2.5,
                  py: 1.75,
                  gap: 1.75,
                  borderBottom: "1px solid #f1f5f9",
                  alignItems: "flex-start",
                  "&.Mui-selected": { bgcolor: "#f8fafc", "&:hover": { bgcolor: "#f1f5f9" } },
                }}
              >
                <Avatar sx={{ width: 44, height: 44, bgcolor: "#0c1526", fontSize: 14, fontWeight: 700 }}>
                  {initials(thread.driver)}
                </Avatar>
                <Box className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <Typography variant="subtitle2" sx={{ fontSize: 14.5 }} noWrap>
                      {thread.driver}
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{ color: thread.unread > 0 ? "#16a34a" : "#94a3b8", fontWeight: 700, fontSize: 11 }}
                    >
                      {thread.lastActivity}
                    </Typography>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <Typography variant="caption" sx={{ color: "text.secondary", fontSize: 12.5 }} noWrap>
                      {thread.lastMessage}
                    </Typography>
                    {thread.unread > 0 && (
                      <span className="flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-green-500 px-1 text-[10.5px] font-bold text-white">
                        {thread.unread}
                      </span>
                    )}
                  </div>
                  <Typography variant="caption" sx={{ color: "#2563eb", fontWeight: 600, fontSize: 11 }}>
                    {thread.jobNumber}
                  </Typography>
                </Box>
              </ListItemButton>
            );
          })}
        </List>
      </Box>

      {/* Right pane — chat window */}
      {showChat && (
        <Box sx={{ display: "flex", flexDirection: "column" }} className="min-w-0 flex-1">
          {active ? (
            <>
              {/* Chat header */}
              <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
                {!isDesktop && (
                  <IconButton size="small" onClick={() => setActiveId(null)}>
                    <ArrowBackRoundedIcon fontSize="small" />
                  </IconButton>
                )}
                <Avatar sx={{ width: 40, height: 40, bgcolor: "#0c1526", fontSize: 13, fontWeight: 700 }}>
                  {initials(active.driver)}
                </Avatar>
                <div className="min-w-0 flex-1">
                  <Typography variant="subtitle2" sx={{ fontSize: 15 }}>
                    {active.driver}
                  </Typography>
                  <Typography variant="caption" sx={{ color: "text.secondary", fontSize: 12 }}>
                    {active.phone} · {active.jobNumber}
                  </Typography>
                </div>
                {active.verified && (
                  <Chip
                    label="VERIFIED"
                    size="small"
                    sx={{ bgcolor: "#e8f7ee", color: "#15803d", fontWeight: 800, fontSize: 10, letterSpacing: "0.08em" }}
                  />
                )}
                <Button
                  size="small"
                  variant={active.aiPaused ? "contained" : "outlined"}
                  color={active.aiPaused ? "warning" : "primary"}
                  startIcon={
                    active.aiPaused ? (
                      <SmartToyRoundedIcon />
                    ) : (
                      <SupportAgentRoundedIcon />
                    )
                  }
                  disabled={takeoverPending}
                  onClick={() => void toggleTakeover()}
                  sx={{ flexShrink: 0, textTransform: "none" }}
                >
                  {active.aiPaused ? "Resume AI" : "Take over"}
                </Button>
                <Tooltip title="Conversation actions">
                  <IconButton
                    size="small"
                    onClick={(event) => setMenuAnchor(event.currentTarget)}
                    sx={{ border: "1px solid #e8edf3" }}
                  >
                    <MoreVertRoundedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
                  <MenuItem
                    onClick={() => {
                      setMenuAnchor(null);
                      setConfirmAction("clear");
                    }}
                  >
                    <ListItemIcon>
                      <DeleteSweepRoundedIcon fontSize="small" />
                    </ListItemIcon>
                    Clear messages
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      setMenuAnchor(null);
                      setConfirmAction("delete");
                    }}
                    sx={{ color: "#dc2626" }}
                  >
                    <ListItemIcon>
                      <DeleteOutlineRoundedIcon fontSize="small" sx={{ color: "#dc2626" }} />
                    </ListItemIcon>
                    Delete conversation
                  </MenuItem>
                </Menu>
              </div>

              <Dialog open={confirmAction !== null} onClose={() => !actionPending && setConfirmAction(null)}>
                <DialogTitle>
                  {confirmAction === "delete" ? "Delete this conversation?" : "Clear this conversation?"}
                </DialogTitle>
                <DialogContent>
                  <DialogContentText>
                    {confirmAction === "delete"
                      ? `The conversation with ${active.driver} and all its messages will be permanently deleted from the dashboard and the database. This cannot be undone.`
                      : `All messages with ${active.driver} will be permanently deleted from the dashboard and the database. The conversation itself stays. This cannot be undone.`}
                  </DialogContentText>
                </DialogContent>
                <DialogActions>
                  <Button onClick={() => setConfirmAction(null)} disabled={actionPending}>
                    Cancel
                  </Button>
                  <Button onClick={handleConfirmAction} disabled={actionPending} color="error" variant="contained">
                    {actionPending ? "Working…" : confirmAction === "delete" ? "Delete conversation" : "Clear messages"}
                  </Button>
                </DialogActions>
              </Dialog>

              {/* Message feed */}
              <div ref={feedRef} className="slim-scroll flex-1 space-y-3.5 overflow-y-auto bg-slate-50 px-4 py-5 sm:px-10">
                {active.messages.length === 0 && (
                  <Typography variant="body2" sx={{ color: "#94a3b8", textAlign: "center", py: 6 }}>
                    No messages in this conversation yet.
                  </Typography>
                )}
                {active.messages.map((message) => {
                  if (message.kind === "DRIVER") return <DriverBubble key={message.id} message={message} />;
                  if (message.kind === "MANAGER") return <ManagerBubble key={message.id} message={message} />;
                  return <BotBubble key={message.id} message={message} />;
                })}
              </div>

              {/* Composer */}
              <div className="border-t border-slate-200 bg-white px-3 pb-2 pt-2.5">
                <div className="flex items-center gap-1">
                  <Tooltip title="Emoji">
                    <IconButton size="small" sx={{ color: "#64748b" }}>
                      <EmojiEmotionsOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Attach">
                    <IconButton size="small" sx={{ color: "#64748b" }}>
                      <AttachFileRoundedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <TextField
                    fullWidth
                    size="small"
                    placeholder="Type a manual reply to the driver…"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        sendMessage();
                      }
                    }}
                    sx={{
                      "& .MuiOutlinedInput-root": { bgcolor: "#f6f8fb", borderRadius: 1, fontSize: 14 },
                      "& .MuiOutlinedInput-notchedOutline": { border: "none" },
                    }}
                  />
                  <Tooltip title="Send">
                    <span>
                      <IconButton
                        onClick={sendMessage}
                        disabled={draft.trim() === "" || sending}
                        sx={{
                          bgcolor: "#1e3a8a",
                          color: "#fff",
                          width: 42,
                          height: 42,
                          "&:hover": { bgcolor: "#172554" },
                          "&.Mui-disabled": { bgcolor: "#e2e8f0" },
                        }}
                      >
                        <SendRoundedIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </div>
                <Typography
                  variant="caption"
                  sx={{ display: "block", px: 1, pt: 1, color: "#94a3b8", fontSize: 10, letterSpacing: "0.08em", fontWeight: 600 }}
                >
                  SENDS AS MANAGER VIA WHATSAPP
                </Typography>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-[#f8fafc] text-center">
              <AutoAwesomeRoundedIcon sx={{ fontSize: 44, color: "#cbd5e1" }} />
              <Typography variant="h6" sx={{ color: "#64748b" }}>
                Select a conversation
              </Typography>
              <Typography variant="body2" sx={{ color: "#94a3b8", maxWidth: 320 }}>
                Pick a driver thread to see their WhatsApp messages, AI interpretations and send manual replies.
              </Typography>
            </div>
          )}
        </Box>
      )}
    </div>
  );
}
