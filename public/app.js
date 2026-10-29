const API = "/api";
let token = localStorage.getItem("token");
let user = JSON.parse(localStorage.getItem("user") || "null");
let pendingUnverifiedEmail = null;
let currentView = "browse";
let currentFilter = "";

// ============================================================
// Auth screen tab switching
// ============================================================
document.getElementById("showLogin").onclick = () => switchAuthTab("login");
document.getElementById("showRegister").onclick = () => switchAuthTab("register");
document.getElementById("showForgot").onclick = () => switchAuthTab("forgot");

function switchAuthTab(which) {
  document.getElementById("loginForm").classList.toggle("hidden", which !== "login");
  document.getElementById("registerForm").classList.toggle("hidden", which !== "register");
  document.getElementById("verifyForm").classList.toggle("hidden", which !== "verify");
  document.getElementById("forgotForm").classList.toggle("hidden", which !== "forgot");
  document.getElementById("showLogin").classList.toggle("active", which === "login");
  document.getElementById("showRegister").classList.toggle("active", which === "register");
  document.getElementById("showForgot").classList.toggle("active", which === "forgot");
  clearAuthMessages();
}

function clearAuthMessages() {
  document.getElementById("authError").textContent = "";
  document.getElementById("authSuccess").textContent = "";
}

function showAuthError(msg) { document.getElementById("authError").textContent = msg; }
function showAuthSuccess(msg) { document.getElementById("authSuccess").textContent = msg; }

function showBanner(msg, isError = false) {
  const el = document.getElementById("banner");
  el.textContent = msg;
  el.className = "banner " + (isError ? "banner-error" : "banner-success");
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 4500);
}

// ============================================================
// Register / Login / Verify / Forgot / Reset
// ============================================================
document.getElementById("registerBtn").onclick = async () => {
  clearAuthMessages();
  const btn = document.getElementById("registerBtn");
  const register_no = document.getElementById("regRegisterNo").value.trim();
  const email = document.getElementById("regEmail").value.trim();
  const password = document.getElementById("regPassword").value;
  if (!register_no || !email || !password) return showAuthError("Please fill all fields");

  btn.disabled = true;
  btn.textContent = "Creating account...";
  // Render free tier can take 30–50s to wake up
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(`${API}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ register_no, email, password }),
      signal: controller.signal,
    });
    const data = await res.json();
    if (!res.ok) {
      showAuthError(data.error || "Registration failed");
      return;
    }
    pendingUnverifiedEmail = email;
    document.getElementById("verifyEmail").value = email;
    const code = data.otp || data.demoOtp || "";
    document.getElementById("verifyCode").value = code; // only filled in dev mode
    switchAuthTab("verify");
    const msg = code
      ? `Account created! Dev code: ${code}`
      : (data.message || "Account created. Check your email for the code.");
    showAuthSuccess(msg);
    showBanner(msg);
  } catch (e) {
    if (e.name === "AbortError") {
      showAuthError("Server is taking too long (free plan may be waking up). Wait 30 seconds and try again.");
    } else {
      showAuthError("Could not reach the server. The free service may be waking up — wait 30s and try again.");
    }
  } finally {
    clearTimeout(timeoutId);
    btn.disabled = false;
    btn.textContent = "Create account";
  }
};

document.getElementById("verifyBtn").onclick = async () => {
  clearAuthMessages();
  const email = document.getElementById("verifyEmail").value;
  const code = document.getElementById("verifyCode").value.trim();
  if (!code) return showAuthError("Enter the 6-digit code");

  const btn = document.getElementById("verifyBtn");
  btn.disabled = true;
  btn.textContent = "Verifying...";
  try {
    const res = await fetch(`${API}/auth/verify`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code }),
    });
    const data = await res.json();
    if (!res.ok) return showAuthError(data.error);
    token = data.token;
    user = data.user;
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(user));
    showBanner("Verified! Welcome " + user.name);
    enterApp();
  } catch (e) {
    showAuthError("Could not reach the server.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Verify & Login";
  }
};

document.getElementById("loginBtn").onclick = async () => {
  clearAuthMessages();
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const btn = document.getElementById("loginBtn");
  btn.disabled = true;
  btn.textContent = "Logging in...";
  try {
    const res = await fetch(`${API}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      showAuthError(data.error);
      if (data.unverified) {
        pendingUnverifiedEmail = email;
        document.getElementById("verifyEmail").value = email;
        switchAuthTab("verify");
        showAuthSuccess("Please enter the verification code sent to your email.");
      }
      return;
    }
    token = data.token;
    user = data.user;
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(user));
    enterApp();
  } catch (e) {
    showAuthError("Could not reach the server. Wait a few seconds if the service is waking up.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Login";
  }
};

document.getElementById("resendBtn").onclick = async () => {
  const email = document.getElementById("verifyEmail").value || pendingUnverifiedEmail;
  if (!email) return showAuthError("Email missing — go back and register again.");
  showAuthSuccess("Sending new code...");
  try {
    const res = await fetch(`${API}/auth/resend-verification`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    const code = data.otp || data.demoOtp || "";
    if (code) {
      document.getElementById("verifyCode").value = code;
      showAuthSuccess(`New code: ${code}`);
      showBanner(`New verification code: ${code}`);
    } else {
      showAuthSuccess(data.message || "A new code was sent to your email. Check inbox and Spam.");
      showBanner(data.message || "Check your email for the new code.");
    }
  } catch (e) {
    showAuthError("Could not resend code. Try again in a moment.");
  }
};

document.getElementById("sendCodeBtn").onclick = async () => {
  clearAuthMessages();
  const email = document.getElementById("forgotEmail").value.trim();
  if (!email) return showAuthError("Enter your email");
  const btn = document.getElementById("sendCodeBtn");
  btn.disabled = true;
  btn.textContent = "Sending...";
  try {
    const res = await fetch(`${API}/auth/forgot-password`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }),
    });
    const data = await res.json();
    const code = data.resetCode || data.demoResetCode || "";
    document.getElementById("forgotStep1").classList.add("hidden");
    document.getElementById("forgotStep2").classList.remove("hidden");
    if (code) {
      document.getElementById("resetCode").value = code;
      showAuthSuccess(`Reset code: ${code}`);
      showBanner(`Password reset code: ${code}`);
    } else {
      showAuthSuccess(data.message || "If that email is registered, a reset code was sent.");
    }
  } catch (e) {
    showAuthError("Could not reach the server. Try again in a moment.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Send reset code";
  }
};

document.getElementById("resetBtn").onclick = async () => {
  clearAuthMessages();
  const code = document.getElementById("resetCode").value;
  const password = document.getElementById("newPassword").value;
  const res = await fetch(`${API}/auth/reset-password`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: code, password }),
  });
  const data = await res.json();
  if (!res.ok) return showAuthError(data.error);
  showAuthSuccess(data.message);
  setTimeout(() => switchAuthTab("login"), 1200);
};

document.getElementById("logoutBtn").onclick = () => {
  localStorage.clear();
  location.reload();
};

// ============================================================
// Change email (Profile)
// ============================================================
document.getElementById("showChangeEmailBtn").onclick = () => {
  document.getElementById("changeEmailBox").classList.toggle("hidden");
  document.getElementById("changeEmailMsg").textContent = "";
};

document.getElementById("sendChangeEmailBtn").onclick = async () => {
  const newEmail = document.getElementById("newEmailInput").value.trim();
  const msg = document.getElementById("changeEmailMsg");
  msg.textContent = "";
  if (!newEmail) { msg.textContent = "Enter a new email"; return; }
  const btn = document.getElementById("sendChangeEmailBtn");
  btn.disabled = true;
  btn.textContent = "Sending...";
  try {
    const res = await fetch(`${API}/auth/change-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ newEmail }),
    });
    const data = await res.json();
    if (!res.ok) { msg.textContent = data.error || "Failed"; return; }
    if (data.otp) {
      document.getElementById("changeEmailCode").value = data.otp;
      msg.textContent = `Code: ${data.otp}`;
    } else {
      msg.textContent = data.message || "Code sent. Check the new inbox.";
    }
    showBanner(data.message || "Code sent");
  } catch (e) {
    msg.textContent = "Network error. Try again.";
  } finally {
    btn.disabled = false;
    btn.textContent = "Send code to new email";
  }
};

document.getElementById("confirmChangeEmailBtn").onclick = async () => {
  const newEmail = document.getElementById("newEmailInput").value.trim();
  const code = document.getElementById("changeEmailCode").value.trim();
  const msg = document.getElementById("changeEmailMsg");
  msg.textContent = "";
  if (!newEmail || !code) { msg.textContent = "Enter new email and code"; return; }
  const btn = document.getElementById("confirmChangeEmailBtn");
  btn.disabled = true;
  btn.textContent = "Confirming...";
  try {
    const res = await fetch(`${API}/auth/confirm-change-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ newEmail, code }),
    });
    const data = await res.json();
    if (!res.ok) { msg.textContent = data.error || "Failed"; return; }
    token = data.token;
    user = data.user;
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(user));
    document.getElementById("profileEmail").textContent = user.email;
    document.getElementById("changeEmailBox").classList.add("hidden");
    document.getElementById("newEmailInput").value = "";
    document.getElementById("changeEmailCode").value = "";
    showBanner("Email updated to " + user.email);
  } catch (e) {
    msg.textContent = "Network error. Try again.";
  } finally {
    btn.disabled = false;
    btn.textContent = "Confirm new email";
  }
};


// ============================================================
// Entering the app + tab navigation
// ============================================================
function enterApp() {
  document.getElementById("authScreen").classList.add("hidden");
  document.getElementById("appScreen").classList.remove("hidden");
  document.getElementById("welcomeMsg").textContent = user.name;
  document.getElementById("profileName").textContent = user.name;
  document.getElementById("profileRollNo").textContent = user.roll_no ? `Roll No: ${user.roll_no}` : "";
  document.getElementById("profileRegisterNo").textContent = user.register_no ? `Register No: ${user.register_no}` : "";
  document.getElementById("profileEmail").textContent = user.email;
  document.getElementById("profileRole").textContent = user.role === "admin" ? "Admin" : "Student";
  document.getElementById("avatarInitial").textContent = user.name.charAt(0).toUpperCase();
  switchView("browse");
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.onclick = () => switchView(btn.dataset.view);
});

function switchView(view) {
  currentView = view;
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  document.getElementById("browseView").classList.toggle("hidden", view !== "browse");
  document.getElementById("mineView").classList.toggle("hidden", view !== "mine");
  document.getElementById("profileView").classList.toggle("hidden", view !== "profile");
  document.getElementById("pageTitle").textContent =
    view === "browse" ? "Browse" : view === "mine" ? "My Reports" : "Profile";
  if (view === "browse") loadBrowse();
  if (view === "mine") loadMine();
}

// ============================================================
// Browse + filters
// ============================================================
document.querySelectorAll(".filter-btn").forEach((btn) => {
  btn.onclick = () => {
    currentFilter = btn.dataset.type;
    document.querySelectorAll(".filter-btn").forEach((b) => b.classList.toggle("active", b === btn));
    loadBrowse();
  };
});

async function loadBrowse() {
  const url = `${API}/reports${currentFilter ? `?type=${currentFilter}` : ""}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const reports = await res.json();
  renderList("browseList", reports);
}

async function loadMine() {
  const res = await fetch(`${API}/reports/mine`, { headers: { Authorization: `Bearer ${token}` } });
  const reports = await res.json();
  renderList("mineList", reports);
}

function renderList(containerId, reports) {
  const container = document.getElementById(containerId);
  if (reports.length === 0) {
    container.innerHTML = `<p class="empty-msg">Nothing here yet.</p>`;
    return;
  }
  container.innerHTML = reports.map(reportCardHtml).join("");
  container.querySelectorAll("[data-report-id]").forEach((card) => {
    card.onclick = () => openDetail(card.dataset.reportId);
  });
}

function reportCardHtml(r) {
  const typeColor = r.type === "lost" ? "#B23A2E" : "#2E86AB";
  return `
    <div class="report-card" data-report-id="${r.id}">
      <div class="report-type-bar" style="background:${typeColor}"></div>
      <div class="report-content">
        <div class="report-header">
          <span class="report-type-label" style="color:${typeColor}">${r.type === "lost" ? "LOST" : "FOUND"}</span>
          <span class="report-status">${r.status}</span>
        </div>
        <p class="report-title">${escapeHtml(r.title)}</p>
        <p class="report-desc">${escapeHtml(r.description)}</p>
        <p class="report-meta">${escapeHtml(r.category)} · ${escapeHtml(r.location)}</p>
        ${r.matchScore !== undefined ? `<p class="report-score">${r.matchScore}% likely match</p>` : ""}
      </div>
      ${r.photo_path ? `<img class="report-thumb" src="${r.photo_path}" alt="" />` : ""}
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ============================================================
// New report modal
// ============================================================
document.getElementById("newReportFab").onclick = () => {
  document.getElementById("reportFormModal").classList.remove("hidden");
};
document.getElementById("closeFormBtn").onclick = () => {
  document.getElementById("reportFormModal").classList.add("hidden");
};

let selectedType = "lost";
document.getElementById("typeLostBtn").onclick = () => setReportType("lost");
document.getElementById("typeFoundBtn").onclick = () => setReportType("found");
function setReportType(type) {
  selectedType = type;
  document.getElementById("typeLostBtn").classList.toggle("active", type === "lost");
  document.getElementById("typeFoundBtn").classList.toggle("active", type === "found");
}

document.getElementById("submitReportBtn").onclick = async () => {
  const category = document.getElementById("reportCategory").value;
  const title = document.getElementById("reportTitle").value;
  const description = document.getElementById("reportDescription").value;
  const location = document.getElementById("reportLocation").value;
  const photoFile = document.getElementById("reportPhoto").files[0];
  const errorEl = document.getElementById("formError");
  const btn = document.getElementById("submitReportBtn");
  errorEl.textContent = "";

  if (!title || !description || !location) {
    errorEl.textContent = "Please fill in title, description, and location.";
    return;
  }
  if (photoFile && photoFile.size > 8 * 1024 * 1024) {
    errorEl.textContent = "Image is too large (max 8 MB). Please choose a smaller photo.";
    return;
  }
  if (photoFile && photoFile.size > 2 * 1024 * 1024) {
    // Warn but allow — large files are slow on free Render
    const mb = (photoFile.size / (1024 * 1024)).toFixed(1);
    const ok = confirm(
      `This photo is ${mb} MB. Uploads over 2 MB can take a while on the free server.\n\nContinue anyway?`
    );
    if (!ok) return;
  }

  btn.disabled = true;
  btn.textContent = photoFile
    ? (photoFile.size > 2 * 1024 * 1024 ? "Uploading large image (please wait)..." : "Uploading image...")
    : "Publishing...";

  const formData = new FormData();
  formData.append("type", selectedType);
  formData.append("category", category);
  formData.append("title", title);
  formData.append("description", description);
  formData.append("location", location);
  if (photoFile) formData.append("photo", photoFile);

  try {
    const res = await fetch(`${API}/reports`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData,
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || "Failed to publish";
      return;
    }
    document.getElementById("reportFormModal").classList.add("hidden");
    document.getElementById("reportTitle").value = "";
    document.getElementById("reportDescription").value = "";
    document.getElementById("reportLocation").value = "";
    document.getElementById("reportPhoto").value = "";
    showBanner("Report published successfully!");
    if (currentView === "browse") loadBrowse(); else switchView("mine");
  } catch (e) {
    errorEl.textContent = "Network error. The free server may be slow — try again in a moment.";
  } finally {
    btn.disabled = false;
    btn.textContent = "Publish report";
  }
};

// ============================================================
// Report detail modal (with AI matches)
// ============================================================
document.getElementById("closeDetailBtn").onclick = () => {
  document.getElementById("detailModal").classList.add("hidden");
};

async function openDetail(id) {
  const [reportRes, matchesRes] = await Promise.all([
    fetch(`${API}/reports/${id}`, { headers: { Authorization: `Bearer ${token}` } }),
    fetch(`${API}/reports/${id}/matches`, { headers: { Authorization: `Bearer ${token}` } }),
  ]);
  const report = await reportRes.json();
  const matches = await matchesRes.json();
  renderDetail(report, matches);
  document.getElementById("detailModal").classList.remove("hidden");
}

function renderDetail(r, matches) {
  const typeColor = r.type === "lost" ? "#B23A2E" : "#2E86AB";
  const isOwner = user.id === r.user_id;
  const isAdmin = user.role === "admin";
  const canManage = (isOwner || isAdmin) && r.status !== "Returned";

  const matchesHtml = matches.length === 0
    ? `<p class="no-matches">No likely matches yet.</p>`
    : matches.map(reportCardHtml).join("");

  document.getElementById("detailContent").innerHTML = `
    ${r.photo_path ? `<img class="detail-photo" src="${r.photo_path}" alt="" />` : ""}
    <p class="detail-type" style="color:${typeColor}">${r.type === "lost" ? "LOST ITEM" : "FOUND ITEM"}</p>
    <p class="detail-title">${escapeHtml(r.title)}</p>
    <p class="detail-desc">${escapeHtml(r.description)}</p>
    <div class="detail-meta-box">
      <p>Category: ${escapeHtml(r.category)}</p>
      <p>Location: ${escapeHtml(r.location)}</p>
      <p>Reported by: ${escapeHtml(r.reporter_name)}</p>
      <p>Status: ${r.status}</p>
    </div>
    ${canManage ? `
      <div class="detail-actions">
        ${r.status === "Open" ? `<button class="action-btn-secondary" onclick="updateReportStatus(${r.id}, 'Matched')">Mark as Matched</button>` : ""}
        <button class="action-btn-primary" onclick="updateReportStatus(${r.id}, 'Returned')">Mark as Returned</button>
        <button class="action-btn-danger" onclick="deleteReport(${r.id})">Delete Report</button>
      </div>` : ""}
    <p class="matches-title">AI-Suggested Matches (${matches.length})</p>
    <div class="report-list">${matchesHtml}</div>
  `;

  document.querySelectorAll("#detailContent [data-report-id]").forEach((card) => {
    card.onclick = () => openDetail(card.dataset.reportId);
  });
}

async function updateReportStatus(id, status) {
  const res = await fetch(`${API}/reports/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status }),
  });
  const updated = await res.json();
  const matchesRes = await fetch(`${API}/reports/${id}/matches`, { headers: { Authorization: `Bearer ${token}` } });
  const matches = await matchesRes.json();
  renderDetail(updated, matches);
  if (currentView === "browse") loadBrowse();
  if (currentView === "mine") loadMine();
}

async function deleteReport(id) {
  if (!confirm("Are you sure you want to permanently delete this report?")) return;
  const res = await fetch(`${API}/reports/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) {
    showBanner(data.error || "Could not delete", true);
    return;
  }
  document.getElementById("detailModal").classList.add("hidden");
  showBanner("Report deleted");
  if (currentView === "browse") loadBrowse();
  if (currentView === "mine") loadMine();
}

// ============================================================
// Auto-login if a session was already saved
// ============================================================
if (token && user) enterApp();
