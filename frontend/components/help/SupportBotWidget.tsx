"use client";

import clsx from "clsx";
import {
  AlertCircle,
  BookOpen,
  Bot,
  CheckCircle2,
  Clock,
  Headset,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  MonitorPlay,
  Paperclip,
  RotateCcw,
  Send,
  Sparkles,
  StopCircle,
  ThumbsDown,
  User as UserIcon,
  Video,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { formatBytes } from "@/lib/format";
import {
  escalateToLiveAgent,
  fetchMySupportThread,
  markBotAttemptUnsolved,
  resolveSupportMediaUrl,
  sendUserSupportMessage,
  startNewSupportThread,
  uploadSupportAttachment,
  type SupportMessage,
  type SupportThread,
  type UploadedSupportMedia,
} from "@/lib/support";

interface SupportBotWidgetProps {
  onOpenGuide?: () => void;
}

/** Lightweight markdown renderer for bot and agent messages. */
function FormattedMessageBody({ text, onLight }: { text: string; onLight?: boolean }) {
  if (!text) return null;
  const lines = text.split("\n");

  const formatInline = (line: string) => {
    const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return parts.map((part, idx) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={idx} className="font-semibold">
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith("`") && part.endsWith("`")) {
        return (
          <code
            key={idx}
            className={clsx(
              "rounded px-1 py-0.5 font-mono text-[11px]",
              onLight ? "bg-white/20 text-white" : "bg-black/10 text-meta-600 dark:bg-white/10 dark:text-meta-300",
            )}
          >
            {part.slice(1, -1)}
          </code>
        );
      }
      return <span key={idx}>{part}</span>;
    });
  };

  return (
    <div className="space-y-1.5 text-xs leading-relaxed">
      {lines.map((raw, i) => {
        const line = raw.trimEnd();
        if (!line.trim()) {
          return <div key={i} className="h-1" />;
        }
        if (line.trim() === "---") {
          return <hr key={i} className="my-2 border-current/15" />;
        }
        if (line.startsWith("### ")) {
          return (
            <p key={i} className="pt-1 font-display text-sm font-semibold tracking-tight">
              {formatInline(line.slice(4))}
            </p>
          );
        }
        if (line.startsWith("- ") || line.startsWith("• ")) {
          return (
            <div key={i} className="flex items-start gap-1.5 pl-1">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-60" />
              <span className="flex-1">{formatInline(line.slice(2))}</span>
            </div>
          );
        }
        return <p key={i}>{formatInline(line)}</p>;
      })}
    </div>
  );
}

export default function SupportBotWidget({ onOpenGuide }: SupportBotWidgetProps) {
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState<SupportThread | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<UploadedSupportMedia | null>(null);

  // Browser screen recording state
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const loadThread = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await fetchMySupportThread();
      setThread(data);
      setError(null);
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : "Could not load assistant.");
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Initial load + background polling when open or when waiting for an agent
  useEffect(() => {
    void loadThread(true);
  }, [loadThread]);

  useEffect(() => {
    const shouldPoll = open || thread?.status === "escalated" || thread?.status === "agent_active";
    if (!shouldPoll) return;
    const timer = setInterval(() => {
      void loadThread(true);
    }, 3000);
    return () => clearInterval(timer);
  }, [open, thread?.status, loadThread]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 60);
    return () => clearTimeout(id);
  }, [open, thread?.messages.length]);

  const handleUploadFile = useCallback(async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const uploaded = await uploadSupportAttachment(file);
      setAttachment(uploaded);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }, []);

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
          const file = new File([blob], `screen-recording-${Date.now()}.webm`, {
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
      setError("Screen recording was cancelled or is not supported in this browser.");
    }
  };

  const handleStopScreenRecord = () => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.stop();
    }
  };

  const handleSend = async (overrideText?: string) => {
    const bodyText = (overrideText !== undefined ? overrideText : draft).trim();
    if ((!bodyText && !attachment) || sending || uploading) return;

    setSending(true);
    setError(null);
    const currentAttachment = attachment;
    if (overrideText === undefined) setDraft("");
    setAttachment(null);

    try {
      const updated = await sendUserSupportMessage({
        body: bodyText,
        attachment_url: currentAttachment?.url ?? null,
        attachment_name: currentAttachment?.name ?? null,
        attachment_type: currentAttachment?.type ?? null,
        attachment_size: currentAttachment?.size ?? null,
      });
      setThread(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send message.");
      if (currentAttachment) setAttachment(currentAttachment);
    } finally {
      setSending(false);
    }
  };

  const handleUnsolved = async () => {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      const updated = await markBotAttemptUnsolved();
      setThread(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update attempt.");
    } finally {
      setSending(false);
    }
  };

  const handleEscalate = async () => {
    if (escalating) return;
    setEscalating(true);
    setError(null);
    try {
      const updated = await escalateToLiveAgent(draft.trim());
      setDraft("");
      setThread(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not contact agent.");
    } finally {
      setEscalating(false);
    }
  };

  const handleResetThread = async () => {
    setLoading(true);
    setError(null);
    try {
      const fresh = await startNewSupportThread();
      setThread(fresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start new chat.");
    } finally {
      setLoading(false);
    }
  };

  const messages: SupportMessage[] = thread?.messages ?? [];
  const lastBotMsg = [...messages].reverse().find((m) => m.sender_role === "bot");
  const isAgentMode = thread?.status === "escalated" || thread?.status === "agent_active";
  const canEscalateNow = Boolean(
    thread && thread.status === "bot" && thread.bot_attempts >= thread.max_attempts,
  );
  const unreadCount = thread?.unread_user ?? 0;

  return (
    <>
      {/* Floating Launcher Button */}
      <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-2">
        {!open && canEscalateNow ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex items-center gap-2 rounded-full border border-amber-400/50 bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 shadow-lg transition hover:bg-amber-400"
          >
            <Headset className="h-3.5 w-3.5" aria-hidden />
            Live Agent unlocked · Click to connect
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Open BluCloaking Assistant & Live Support"
          className={clsx(
            "group relative flex items-center gap-2.5 rounded-full border px-4 py-3 text-xs font-semibold shadow-[0_14px_38px_-10px_rgb(8_102_255/0.65)] transition-all",
            isAgentMode
              ? "border-emerald-400/50 bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:brightness-110"
              : "border-meta-400/50 bg-gradient-to-r from-meta-600 to-indigo-600 text-white hover:brightness-110",
          )}
        >
          {isAgentMode ? (
            <Headset className="h-4 w-4" aria-hidden />
          ) : (
            <Bot className="h-4 w-4" aria-hidden />
          )}
          <span>{isAgentMode ? "Live Support Chat" : "BluCloaking AI Bot"}</span>
          {unreadCount > 0 ? (
            <span className="grid h-5 min-w-[20px] place-items-center rounded-full bg-red-500 px-1.5 font-mono text-[10px] font-bold text-white">
              {unreadCount}
            </span>
          ) : (
            <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_8px_#6ee7b7]" />
          )}
        </button>
      </div>

      {/* Chat Window */}
      {open ? (
        <div
          role="dialog"
          aria-label="BluCloaking AI Bot and Live Agent Support"
          className="fixed bottom-20 right-4 z-50 flex h-[min(660px,calc(100vh-6.5rem))] w-[min(430px,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-black/10 bg-white shadow-[0_25px_70px_-15px_rgb(0_0_0/0.45)] dark:border-white/15 dark:bg-[#0b1220]"
        >
          {/* Header */}
          <div
            className={clsx(
              "flex items-center justify-between gap-3 border-b px-4 py-3.5 text-white",
              isAgentMode
                ? "border-emerald-500/30 bg-gradient-to-r from-emerald-700 via-teal-700 to-slate-900"
                : "border-white/10 bg-gradient-to-r from-meta-600 via-indigo-600 to-slate-900",
            )}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-white/15 backdrop-blur-md">
                {isAgentMode ? (
                  <Headset className="h-5 w-5 text-emerald-200" aria-hidden />
                ) : (
                  <Bot className="h-5 w-5 text-white" aria-hidden />
                )}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate font-display text-sm font-semibold">
                    {isAgentMode ? "BluCloaking Live Support" : "BluCloaking AI Assistant"}
                  </p>
                  <span className="rounded-full bg-white/15 px-2 py-0.5 font-mono text-[10px]">
                    {thread?.status === "agent_active"
                      ? "Agent Active"
                      : thread?.status === "escalated"
                        ? "Waiting · ≤30m"
                        : `${ Math.min(thread?.bot_attempts ?? 0, thread?.max_attempts ?? 5)}/${thread?.max_attempts ?? 5} tries`}
                  </span>
                </div>
                <p className="truncate text-[11px] text-white/80">
                  {isAgentMode
                    ? "Send messages, screenshots, or screen recordings below"
                    : "Knows all 23 layers, options & How to Use guide"}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {onOpenGuide ? (
                <button
                  type="button"
                  onClick={onOpenGuide}
                  title="Open How to Use Guide"
                  className="rounded-xl p-1.5 text-white/80 transition hover:bg-white/15 hover:text-white"
                >
                  <BookOpen className="h-4 w-4" aria-hidden />
                </button>
              ) : null}
              <button
                type="button"
                onClick={handleResetThread}
                title="Start a fresh conversation"
                className="rounded-xl p-1.5 text-white/80 transition hover:bg-white/15 hover:text-white"
              >
                <RotateCcw className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close support chat"
                className="rounded-xl p-1.5 text-white/80 transition hover:bg-white/15 hover:text-white"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>

          {/* Status Banner when escalated */}
          {thread?.status === "escalated" ? (
            <div className="flex items-center gap-2 border-b border-amber-500/25 bg-amber-500/10 px-4 py-2 text-[11px] text-amber-800 dark:text-amber-200">
              <Clock className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
              <span>
                Escalated to live team · <strong>The agent may reply to you from now to 30min Max.</strong>
              </span>
            </div>
          ) : thread?.status === "agent_active" ? (
            <div className="flex items-center gap-2 border-b border-emerald-500/25 bg-emerald-500/10 px-4 py-2 text-[11px] text-emerald-800 dark:text-emerald-200">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
              <span>
                <strong>Live Agent connected</strong> · Discuss &amp; share screenshots or video recordings below.
              </span>
            </div>
          ) : null}

          {/* Messages Stream */}
          <div className="flex-1 space-y-3.5 overflow-y-auto px-4 py-4">
            {loading && !thread ? (
              <div className="flex h-40 items-center justify-center text-xs text-slate-400">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Loading BluCloaking Assistant…
              </div>
            ) : null}

            {messages.map((msg) => {
              const isUser = msg.sender_role === "user";
              const isAgent = msg.sender_role === "agent";
              const mediaUrl = resolveSupportMediaUrl(msg.attachment_url);

              return (
                <div
                  key={msg.id}
                  className={clsx("flex flex-col gap-1", isUser ? "items-end" : "items-start")}
                >
                  <div className="flex items-center gap-1.5 px-1 font-mono text-[10px] text-slate-400">
                    {isUser ? (
                      <>
                        <span>You</span>
                        <UserIcon className="h-3 w-3" aria-hidden />
                      </>
                    ) : isAgent ? (
                      <>
                        <Headset className="h-3 w-3 text-emerald-500" aria-hidden />
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                          {msg.sender_name || "Live Support Agent"}
                        </span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-3 w-3 text-meta-500" aria-hidden />
                        <span className="font-semibold text-meta-600 dark:text-meta-400">
                          BluCloaking AI Bot
                        </span>
                      </>
                    )}
                  </div>

                  <div
                    className={clsx(
                      "max-w-[88%] rounded-2xl px-3.5 py-2.5 shadow-sm",
                      isUser
                        ? "rounded-br-sm bg-meta-600 text-white"
                        : isAgent
                          ? "rounded-bl-sm border border-emerald-500/35 bg-emerald-500/10 text-slate-900 dark:text-slate-100"
                          : "rounded-bl-sm border border-black/[0.08] bg-slate-100/90 text-slate-800 dark:border-white/10 dark:bg-slate-800/80 dark:text-slate-100",
                    )}
                  >
                    <FormattedMessageBody text={msg.body} onLight={isUser} />

                    {mediaUrl ? (
                      <div className="mt-2 overflow-hidden rounded-xl border border-black/10 bg-black/20 dark:border-white/10">
                        {msg.attachment_type === "video" ||
                        /\.(mp4|webm|mov|mkv|m4v)$/i.test(mediaUrl) ? (
                          <video
                            src={mediaUrl}
                            controls
                            preload="metadata"
                            className="max-h-56 w-full bg-black object-contain"
                          />
                        ) : (
                          <a href={mediaUrl} target="_blank" rel="noreferrer" className="block">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={mediaUrl}
                              alt={msg.attachment_name || "Attached screenshot"}
                              className="max-h-56 w-full object-contain"
                            />
                          </a>
                        )}
                        <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 font-mono text-[10px] opacity-80">
                          <span className="truncate">{msg.attachment_name || "Attachment"}</span>
                          {msg.attachment_size ? (
                            <span>{formatBytes(msg.attachment_size)}</span>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}

            {/* Bot Quick-Reply Suggestions + "Didn't solve my issue" button */}
            {thread?.status === "bot" && lastBotMsg ? (
              <div className="space-y-2 pt-1">
                {lastBotMsg.suggestions.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {lastBotMsg.suggestions.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        disabled={sending}
                        onClick={() => void handleSend(chip)}
                        className="rounded-xl border border-meta-500/30 bg-meta-500/[0.07] px-2.5 py-1.5 text-left text-[11px] font-medium text-meta-700 transition hover:border-meta-500 hover:bg-meta-500/15 dark:text-meta-200"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                ) : null}

                {thread.bot_attempts > 0 && thread.bot_attempts < thread.max_attempts ? (
                  <div className="flex items-center justify-between rounded-xl border border-black/[0.07] bg-slate-50 px-3 py-2 text-[11px] dark:border-white/10 dark:bg-slate-900/60">
                    <span className="text-slate-500 dark:text-slate-400">
                      Attempt {thread.bot_attempts}/{thread.max_attempts} · Didn&apos;t solve your issue?
                    </span>
                    <button
                      type="button"
                      disabled={sending}
                      onClick={handleUnsolved}
                      className="inline-flex items-center gap-1 font-semibold text-meta-600 hover:underline dark:text-meta-300"
                    >
                      <ThumbsDown className="h-3 w-3" aria-hidden />
                      Still need help
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div ref={messagesEndRef} />
          </div>

          {/* 5-Attempt "Contact Live Agent" Escalation Banner (Bottom of Bot) */}
          {canEscalateNow ? (
            <div className="border-t border-amber-500/30 bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-amber-500/15 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                    Still need help after {thread?.bot_attempts} attempts?
                  </p>
                  <p className="text-[11px] text-amber-800/90 dark:text-amber-300/80">
                    Send your conversation &amp; account info to a live BluCloaking agent (reply in ≤30min Max).
                  </p>
                </div>
                <button
                  type="button"
                  disabled={escalating}
                  onClick={handleEscalate}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 shadow-md transition hover:bg-amber-400 disabled:opacity-50"
                >
                  {escalating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Headset className="h-3.5 w-3.5" aria-hidden />
                  )}
                  Contact Agent
                </button>
              </div>
            </div>
          ) : null}

          {/* Error banner */}
          {error ? (
            <div className="flex items-center gap-2 border-t border-red-500/30 bg-red-500/10 px-4 py-2 text-[11px] text-red-600 dark:text-red-300">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="flex-1">{error}</span>
              <button type="button" onClick={() => setError(null)} className="opacity-70 hover:opacity-100">
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ) : null}

          {/* Pending Attachment Preview */}
          {attachment ? (
            <div className="flex items-center justify-between gap-2 border-t border-black/10 bg-slate-50 px-4 py-2 text-xs dark:border-white/10 dark:bg-slate-900">
              <div className="flex min-w-0 items-center gap-2">
                {attachment.type === "video" ? (
                  <Video className="h-4 w-4 shrink-0 text-meta-500" aria-hidden />
                ) : (
                  <ImageIcon className="h-4 w-4 shrink-0 text-meta-500" aria-hidden />
                )}
                <span className="truncate font-mono text-[11px] text-slate-700 dark:text-slate-200">
                  {attachment.name}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-slate-400">
                  ({formatBytes(attachment.size)})
                </span>
              </div>
              <button
                type="button"
                onClick={() => setAttachment(null)}
                className="rounded p-1 text-slate-400 hover:bg-black/5 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ) : null}

          {/* Bottom Composer (Text + Screenshot/Video Upload + Screen Recorder) */}
          <div className="border-t border-black/10 bg-white p-3 dark:border-white/10 dark:bg-[#080d18]">
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

            <div className="flex items-end gap-2">
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  disabled={uploading || recording}
                  onClick={() => fileInputRef.current?.click()}
                  title="Upload screenshot or video recording"
                  className="grid h-9 w-9 place-items-center rounded-xl border border-black/10 text-slate-600 transition hover:border-meta-500 hover:text-meta-600 disabled:opacity-50 dark:border-white/10 dark:text-slate-300"
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
                    className="flex h-9 items-center gap-1 rounded-xl border border-red-500/50 bg-red-500/15 px-2.5 font-mono text-[11px] font-semibold text-red-600 dark:text-red-300"
                  >
                    <StopCircle className="h-3.5 w-3.5 animate-pulse" aria-hidden />
                    {recordSeconds}s
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => void handleStartScreenRecord()}
                    title="Record your screen directly"
                    className="grid h-9 w-9 place-items-center rounded-xl border border-black/10 text-slate-600 transition hover:border-meta-500 hover:text-meta-600 disabled:opacity-50 dark:border-white/10 dark:text-slate-300"
                  >
                    <MonitorPlay className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </div>

              <textarea
                rows={1}
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
                    void handleSend();
                  }
                }}
                placeholder={
                  isAgentMode
                    ? "Message live agent or attach screenshot/video…"
                    : "Ask BluCloaking AI or paste a screenshot…"
                }
                className="max-h-24 min-h-[36px] flex-1 resize-none rounded-xl border border-black/10 bg-slate-50 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-meta-500 focus:outline-none dark:border-white/10 dark:bg-slate-900/90 dark:text-slate-100"
              />

              <button
                type="button"
                disabled={sending || uploading || (!draft.trim() && !attachment)}
                onClick={() => void handleSend()}
                aria-label="Send message"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-meta-600 text-white shadow transition hover:bg-meta-500 disabled:opacity-40"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Send className="h-4 w-4" aria-hidden />
                )}
              </button>
            </div>

            <div className="mt-1.5 flex items-center justify-between px-1 font-mono text-[10px] text-slate-400">
              <span>Attach screenshot/video or click screen-record</span>
              <span>Paste image with Ctrl+V</span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
