"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Worker {
  id: string;
  full_name: string;
  phone: string | null;
  type: "standard" | "elevated";
  reports_to: string | null;
}

interface RawMessage {
  id: string;
  from_number: string;
  body: string | null;
  direction: "inbound" | "outbound";
  created_at: string;
  worker_id: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDateSeparator(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return "Today";
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function shouldShowDateSeparator(
  messages: RawMessage[],
  index: number
): boolean {
  if (index === 0) return true;
  const prev = new Date(messages[index - 1].created_at).toDateString();
  const curr = new Date(messages[index].created_at).toDateString();
  return prev !== curr;
}

function shouldShowTimestamp(messages: RawMessage[], index: number): boolean {
  if (index === 0) return true;
  const prev = new Date(messages[index - 1].created_at);
  const curr = new Date(messages[index].created_at);
  return curr.getTime() - prev.getTime() > 5 * 60 * 1000; // 5 min gap
}

// ---------------------------------------------------------------------------
// Shared iPhone screen (used in both desktop frame and mobile fullscreen)
// ---------------------------------------------------------------------------

function IPhoneScreen({
  selectedWorker,
  selectedWorkerId,
  messages,
  typing,
  inputText,
  setInputText,
  sending,
  handleSend,
  handleKeyDown,
  messagesEndRef,
  onBack,
}: {
  selectedWorker: Worker | undefined;
  selectedWorkerId: string;
  messages: RawMessage[];
  typing: boolean;
  inputText: string;
  setInputText: (v: string) => void;
  sending: boolean;
  handleSend: () => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  onBack?: () => void;
}) {
  return (
    <div className="w-full h-full bg-white flex flex-col">
      {/* Status bar / notch area */}
      <div className="relative h-12 bg-gray-50 flex items-center justify-center flex-shrink-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[120px] h-[28px] bg-black rounded-b-2xl hidden md:block" />
        <div className="absolute left-6 top-2 text-xs font-semibold text-black">
          9:41
        </div>
        <div className="absolute right-6 top-2 flex items-center gap-1">
          <div className="flex gap-[1px]">
            <div className="w-[3px] h-[4px] bg-black rounded-[0.5px]" />
            <div className="w-[3px] h-[6px] bg-black rounded-[0.5px]" />
            <div className="w-[3px] h-[8px] bg-black rounded-[0.5px]" />
            <div className="w-[3px] h-[10px] bg-black rounded-[0.5px]" />
          </div>
          <svg className="w-4 h-3 text-black" fill="currentColor" viewBox="0 0 24 24">
            <path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3c-1.65-1.66-4.34-1.66-6 0zm-4-4l2 2c2.76-2.76 7.24-2.76 10 0l2-2C15.14 9.14 8.87 9.14 5 13z" />
          </svg>
          <div className="w-6 h-3 border border-black rounded-sm relative">
            <div className="absolute inset-[1px] right-[2px] bg-black rounded-[1px]" />
            <div className="absolute right-[-3px] top-[3px] w-[2px] h-[5px] bg-black rounded-r-sm" />
          </div>
        </div>
      </div>

      {/* Header bar */}
      <div className="h-11 bg-gray-50 border-b border-gray-200 flex items-center px-4 flex-shrink-0">
        <div className="flex items-center gap-2 flex-1">
          <button onClick={onBack} className="md:pointer-events-none">
            <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <div className="flex flex-col items-center flex-1">
            <span className="text-sm font-semibold text-black">
              {selectedWorker?.full_name ?? "Select a worker"}
            </span>
            {selectedWorker?.phone && (
              <span className="text-[10px] text-gray-500">
                {selectedWorker.phone}
              </span>
            )}
          </div>
          <div className="w-7 h-7 rounded-full bg-gray-300 flex items-center justify-center">
            <svg className="w-4 h-4 text-gray-600" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
            </svg>
          </div>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-3 py-2 bg-white">
        {!selectedWorkerId && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-gray-400">Select a worker to start</p>
          </div>
        )}

        {selectedWorkerId && messages.length === 0 && !typing && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-gray-400">
              No messages yet. Send a message to start the conversation.
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={msg.id}>
            {shouldShowDateSeparator(messages, i) && (
              <div className="flex justify-center my-2">
                <span className="text-[11px] text-gray-500 bg-gray-100 rounded-full px-3 py-0.5">
                  {formatDateSeparator(msg.created_at)}
                </span>
              </div>
            )}

            {shouldShowTimestamp(messages, i) &&
              !shouldShowDateSeparator(messages, i) && (
                <div className="flex justify-center my-1">
                  <span className="text-[10px] text-gray-400">
                    {formatTimestamp(msg.created_at)}
                  </span>
                </div>
              )}

            <div
              className={`flex mb-1 ${
                msg.direction === "outbound" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[75%] rounded-2xl px-3 py-2 text-[15px] leading-snug whitespace-pre-wrap break-words ${
                  msg.direction === "outbound"
                    ? "bg-blue-500 text-white rounded-br-sm"
                    : "bg-gray-200 text-black rounded-bl-sm"
                }`}
              >
                {msg.body || "(empty)"}
              </div>
            </div>
          </div>
        ))}

        {typing && (
          <div className="flex justify-end mb-1">
            <div className="bg-blue-500 rounded-2xl rounded-br-sm px-4 py-2.5 flex items-center gap-1">
              <span className="w-2 h-2 bg-blue-200 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-2 h-2 bg-blue-200 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-2 h-2 bg-blue-200 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className="flex-shrink-0 border-t border-gray-200 bg-gray-50 px-2 py-1.5 pb-[env(safe-area-inset-bottom,6px)]">
        <div className="flex items-end gap-1.5">
          <button className="flex-shrink-0 w-8 h-8 flex items-center justify-center text-gray-400">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
            </svg>
          </button>
          <div className="flex-1 bg-white border border-gray-300 rounded-full px-3 py-1.5 flex items-center">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={selectedWorker ? "Text Message" : "Select a worker first..."}
              disabled={!selectedWorker?.phone}
              className="flex-1 text-[15px] bg-transparent outline-none text-black placeholder-gray-400 disabled:opacity-40"
            />
          </div>
          <button
            onClick={handleSend}
            disabled={!inputText.trim() || !selectedWorker?.phone || sending}
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-blue-500 text-white disabled:bg-gray-300 disabled:text-gray-500 transition-colors"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Home indicator */}
      <div className="h-5 bg-white flex items-center justify-center flex-shrink-0">
        <div className="w-32 h-1 bg-black rounded-full" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function SMSSimulatorPage() {
  const supabase = createClient();

  const [workers, setWorkers] = useState<Worker[]>([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string>("");
  const [messages, setMessages] = useState<RawMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [supervisorSending, setSupervisorSending] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const selectedWorker = workers.find((w) => w.id === selectedWorkerId);

  // On mobile, once a worker is selected we go fullscreen
  const isMobileFullscreen = !!selectedWorkerId;

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("workers")
        .select("id, full_name, phone, type, reports_to")
        .eq("is_active", true)
        .order("full_name");
      setWorkers((data as Worker[]) ?? []);
    }
    load();
  }, [supabase]);

  const loadConversation = useCallback(
    async (workerId: string) => {
      if (!workerId) { setMessages([]); return; }
      const worker = workers.find((w) => w.id === workerId);
      if (!worker?.phone) { setMessages([]); return; }
      const { data } = await supabase
        .from("raw_messages")
        .select("id, from_number, body, direction, created_at, worker_id")
        .eq("worker_id", workerId)
        .order("created_at", { ascending: true })
        .limit(200);
      setMessages((data as RawMessage[]) ?? []);
    },
    [supabase, workers]
  );

  useEffect(() => { loadConversation(selectedWorkerId); }, [selectedWorkerId, loadConversation]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, typing]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 5000); return () => clearTimeout(t); } }, [toast]);

  const handleSend = async () => {
    if (!inputText.trim() || !selectedWorker?.phone || sending) return;
    const text = inputText.trim();
    setInputText("");
    setSending(true);
    setTyping(true);
    const optimisticMsg: RawMessage = {
      id: `temp_${Date.now()}`, from_number: selectedWorker.phone,
      body: text, direction: "inbound", created_at: new Date().toISOString(), worker_id: selectedWorkerId,
    };
    setMessages((prev) => [...prev, optimisticMsg]);
    try {
      const res = await fetch("/api/sms-simulator", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromNumber: selectedWorker.phone, text }),
      });
      const data = await res.json();
      if (data.replies && data.replies.length > 0) {
        const replyMsgs: RawMessage[] = data.replies.map(
          (r: { body: string; created_at: string }, i: number) => ({
            id: `reply_${Date.now()}_${i}`, from_number: "system", body: r.body,
            direction: "outbound" as const, created_at: r.created_at, worker_id: selectedWorkerId,
          })
        );
        setMessages((prev) => [...prev, ...replyMsgs]);
      }
    } catch { setToast("Failed to send message"); }
    finally { setSending(false); setTyping(false); }
  };

  const handleSupervisorConfirm = async () => {
    if (!selectedWorker || supervisorSending) return;
    const supervisor = selectedWorker.reports_to
      ? workers.find((w) => w.id === selectedWorker.reports_to)
      : workers.find((w) => w.type === "elevated" && w.id !== selectedWorker.id);
    if (!supervisor?.phone) { setToast("No supervisor found for this worker."); return; }
    setSupervisorSending(true);
    try {
      const res = await fetch("/api/sms-simulator", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromNumber: supervisor.phone, text: "OK" }),
      });
      if (res.ok) setToast(`Supervisor "${supervisor.full_name}" sent "OK" to approve.`);
      else setToast("Failed to send supervisor confirmation.");
    } catch { setToast("Failed to send supervisor confirmation."); }
    finally { setSupervisorSending(false); }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleMobileBack = () => { setSelectedWorkerId(""); };

  // -------------------------------------------------------------------------
  // MOBILE: fullscreen iMessage when worker is selected
  // -------------------------------------------------------------------------
  if (isMobileFullscreen) {
    return (
      <>
        {/* Fullscreen overlay — only visible on mobile */}
        <div className="fixed inset-0 z-50 bg-white md:hidden">
          <IPhoneScreen
            selectedWorker={selectedWorker}
            selectedWorkerId={selectedWorkerId}
            messages={messages}
            typing={typing}
            inputText={inputText}
            setInputText={setInputText}
            sending={sending}
            handleSend={handleSend}
            handleKeyDown={handleKeyDown}
            messagesEndRef={messagesEndRef}
            onBack={handleMobileBack}
          />
        </div>

        {/* Desktop: normal layout with iPhone frame */}
        <div className="hidden md:block">
          <DesktopLayout
            workers={workers}
            selectedWorkerId={selectedWorkerId}
            setSelectedWorkerId={setSelectedWorkerId}
            selectedWorker={selectedWorker}
            messages={messages}
            typing={typing}
            inputText={inputText}
            setInputText={setInputText}
            sending={sending}
            handleSend={handleSend}
            handleKeyDown={handleKeyDown}
            messagesEndRef={messagesEndRef}
            toast={toast}
            supervisorSending={supervisorSending}
            handleSupervisorConfirm={handleSupervisorConfirm}
          />
        </div>
      </>
    );
  }

  // -------------------------------------------------------------------------
  // No worker selected — show picker (both mobile and desktop)
  // -------------------------------------------------------------------------
  return (
    <>
      {/* Mobile: worker picker styled like iOS contacts */}
      <div className="md:hidden fixed inset-0 z-50 bg-white flex flex-col">
        <div className="relative h-12 bg-gray-50 flex items-center justify-center flex-shrink-0">
          <div className="absolute left-6 top-2 text-xs font-semibold text-black">9:41</div>
          <div className="absolute right-6 top-2 flex items-center gap-1">
            <div className="flex gap-[1px]">
              <div className="w-[3px] h-[4px] bg-black rounded-[0.5px]" />
              <div className="w-[3px] h-[6px] bg-black rounded-[0.5px]" />
              <div className="w-[3px] h-[8px] bg-black rounded-[0.5px]" />
              <div className="w-[3px] h-[10px] bg-black rounded-[0.5px]" />
            </div>
            <svg className="w-4 h-3 text-black" fill="currentColor" viewBox="0 0 24 24">
              <path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3c-1.65-1.66-4.34-1.66-6 0zm-4-4l2 2c2.76-2.76 7.24-2.76 10 0l2-2C15.14 9.14 8.87 9.14 5 13z" />
            </svg>
            <div className="w-6 h-3 border border-black rounded-sm relative">
              <div className="absolute inset-[1px] right-[2px] bg-black rounded-[1px]" />
              <div className="absolute right-[-3px] top-[3px] w-[2px] h-[5px] bg-black rounded-r-sm" />
            </div>
          </div>
        </div>
        <div className="h-11 bg-gray-50 border-b border-gray-200 flex items-center justify-center px-4 flex-shrink-0">
          <span className="text-lg font-semibold text-black">Messages</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {workers.filter((w) => w.phone).map((w) => (
            <button
              key={w.id}
              onClick={() => setSelectedWorkerId(w.id)}
              className="w-full flex items-center gap-3 px-4 py-3 border-b border-gray-100 active:bg-gray-100 text-left"
            >
              <div className="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-semibold text-gray-600">
                  {w.full_name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-medium text-black">{w.full_name}</div>
                <div className="text-[13px] text-gray-500 truncate">
                  {w.phone} · {w.type === "elevated" ? "Supervisor" : "Worker"}
                </div>
              </div>
              <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          ))}
        </div>
        <div className="h-5 bg-white flex items-center justify-center flex-shrink-0 pb-[env(safe-area-inset-bottom,0px)]">
          <div className="w-32 h-1 bg-black rounded-full" />
        </div>
      </div>

      {/* Desktop: normal layout */}
      <div className="hidden md:block">
        <DesktopLayout
          workers={workers}
          selectedWorkerId={selectedWorkerId}
          setSelectedWorkerId={setSelectedWorkerId}
          selectedWorker={selectedWorker}
          messages={messages}
          typing={typing}
          inputText={inputText}
          setInputText={setInputText}
          sending={sending}
          handleSend={handleSend}
          handleKeyDown={handleKeyDown}
          messagesEndRef={messagesEndRef}
          toast={toast}
          supervisorSending={supervisorSending}
          handleSupervisorConfirm={handleSupervisorConfirm}
        />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Desktop layout (iPhone frame + controls)
// ---------------------------------------------------------------------------

function DesktopLayout({
  workers, selectedWorkerId, setSelectedWorkerId, selectedWorker,
  messages, typing, inputText, setInputText, sending,
  handleSend, handleKeyDown, messagesEndRef,
  toast, supervisorSending, handleSupervisorConfirm,
}: {
  workers: Worker[];
  selectedWorkerId: string;
  setSelectedWorkerId: (id: string) => void;
  selectedWorker: Worker | undefined;
  messages: RawMessage[];
  typing: boolean;
  inputText: string;
  setInputText: (v: string) => void;
  sending: boolean;
  handleSend: () => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  toast: string | null;
  supervisorSending: boolean;
  handleSupervisorConfirm: () => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">SMS Simulator</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Demo the Pruvea time tracking SMS flow with a simulated iPhone interface.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">Select Worker</label>
          <select
            value={selectedWorkerId}
            onChange={(e) => setSelectedWorkerId(e.target.value)}
            className="rounded-md border bg-background px-3 py-2 text-sm min-w-[280px]"
          >
            <option value="">-- Choose a worker --</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.full_name} {w.phone ? `(${w.phone})` : "(no phone)"} - {w.type}
              </option>
            ))}
          </select>
        </div>

        {selectedWorker && (
          <button
            onClick={handleSupervisorConfirm}
            disabled={supervisorSending}
            className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
          >
            {supervisorSending ? "Sending..." : "Simulate Supervisor Confirm"}
          </button>
        )}
      </div>

      {toast && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {toast}
        </div>
      )}

      <div className="flex justify-center py-4">
        <div className="relative bg-black rounded-[50px] shadow-2xl" style={{ width: 390, height: 844, padding: 12 }}>
          <div className="w-full h-full rounded-[40px] overflow-hidden">
            <IPhoneScreen
              selectedWorker={selectedWorker}
              selectedWorkerId={selectedWorkerId}
              messages={messages}
              typing={typing}
              inputText={inputText}
              setInputText={setInputText}
              sending={sending}
              handleSend={handleSend}
              handleKeyDown={handleKeyDown}
              messagesEndRef={messagesEndRef}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
