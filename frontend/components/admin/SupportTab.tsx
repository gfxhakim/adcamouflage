"use client";

import clsx from "clsx";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  Coins,
  ExternalLink,
  FileText,
  Headset,
  Image as ImageIcon,
  Loader2,
  Mail,
  MonitorPlay,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  StopCircle,
  User as UserIcon,
  Video,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import NeonCard from "@/components/NeonCard";
import { formatBytes, formatTokens } from "@/lib/format";
import {
  getAdminSupportThread,
  listAdminSupportThreads,
  resolveSupportMediaUrl,
  sendAdminSupportMessage,
  updateAdminSupportThreadStatus,
  uploadSupportAttachment,
  type AdminSupportThreadDetail,
  type AdminSupportThreadSummary,
  type SupportThreadStatus,
  type UploadedSupportMedia,
} from "@/lib/support";

interface SupportTabProps {
  refreshKey: number;
  initialThreadId?: number | null;
  onSelectUser: (userId: number) => void;
  onNotificationsChanged?: () => void;
}

const STATUS_FILTERS: { id: string; label: string }[] = [
  { id: "all", label: "All tickets" },
  { id: "escalated", label: "Waiting for Agent" },
  { id: "agent_active", label: "Active Chat" },
  { id: "bot", label: "Bot Mode" },
  { id: "resolved", label: "Resolved" },
];

function StatusBadge({ status }: { status: SupportThreadStatus }) {
  if (status === "escalated") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-amber-400/40 bg-amber-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-300">
        <Clock className="h-3 w-3" aria-hidden />
        Escalated · ≤30m
      </span>
    );
  }
  if (status === "agent_active") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-300">
        <Headset className="h-3 w-3" aria-hidden />
        Agent Active
      </span>
    );
  }
  if (status === "resolved") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-slate-500/40 bg-slate-500/15 px-2 py-0.5 font-mono text-[10px] text-slate-300">
        <CheckCircle2 className="h-3 w-3" aria-hidden />
        Resolved
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-meta-400/40 bg-meta-500/15 px-2 py-0.5 font-mono text-[10px] text-meta-300">
      <Bot className="h-3 w-3" aria-hidden />
      Bot ({status})
    </span>
  );
}

export default function SupportTab({
  refreshKey,
  initialThreadId,
  onSelectUser,
  onNotificationsChanged,
}: SupportTabProps) {
  const [threads, setThreads] = useState<AdminSupportThreadSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(initialThreadId ?? null);
  const [detail, setDetail] = useState<AdminSupportThreadDetail | null>(null);

  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<UploadedSupportMedia | null>(null);

  // Screen recording state for admin
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const loadThreads = useCallback(
    async (silent = false) => {
      if (!silent) setLoadingList(true);
      try {
        const list = await listAdminSupportThreads({
          status: statusFilter,
          q: search,
        });
        setThreads(list);
        if (!selectedId && list.length > 0) {
          setSelectedId(list[0].id);
        }
      } catch (err) {
        if (!silent) {
          setError(err instanceof Error ? err.message : "Could not load support tickets.");
        }
      } finally {
        if (!silent) setLoadingList(false);
      }
    },
    [statusFilter, search, selectedId],
  );

  const loadDetail = useCallback(
    async (threadId: number, silent = false) => {
      if (!silent) setLoadingDetail(true);
      try {
        const data = await getAdminSupportThread(threadId);
        setDetail(data);
        onNotificationsChanged?.();
      } catch (err) {
        if (!silent) {
          setError(err instanceof Error ? err.message : "Could not load ticket conversation.");
        }
      } finally {
        if (!silent) setLoadingDetail(false);
      }
    },
    [onNotificationsChanged],
  );

  useEffect(() => {
    if (initialThreadId) {
      setSelectedId(initialThreadId);
    }
  }, [initialThreadId]);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads, refreshKey]);

  useEffect(() => {
    if (selectedId !== null) {
      void loadDetail(selectedId);
    } else {
      setDetail(null);
    }
  }, [selectedId, loadDetail]);

  // Live 3-second polling for active chat
  useEffect(() => {
    const timer = setInterval(() => {
      void loadThreads(true);
      if (selectedId !== null) {
        void loadDetail(selectedId, true);
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [selectedId, loadThreads, loadDetail]);

  useEffect(() => {
    const id = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 60);
    return () => clearTimeout(id);
  }, [detail?.thread.messages.length]);

  const handleUploadFile = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const uploaded = await uploadSupportAttachment(file);
      setAttachment(uploaded);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Attachment upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const handleStartScreenRecord = async () => {
    if (recording) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      const chunks: BlobPart[] = [];
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (recordTimerRef.current) clearInterval(recordTimerRef.current);
        setRecording(false);
        setRecordSeconds(0);
        if (chunks.length > 0) {
          const blob = new Blob(chunks, { type: "video/webm" });
          const file = new File([blob], `agent-recording-${Date.now()}.webm`, {
            type: "video/webm",
          });
          void handleUploadFile(file);
        }
      };

      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (recorder.state !== "inactive") recorder.stop();
      });

      recorder.start(250);
      setRecording(true);
      setRecordSeconds(0);
      recordTimerRef.current = setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    } catch {
      setError("Screen recording was cancelled or unsupported.");
    }
  };

  const handleStopScreenRecord = () => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.stop();
    }
  };

  const handleSendReply = async () => {
    if (!selectedId || (!draft.trim() && !attachment) || sending || uploading) return;
    setSending(true);
    setError(null);
    const bodyText = draft.trim();
    const currentAttachment = attachment;
    setDraft("");
    setAttachment(null);

    try {
      const updated = await sendAdminSupportMessage(selectedId, {
        body: bodyText,
        attachment_url: currentAttachment?.url ?? null,
        attachment_name: currentAttachment?.name ?? null,
        attachment_type: currentAttachment?.type ?? null,
        attachment_size: currentAttachment?.size ?? null,
      });
      setDetail(updated);
      void loadThreads(true);
      onNotificationsChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send reply.");
      if (currentAttachment) setAttachment(currentAttachment);
    } finally {
      setSending(false);
    }
  };

  const handleStatusChange = async (newStatus: SupportThreadStatus) => {
    if (!selectedId) return;
    try {
      const updated = await updateAdminSupportThreadStatus(selectedId, newStatus);
      setDetail(updated);
      void loadThreads(true);
      onNotificationsChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update ticket status.");
    }
  };

  const customer = detail?.customer;
  const thread = detail?.thread;

  return (
    <div className="space-y-4">
      {error ? (
        <div className="flex items-center justify-between rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs text-red-300">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : null}

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,280px)_minmax(0,1fr)_minmax(0,300px)] 2xl:grid-cols-[320px_minmax(0,1fr)_340px]">
        {/* Left column: Threads list. The card has a fixed height and only the
            ticket list inside it scrolls, so tickets never spill out below. */}
        <NeonCard
          padding="md"
          radius="xl"
          className="flex h-[min(60vh,560px)] min-h-[360px] flex-col overflow-hidden lg:h-[74vh] lg:max-h-[860px]"
          innerClassName="flex min-h-0 flex-1 flex-col"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-display text-base font-medium text-slate-100">
              Support Queue ({threads.length})
            </h2>
            <button
              type="button"
              onClick={() => void loadThreads()}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
              title="Refresh tickets"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>

          <div className="relative mb-2.5">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search email, name, or issue…"
              className="w-full rounded-xl border border-white/10 bg-slate-900/70 py-1.5 pl-8 pr-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-meta-500 focus:outline-none"
            />
          </div>

          <div className="mb-3 flex flex-wrap gap-1">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatusFilter(f.id)}
                className={clsx(
                  "rounded-lg px-2 py-1 font-mono text-[10px] transition",
                  statusFilter === f.id
                    ? "bg-meta-600 text-white"
                    : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-1">
            {loadingList && threads.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-xs text-slate-400">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Loading tickets…
              </div>
            ) : threads.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center text-xs text-slate-400">
                No support conversations match this filter yet.
              </div>
            ) : (
              threads.map((item) => {
                const active = item.id === selectedId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className={clsx(
                      "w-full rounded-2xl border p-3 text-left transition",
                      active
                        ? "border-meta-500 bg-meta-500/15"
                        : item.overdue
                          ? "border-red-500/60 bg-red-500/10 hover:border-red-400"
                          : item.unread_admin > 0
                          ? "border-amber-400/50 bg-amber-500/10 hover:border-amber-400"
                          : "border-white/10 bg-slate-900/60 hover:border-white/25",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-slate-100">
                          {item.customer.display_name || item.customer.email}
                        </p>
                        <p className="truncate font-mono text-[10px] text-slate-400">
                          #{item.id} · {item.customer.email}
                        </p>
                      </div>
                      {item.unread_admin > 0 ? (
                        <span className="grid h-5 min-w-[20px] shrink-0 place-items-center rounded-full bg-amber-400 px-1.5 font-mono text-[10px] font-bold text-slate-950">
                          {item.unread_admin}
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <StatusBadge status={item.status} />
                        {item.overdue ? (
                          <span
                            className="rounded-md bg-red-500 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-white"
                            title="Waiting 30+ min with no agent reply"
                          >
                            Overdue
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-slate-400">
                        {item.bot_attempts} bot tries
                      </span>
                    </div>

                    {item.last_message_preview ? (
                      <p className="mt-2 line-clamp-2 break-words text-[11px] leading-relaxed text-slate-300 [overflow-wrap:anywhere]">
                        {item.last_message_preview}
                      </p>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </NeonCard>

        {/* Center column: Live Two-Way Multimedia Conversation. Only the
            message stream scrolls; header and reply box stay inside the card. */}
        <NeonCard
          padding="md"
          radius="xl"
          className="flex h-[78vh] min-h-[440px] flex-col overflow-hidden lg:h-[74vh] lg:max-h-[860px]"
          innerClassName="flex min-h-0 flex-1 flex-col"
        >
          {!detail || !thread || !customer ? (
            <div className="flex flex-1 flex-col items-center justify-center text-center text-xs text-slate-400">
              {loadingDetail ? (
                <>
                  <Loader2 className="mb-2 h-5 w-5 animate-spin text-meta-400" aria-hidden />
                  Loading conversation…
                </>
              ) : (
                <>
                  <Headset className="mb-2 h-8 w-8 text-slate-600" aria-hidden />
                  Select a support ticket on the left to view the bot transcript and chat live with the customer.
                </>
              )}
            </div>
          ) : (
            <>
              {/* Conversation Header */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
                <div className="min-w-0 flex-1 basis-64">
                  <div className="flex min-w-0 items-center gap-2">
                    <h2 className="min-w-0 truncate font-display text-lg font-medium text-white">
                      Ticket #{thread.id} · {customer.display_name || customer.email}
                    </h2>
                    <StatusBadge status={thread.status} />
                  </div>
                  <p className="mt-0.5 break-words text-xs text-slate-400">
                    {thread.escalated_at
                      ? `Escalated at ${new Date(thread.escalated_at).toLocaleString()} · Promised reply window: ≤30min Max`
                      : `Currently in Bot mode (${thread.bot_attempts}/${thread.max_attempts} attempts used)`}
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {thread.status !== "resolved" ? (
                    <button
                      type="button"
                      onClick={() => void handleStatusChange("resolved")}
                      className="rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/25"
                    >
                      Mark Resolved
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleStatusChange("agent_active")}
                      className="rounded-xl border border-meta-500/40 bg-meta-500/15 px-3 py-1.5 text-xs font-semibold text-meta-200 transition hover:bg-meta-500/25"
                    >
                      Re-open Chat
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleStatusChange("bot")}
                    className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 transition hover:bg-white/10"
                    title="Return conversation to Bot mode and reset attempt counter"
                  >
                    Return to Bot
                  </button>
                </div>
              </div>

              {/* Messages Stream */}
              <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto overscroll-contain py-4 pr-1">
                {thread.messages.map((msg) => {
                  const isAgent = msg.sender_role === "agent";
                  const isUser = msg.sender_role === "user";
                  const mediaUrl = resolveSupportMediaUrl(msg.attachment_url);

                  return (
                    <div
                      key={msg.id}
                      className={clsx(
                        "flex flex-col gap-1",
                        isAgent ? "items-end" : "items-start",
                      )}
                    >
                      <div className="flex max-w-full min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 px-1 font-mono text-[10px] text-slate-400">
                        {isAgent ? (
                          <>
                            <span className="font-semibold text-emerald-400">
                              {msg.sender_name || "You (Agent)"}
                            </span>
                            <Headset className="h-3 w-3 text-emerald-400" aria-hidden />
                          </>
                        ) : isUser ? (
                          <>
                            <UserIcon className="h-3 w-3 text-amber-400" aria-hidden />
                            <span className="min-w-0 break-all font-semibold text-amber-300">
                              Customer ({customer.email})
                            </span>
                          </>
                        ) : (
                          <>
                            <Bot className="h-3 w-3 text-meta-400" aria-hidden />
                            <span className="text-meta-300">BluCloaking AI Bot</span>
                          </>
                        )}
                        <span>· {new Date(msg.created_at).toLocaleTimeString()}</span>
                      </div>

                      <div
                        className={clsx(
                          "min-w-0 max-w-[92%] break-words rounded-2xl px-4 py-2.5 text-xs leading-relaxed [overflow-wrap:anywhere] sm:max-w-[85%]",
                          isAgent
                            ? "rounded-br-sm bg-emerald-600 text-white"
                            : isUser
                              ? "rounded-bl-sm border border-amber-400/40 bg-amber-500/15 text-slate-100"
                              : "rounded-bl-sm border border-white/10 bg-slate-900/80 text-slate-300",
                        )}
                      >
                        {msg.body ? (
                          <p className="whitespace-pre-wrap">{msg.body}</p>
                        ) : null}

                        {mediaUrl ? (
                          <div className="mt-2 overflow-hidden rounded-xl border border-white/15 bg-black/40">
                            {msg.attachment_type === "video" ||
                            /\.(mp4|webm|mov|mkv|m4v)$/i.test(mediaUrl) ? (
                              <video
                                src={mediaUrl}
                                controls
                                preload="metadata"
                                className="max-h-64 w-full bg-black object-contain"
                              />
                            ) : (
                              <a href={mediaUrl} target="_blank" rel="noreferrer" className="block">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={mediaUrl}
                                  alt={msg.attachment_name || "Attachment"}
                                  className="max-h-64 w-full object-contain"
                                />
                              </a>
                            )}
                            <div className="flex items-center justify-between gap-2 px-3 py-1.5 font-mono text-[10px] text-slate-300">
                              <span className="truncate">{msg.attachment_name || "Attachment"}</span>
                              <a
                                href={mediaUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="underline hover:text-white"
                              >
                                Open full file
                              </a>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Pending Attachment Bar */}
              {attachment ? (
                <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-white/15 bg-slate-900 px-3 py-2 text-xs text-slate-200">
                  <div className="flex min-w-0 items-center gap-2">
                    {attachment.type === "video" ? (
                      <Video className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
                    ) : (
                      <ImageIcon className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
                    )}
                    <span className="min-w-0 truncate font-mono text-[11px]">{attachment.name}</span>
                    <span className="shrink-0 font-mono text-[10px] text-slate-400">
                      ({formatBytes(attachment.size)})
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAttachment(null)}
                    className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              ) : null}

              {/* Admin Reply Composer (Text + Screenshot/Video Upload + Screen Recording) */}
              <div className="border-t border-white/10 pt-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime,video/x-matroska"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleUploadFile(f);
                    e.target.value = "";
                  }}
                />

                {/* Phones: the text box takes its own full-width row above the
                    buttons, so it never gets squeezed to a sliver. */}
                <div className="flex flex-wrap items-end gap-2 sm:flex-nowrap">
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      disabled={uploading || recording}
                      onClick={() => fileInputRef.current?.click()}
                      title="Upload screenshot or video recording to send to customer"
                      className="grid h-10 w-10 place-items-center rounded-xl border border-white/15 bg-slate-900/70 text-slate-300 transition hover:border-emerald-400 hover:text-emerald-300 disabled:opacity-50"
                    >
                      {uploading ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <Paperclip className="h-4 w-4" aria-hidden />
                      )}
                    </button>

                    {recording ? (
                      <button
                        type="button"
                        onClick={handleStopScreenRecord}
                        title="Stop screen recording"
                        className="flex h-10 items-center gap-1.5 rounded-xl border border-red-500/50 bg-red-500/20 px-3 font-mono text-xs font-semibold text-red-300"
                      >
                        <StopCircle className="h-4 w-4 animate-pulse" aria-hidden />
                        {recordSeconds}s
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={uploading}
                        onClick={() => void handleStartScreenRecord()}
                        title="Record your screen to show the customer how to solve their issue"
                        className="grid h-10 w-10 place-items-center rounded-xl border border-white/15 bg-slate-900/70 text-slate-300 transition hover:border-emerald-400 hover:text-emerald-300 disabled:opacity-50"
                      >
                        <MonitorPlay className="h-4 w-4" aria-hidden />
                      </button>
                    )}
                  </div>

                  <textarea
                    rows={2}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onPaste={(e) => {
                      const files = e.clipboardData?.files;
                      if (files && files.length > 0) {
                        const f = files[0];
                        if (f.type.startsWith("image/") || f.type.startsWith("video/")) {
                          e.preventDefault();
                          void handleUploadFile(f);
                        }
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void handleSendReply();
                      }
                    }}
                    placeholder="Reply as Live Agent (Enter to send, Shift+Enter for newline, or paste a screenshot with Ctrl+V)…"
                    className="order-first max-h-28 min-w-0 basis-full resize-none rounded-xl sm:order-none sm:flex-1 sm:basis-auto border border-white/15 bg-slate-900/80 px-3.5 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
                  />

                  <button
                    type="button"
                    disabled={sending || uploading || (!draft.trim() && !attachment)}
                    onClick={() => void handleSendReply()}
                    className="ml-auto inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 sm:ml-0 px-4 text-xs font-semibold text-white shadow transition hover:bg-emerald-500 disabled:opacity-40"
                  >
                    {sending ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Send className="h-4 w-4" aria-hidden />
                    )}
                    Send
                  </button>
                </div>
              </div>
            </>
          )}
        </NeonCard>

        {/* Right column: Customer Full Dossier & Issues Reported to Bot */}
        <NeonCard
          padding="md"
          radius="xl"
          className="flex min-w-0 flex-col lg:col-span-2 xl:col-span-1 xl:h-[74vh] xl:max-h-[860px] xl:overflow-y-auto"
          innerClassName="flex min-h-0 flex-1 flex-col"
        >
          {!customer || !thread ? (
            <div className="flex flex-1 items-center justify-center text-center text-xs text-slate-400">
              Customer details &amp; reported issues will appear here when a ticket is selected.
            </div>
          ) : (
            <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2 xl:grid-cols-1">
              {/* Highlighted Issues Reported to Bot */}
              <div className="rounded-2xl border border-amber-400/40 bg-amber-500/10 p-3.5">
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                  Issues Reported to Bot
                </div>
                <p className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-amber-100/90 [overflow-wrap:anywhere]">
                  {thread.issue_summary || "No summary recorded yet."}
                </p>
              </div>

              {/* Customer Account Dossier */}
              <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-3.5">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-white">
                      {customer.display_name || "No display name"}
                    </p>
                    <p className="truncate font-mono text-[11px] text-slate-400">
                      User #{customer.id} · {customer.email}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelectUser(customer.id)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-meta-500/40 bg-meta-500/15 px-2.5 py-1 text-[11px] font-semibold text-meta-200 hover:bg-meta-500/25"
                  >
                    Manage User
                    <ExternalLink className="h-3 w-3" aria-hidden />
                  </button>
                </div>

                <dl className="grid grid-cols-1 gap-2.5 min-[300px]:grid-cols-2 border-t border-white/10 pt-3 text-xs">
                  <div className="rounded-xl bg-white/[0.03] p-2.5">
                    <dt className="font-mono text-[10px] uppercase text-slate-400">Plan &amp; Mode</dt>
                    <dd className="mt-0.5 font-semibold text-slate-100">
                      {customer.plan_label}{" "}
                      <span className="font-mono text-[10px] text-slate-400">
                        ({customer.billing_mode})
                      </span>
                    </dd>
                  </div>

                  <div className="rounded-xl bg-white/[0.03] p-2.5">
                    <dt className="font-mono text-[10px] uppercase text-slate-400">Status</dt>
                    <dd
                      className={clsx(
                        "mt-0.5 font-semibold",
                        customer.subscription_active ? "text-emerald-400" : "text-red-400",
                      )}
                    >
                      {customer.subscription_active ? "Active" : "Inactive / Expired"}
                    </dd>
                  </div>

                  <div className="rounded-xl bg-white/[0.03] p-2.5">
                    <dt className="flex items-center gap-1 font-mono text-[10px] uppercase text-slate-400">
                      <Coins className="h-3 w-3 text-meta-400" aria-hidden />
                      Usable Tokens
                    </dt>
                    <dd className="mt-0.5 font-mono font-semibold text-meta-300">
                      {formatTokens(customer.usable_tokens)}
                    </dd>
                  </div>

                  <div className="rounded-xl bg-white/[0.03] p-2.5">
                    <dt className="font-mono text-[10px] uppercase text-slate-400">
                      Batches / Files
                    </dt>
                    <dd className="mt-0.5 font-mono font-semibold text-slate-100">
                      {customer.batch_count} / {customer.files_total}
                    </dd>
                  </div>
                </dl>

                <div className="mt-3 space-y-1.5 border-t border-white/10 pt-3 font-mono text-[11px] text-slate-400">
                  <div className="flex min-w-0 justify-between gap-3">
                    <span className="shrink-0">Email:</span>
                    <a
                      href={`mailto:${customer.email}`}
                      title={customer.email}
                      className="inline-flex min-w-0 items-center gap-1 text-meta-300 hover:underline"
                    >
                      <Mail className="h-3 w-3 shrink-0" aria-hidden />
                      <span className="truncate">{customer.email}</span>
                    </a>
                  </div>
                  {customer.sub_period_end ? (
                    <div className="flex flex-wrap justify-between gap-x-3">
                      <span>Period Ends:</span>
                      <span className="text-slate-200">
                        {new Date(customer.sub_period_end).toLocaleDateString()}
                      </span>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap justify-between gap-x-3">
                    <span>Joined:</span>
                    <span className="text-slate-200">
                      {new Date(customer.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  {customer.last_seen_at ? (
                    <div className="flex flex-wrap justify-between gap-x-3">
                      <span>Last Seen:</span>
                      <span className="text-slate-200">
                        {new Date(customer.last_seen_at).toLocaleString()}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Admin Notes */}
              {customer.admin_notes ? (
                <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-3.5">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                    <FileText className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                    Admin Notes on Customer
                  </div>
                  <p className="whitespace-pre-wrap break-words text-xs text-slate-300 [overflow-wrap:anywhere]">
                    {customer.admin_notes}
                  </p>
                </div>
              ) : null}
            </div>
          )}
        </NeonCard>
      </div>
    </div>
  );
}
