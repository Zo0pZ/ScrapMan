/* ---------- messaging (per accepted job, backed by the real `messages` table — RLS
   restricts each thread to that job's homeowner + assigned collector) ---------- */
export let scrapmanMessageChannel = null;

export function unsubscribeFromThreadMessages() {
  if (scrapmanMessageChannel) { scrapmanDb.removeChannel(scrapmanMessageChannel); scrapmanMessageChannel = null; }
}

export function subscribeToThreadMessages(assignmentId) {
  unsubscribeFromThreadMessages();
  if (!scrapmanDb) return;
  scrapmanMessageChannel = scrapmanDb
    .channel(`thread:${assignmentId}:messages`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `assignment_id=eq.${assignmentId}` }, () => renderThread())
    .subscribe();
}

export async function fetchMyThreads() {
  if (!SCRAPMAN_AUTH_CONFIGURED || !scrapmanSession) return [];
  const { data, error } = await scrapmanDb
    .from("job_assignments")
    .select("id, status, listings(title)")
    .order("accepted_at", { ascending: false });
  if (error) { console.error(error); return []; }
  return data || [];
}

export async function fetchThreadMessages(assignmentId) {
  const { data, error } = await scrapmanDb
    .from("messages")
    .select("*, profiles:sender_id(display_name)")
    .eq("assignment_id", assignmentId)
    .order("created_at", { ascending: true });
  if (error) { console.error(error); return []; }
  return data || [];
}

export async function sendThreadMessage(assignmentId, body) {
  if (!scrapmanSession) return;
  await scrapmanDb.from("messages").insert({ assignment_id: assignmentId, sender_id: scrapmanSession.user.id, body });
}

export function openThread(id) {
  currentThread = id;
  goTo("thread");
  subscribeToThreadMessages(id);
}

export async function renderMessages() {
  const listEl = document.getElementById("threadList");
  const emptyEl = document.getElementById("messagesEmpty");
  const threads = await fetchMyThreads();

  if (!threads.length) {
    emptyEl.classList.remove("hidden");
    listEl.innerHTML = "";
    return;
  }
  emptyEl.classList.add("hidden");
  const previews = await Promise.all(threads.map(async t => ({ thread: t, msgs: await fetchThreadMessages(t.id) })));
  listEl.innerHTML = previews.map(({ thread, msgs }) => {
    const last = msgs[msgs.length - 1];
    return `
      <button class="thread-row" data-thread="${thread.id}">
        <div>
          <h4>${esc(thread.listings.title)}</h4>
          <span>${last ? esc(last.body) : "Start the conversation"}</span>
        </div>
        ${last ? `<time>${new Date(last.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>` : ""}
      </button>`;
  }).join("");
}

document.getElementById("threadList").addEventListener("click", e => {
  const row = e.target.closest("[data-thread]");
  if (row) openThread(Number(row.dataset.thread));
});

export async function renderThread() {
  if (currentThread == null) { goTo("messages"); return; }
  const { data: assignment } = await scrapmanDb.from("job_assignments").select("id, listings(title)").eq("id", currentThread).single();
  document.getElementById("threadTitle").textContent = assignment ? assignment.listings.title : "Conversation";

  const myId = scrapmanSession.user.id;
  const msgs = await fetchThreadMessages(currentThread);
  const listEl = document.getElementById("msgList");
  listEl.innerHTML = msgs.length
    ? msgs.map(m => `
        <div class="msg ${m.sender_id === myId ? "me" : ""}">
          <p>${esc(m.body)}</p>
          <span class="msg-meta">${esc((m.profiles && m.profiles.display_name) || "")} &middot; ${new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </div>`).join("")
    : `<p class="msg-empty">No messages yet — say hello and agree a pickup time.</p>`;
  listEl.scrollTop = listEl.scrollHeight;
}

document.getElementById("msgForm").addEventListener("submit", async e => {
  e.preventDefault();
  const input = document.getElementById("msgInput");
  const text = input.value.trim();
  if (!text || currentThread == null) return;
  input.value = "";
  await sendThreadMessage(currentThread, text);
  renderThread();
});

