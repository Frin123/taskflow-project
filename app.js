/* ==================== 1. STORAGE & INDEXEDDB WRAPPER ==================== */
const DB_NAME = 'TaskFlowDB';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_TASKS = 'tasks';

const LS_USERS = 'tf_users';
const LS_SESSION = 'tf_session';
const LS_THEME = 'tf_theme';

let dbInstance = null;

function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        const projStore = db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
        projStore.createIndex('userId', 'userId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_TASKS)) {
        const taskStore = db.createObjectStore(STORE_TASKS, { keyPath: 'id' });
        taskStore.createIndex('projectId', 'projectId', { unique: false });
        taskStore.createIndex('userId', 'userId', { unique: false });
      }
    };

    request.onsuccess = (e) => {
      dbInstance = e.target.result;
      resolve(dbInstance);
    };

    request.onerror = (e) => reject(e.target.error);
  });
}

function dbAction(storeName, mode, callback) {
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const request = callback(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAllByUser(storeName, userId) {
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const index = store.index('userId');
    const request = index.getAll(userId);
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/* ==================== 2. APP STATE ==================== */
const state = {
  currentUser: null,
  projects: [],
  tasks: [],
  activeProjectId: null,
  confirmCallback: null
};

/* ==================== 3. UTILITIES & FEEDBACK ==================== */
function generateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3200);
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getDaysDiff(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const options = { day: 'numeric', month: 'short', year: 'numeric' };
  return new Date(dateStr).toLocaleDateString('id-ID', options);
}

/* ==================== 4. THEME (DARK MODE) ==================== */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(LS_THEME, theme);
  const isDark = theme === 'dark';
  document.querySelectorAll('.theme-icon').forEach((el) => {
    el.textContent = isDark ? '☀️' : '🌙';
  });
  const authToggle = document.getElementById('theme-toggle-auth');
  if (authToggle) {
    authToggle.innerHTML = `<span class="theme-icon">${isDark ? '☀️' : '🌙'}</span> ${isDark ? 'Mode Terang' : 'Mode Gelap'}`;
  }
}

function toggleTheme() {
  const current = localStorage.getItem(LS_THEME) || 'light';
  applyTheme(current === 'light' ? 'dark' : 'light');
}

/* ==================== 5. AUTHENTICATION & ROUTE GUARD ==================== */
function getUsers() {
  return JSON.parse(localStorage.getItem(LS_USERS) || '[]');
}

function saveUsers(users) {
  localStorage.setItem(LS_USERS, JSON.stringify(users));
}

function getSession() {
  return JSON.parse(localStorage.getItem(LS_SESSION) || 'null');
}

function checkAuthGuard() {
  const session = getSession();
  const authView = document.getElementById('auth-view');
  const appView = document.getElementById('app-view');

  if (!session) {
    state.currentUser = null;
    authView.classList.remove('hidden');
    appView.classList.add('hidden');
    return false;
  }

  state.currentUser = session;
  document.getElementById('user-display-name').textContent = session.name;
  authView.classList.add('hidden');
  appView.classList.remove('hidden');
  return true;
}

function handleRegister(e) {
  e.preventDefault();
  const name = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim().toLowerCase();
  const password = document.getElementById('reg-password').value;

  // Reset errors
  document.getElementById('err-reg-name').textContent = '';
  document.getElementById('err-reg-email').textContent = '';
  document.getElementById('err-reg-password').textContent = '';

  let valid = true;
  if (name.length < 2) {
    document.getElementById('err-reg-name').textContent = 'Nama minimal 2 karakter.';
    valid = false;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    document.getElementById('err-reg-email').textContent = 'Format email tidak valid.';
    valid = false;
  }
  if (password.length < 6) {
    document.getElementById('err-reg-password').textContent = 'Kata sandi minimal 6 karakter.';
    valid = false;
  }
  if (!valid) return;

  const users = getUsers();
  if (users.some((u) => u.email === email)) {
    document.getElementById('err-reg-email').textContent = 'Email sudah terdaftar.';
    showToast('Registrasi gagal: Email sudah digunakan.', 'error');
    return;
  }

  const newUser = { id: generateId('usr'), name, email, password };
  users.push(newUser);
  saveUsers(users);

  localStorage.setItem(LS_SESSION, JSON.stringify({ id: newUser.id, name: newUser.name, email: newUser.email }));
  e.target.reset();
  showToast('Akun berhasil dibuat! Selamat datang.');
  bootApp();
}

function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim().toLowerCase();
  const password = document.getElementById('login-password').value;

  document.getElementById('err-login-email').textContent = '';
  document.getElementById('err-login-password').textContent = '';

  if (!email) {
    document.getElementById('err-login-email').textContent = 'Email wajib diisi.';
    return;
  }
  if (!password) {
    document.getElementById('err-login-password').textContent = 'Kata sandi wajib diisi.';
    return;
  }

  const users = getUsers();
  const found = users.find((u) => u.email === email && u.password === password);

  if (!found) {
    document.getElementById('err-login-password').textContent = 'Email atau kata sandi salah.';
    showToast('Login gagal! Periksa kembali kredensial Anda.', 'error');
    return;
  }

  localStorage.setItem(LS_SESSION, JSON.stringify({ id: found.id, name: found.name, email: found.email }));
  e.target.reset();
  showToast(`Selamat datang kembali, ${found.name}!`);
  bootApp();
}

function handleLogout() {
  localStorage.removeItem(LS_SESSION);
  state.projects = [];
  state.tasks = [];
  state.activeProjectId = null;
  checkAuthGuard();
  showToast('Anda telah keluar dari sesi.');
}

/* ==================== 6. DATA LOADING & RENDERING ==================== */
async function loadUserData() {
  if (!state.currentUser) return;
  state.projects = await getAllByUser(STORE_PROJECTS, state.currentUser.id);
  state.tasks = await getAllByUser(STORE_TASKS, state.currentUser.id);
}

function renderDashboard() {
  document.getElementById('stat-total-projects').textContent = state.projects.length;
  document.getElementById('stat-todo').textContent = state.tasks.filter((t) => t.status === 'To-do').length;
  document.getElementById('stat-inprogress').textContent = state.tasks.filter((t) => t.status === 'In-Progress').length;
  document.getElementById('stat-done').textContent = state.tasks.filter((t) => t.status === 'Done').length;

  const urgentContainer = document.getElementById('urgent-tasks-list');
  const urgentTasks = state.tasks
    .filter((t) => t.status !== 'Done' && getDaysDiff(t.deadline) <= 3)
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline));

  if (urgentTasks.length === 0) {
    urgentContainer.innerHTML = `<div class="empty-state">🎉 Tidak ada tugas mendesak dalam 3 hari ke depan.</div>`;
    return;
  }

  urgentContainer.innerHTML = urgentTasks
    .map((task) => {
      const proj = state.projects.find((p) => p.id === task.projectId);
      const diff = getDaysDiff(task.deadline);
      const label = diff < 0 ? `Terlewat ${Math.abs(diff)} hari` : diff === 0 ? 'Hari ini!' : `${diff} hari lagi`;

      return `
        <div class="urgent-item">
          <div>
            <strong>${escapeHTML(task.title)}</strong>
            <div class="text-muted">Proyek: ${proj ? escapeHTML(proj.name) : '-'} • Status: ${task.status}</div>
          </div>
          <div>
            <span class="deadline-tag ${diff <= 0 ? 'overdue' : ''}">${formatDate(task.deadline)} (${label})</span>
          </div>
        </div>
      `;
    })
    .join('');
}

function renderProjects() {
  const grid = document.getElementById('projects-grid');

  if (state.projects.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;">Belum ada proyek. Klik <strong>+ Tambah Proyek</strong> untuk memulai.</div>`;
    return;
  }

  grid.innerHTML = state.projects
    .map((proj) => {
      const projTasks = state.tasks.filter((t) => t.projectId === proj.id);
      const doneCount = projTasks.filter((t) => t.status === 'Done').length;
      const percent = projTasks.length === 0 ? 0 : Math.round((doneCount / projTasks.length) * 100);
      const isSelected = state.activeProjectId === proj.id;

      return `
        <div class="project-card ${isSelected ? 'selected' : ''}">
          <div>
            <div class="project-card-top">
              <h4>${escapeHTML(proj.name)}</h4>
              <span class="status-pill">${escapeHTML(proj.status)}</span>
            </div>
            <p class="text-muted">${escapeHTML(proj.description)}</p>
            <div class="progress-wrapper">
              <div class="progress-info">
                <span>Progres Tugas (${doneCount}/${projTasks.length})</span>
                <span>${percent}%</span>
              </div>
              <div class="progress-bar-bg">
                <div class="progress-bar-fill" style="width: ${percent}%"></div>
              </div>
            </div>
            <small class="text-muted">📅 Deadline: ${formatDate(proj.deadline)}</small>
          </div>
          <div class="project-card-actions">
            <button type="button" class="btn btn-primary btn-sm" onclick="openProjectWorkspace('${proj.id}')">Buka Tugas</button>
            <button type="button" class="btn btn-outline btn-sm" onclick="editProject('${proj.id}')">Edit</button>
            <button type="button" class="btn btn-danger btn-sm" onclick="confirmDeleteProject('${proj.id}')">Hapus</button>
          </div>
        </div>
      `;
    })
    .join('');
}

function openProjectWorkspace(projectId) {
  const project = state.projects.find((p) => p.id === projectId);
  if (!project) return;

  state.activeProjectId = projectId;
  document.getElementById('active-project-title').textContent = project.name;
  document.getElementById('active-project-desc').textContent = project.description;
  document.getElementById('task-workspace').classList.remove('hidden');

  renderProjects();
  renderKanbanTasks();
  document.getElementById('task-workspace').scrollIntoView({ behavior: 'smooth' });
}

function renderKanbanTasks() {
  if (!state.activeProjectId) return;

  const searchQuery = document.getElementById('task-search').value.trim().toLowerCase();
  const filterStatus = document.getElementById('task-filter-status').value;
  const filterDeadline = document.getElementById('task-filter-deadline').value;

  let projectTasks = state.tasks.filter((t) => t.projectId === state.activeProjectId);

  // Filter Search
  if (searchQuery) {
    projectTasks = projectTasks.filter(
      (t) => t.title.toLowerCase().includes(searchQuery) || t.description.toLowerCase().includes(searchQuery)
    );
  }

  // Filter Status
  if (filterStatus !== 'ALL') {
    projectTasks = projectTasks.filter((t) => t.status === filterStatus);
  }

  // Filter Deadline
  if (filterDeadline === 'UPCOMING') {
    projectTasks = projectTasks.filter((t) => getDaysDiff(t.deadline) >= 0 && getDaysDiff(t.deadline) <= 3);
  } else if (filterDeadline === 'OVERDUE') {
    projectTasks = projectTasks.filter((t) => getDaysDiff(t.deadline) < 0 && t.status !== 'Done');
  }

  const statuses = ['To-do', 'In-Progress', 'Done'];
  statuses.forEach((status) => {
    const colEl = document.getElementById(`col-${status}`);
    const filtered = projectTasks.filter((t) => t.status === status);

    if (status === 'To-do') document.getElementById('count-todo').textContent = filtered.length;
    if (status === 'In-Progress') document.getElementById('count-inprogress').textContent = filtered.length;
    if (status === 'Done') document.getElementById('count-done').textContent = filtered.length;

    if (filtered.length === 0) {
      colEl.innerHTML = `<div class="empty-state">Tidak ada tugas</div>`;
      return;
    }

    colEl.innerHTML = filtered
      .map((task) => {
        const diff = getDaysDiff(task.deadline);
        const isOverdue = diff < 0 && task.status !== 'Done';

        const attachmentBtn = task.attachment
          ? `<button type="button" class="attachment-link" onclick="downloadAttachment('${task.id}')">
               📎 ${escapeHTML(task.attachment.name)}
             </button>`
          : '';

        return `
          <div class="task-card" draggable="true" data-task-id="${task.id}">
            <h5>${escapeHTML(task.title)}</h5>
            <p>${escapeHTML(task.description)}</p>
            ${attachmentBtn}
            <div class="task-meta">
              <span class="deadline-tag ${isOverdue ? 'overdue' : ''}">
                📅 ${formatDate(task.deadline)}
              </span>
            </div>
            <div class="task-card-footer">
              <select class="quick-status-select" onchange="changeTaskStatus('${task.id}', this.value)" title="Ubah Status">
                <option value="To-do" ${task.status === 'To-do' ? 'selected' : ''}>To-do</option>
                <option value="In-Progress" ${task.status === 'In-Progress' ? 'selected' : ''}>In-Progress</option>
                <option value="Done" ${task.status === 'Done' ? 'selected' : ''}>Done</option>
              </select>
              <div>
                <button type="button" class="btn btn-outline btn-sm" onclick="editTask('${task.id}')">Edit</button>
                <button type="button" class="btn btn-danger btn-sm" onclick="confirmDeleteTask('${task.id}')">Hapus</button>
              </div>
            </div>
          </div>
        `;
      })
      .join('');
  });

  bindDragAndDrop();
}

/* ==================== 7. PROJECT CRUD ==================== */
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

function openNewProjectModal() {
  document.getElementById('project-form').reset();
  document.getElementById('project-id').value = '';
  document.getElementById('modal-project-title').textContent = 'Tambah Proyek Baru';
  clearProjectErrors();
  openModal('modal-project');
}

function clearProjectErrors() {
  document.getElementById('err-project-name').textContent = '';
  document.getElementById('err-project-desc').textContent = '';
  document.getElementById('err-project-deadline').textContent = '';
}

async function handleProjectSubmit(e) {
  e.preventDefault();
  clearProjectErrors();

  const id = document.getElementById('project-id').value;
  const name = document.getElementById('project-name').value.trim();
  const description = document.getElementById('project-desc').value.trim();
  const deadline = document.getElementById('project-deadline').value;
  const status = document.getElementById('project-status').value;

  let valid = true;
  if (!name) {
    document.getElementById('err-project-name').textContent = 'Nama proyek wajib diisi.';
    valid = false;
  }
  if (!description) {
    document.getElementById('err-project-desc').textContent = 'Deskripsi proyek wajib diisi.';
    valid = false;
  }
  if (!deadline) {
    document.getElementById('err-project-deadline').textContent = 'Tanggal deadline wajib dipilih.';
    valid = false;
  }
  if (!valid) return;

  const projectData = {
    id: id || generateId('proj'),
    userId: state.currentUser.id,
    name,
    description,
    deadline,
    status
  };

  await dbAction(STORE_PROJECTS, 'readwrite', (store) => store.put(projectData));
  await loadUserData();
  closeModal('modal-project');
  renderDashboard();
  renderProjects();
  if (state.activeProjectId === projectData.id) {
    document.getElementById('active-project-title').textContent = projectData.name;
    document.getElementById('active-project-desc').textContent = projectData.description;
  }
  showToast(id ? 'Proyek berhasil diperbarui!' : 'Proyek baru berhasil ditambahkan!');
}

window.editProject = function (projectId) {
  const proj = state.projects.find((p) => p.id === projectId);
  if (!proj) return;

  clearProjectErrors();
  document.getElementById('project-id').value = proj.id;
  document.getElementById('project-name').value = proj.name;
  document.getElementById('project-desc').value = proj.description;
  document.getElementById('project-deadline').value = proj.deadline;
  document.getElementById('project-status').value = proj.status;
  document.getElementById('modal-project-title').textContent = 'Edit Proyek';
  openModal('modal-project');
};

window.confirmDeleteProject = function (projectId) {
  const proj = state.projects.find((p) => p.id === projectId);
  if (!proj) return;

  document.getElementById('confirm-title').textContent = 'Hapus Proyek?';
  document.getElementById('confirm-message').textContent =
    `Menghapus proyek "${proj.name}" juga akan menghapus semua tugas di dalamnya secara permanen.`;

  state.confirmCallback = async () => {
    // Cascade delete: hapus semua tugas milik proyek ini
    const relatedTasks = state.tasks.filter((t) => t.projectId === projectId);
    for (const task of relatedTasks) {
      await dbAction(STORE_TASKS, 'readwrite', (store) => store.delete(task.id));
    }
    await dbAction(STORE_PROJECTS, 'readwrite', (store) => store.delete(projectId));

    if (state.activeProjectId === projectId) {
      state.activeProjectId = null;
      document.getElementById('task-workspace').classList.add('hidden');
    }

    await loadUserData();
    renderDashboard();
    renderProjects();
    showToast('Proyek beserta seluruh tugasnya telah dihapus.');
  };

  openModal('modal-confirm');
};

/* ==================== 8. TASK CRUD & ATTACHMENTS ==================== */
function clearTaskErrors() {
  document.getElementById('err-task-title').textContent = '';
  document.getElementById('err-task-desc').textContent = '';
  document.getElementById('err-task-deadline').textContent = '';
  document.getElementById('err-task-attachment').textContent = '';
}

function openNewTaskModal() {
  if (!state.activeProjectId) {
    showToast('Pilih proyek terlebih dahulu.', 'error');
    return;
  }
  document.getElementById('task-form').reset();
  document.getElementById('task-id').value = '';
  document.getElementById('existing-attachment-info').classList.add('hidden');
  document.getElementById('modal-task-title').textContent = 'Tambah Tugas Baru';
  clearTaskErrors();
  openModal('modal-task');
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

async function handleTaskSubmit(e) {
  e.preventDefault();
  clearTaskErrors();

  const id = document.getElementById('task-id').value;
  const title = document.getElementById('task-title').value.trim();
  const description = document.getElementById('task-desc').value.trim();
  const deadline = document.getElementById('task-deadline').value;
  const status = document.getElementById('task-status').value;
  const fileInput = document.getElementById('task-attachment');

  let valid = true;
  if (!title) {
    document.getElementById('err-task-title').textContent = 'Judul tugas wajib diisi.';
    valid = false;
  }
  if (!description) {
    document.getElementById('err-task-desc').textContent = 'Deskripsi tugas wajib diisi.';
    valid = false;
  }
  if (!deadline) {
    document.getElementById('err-task-deadline').textContent = 'Deadline tugas wajib diisi.';
    valid = false;
  }

  let attachmentData = null;
  if (id) {
    const existing = state.tasks.find((t) => t.id === id);
    if (existing && existing.attachment) attachmentData = existing.attachment;
  }

  if (fileInput.files && fileInput.files[0]) {
    const file = fileInput.files[0];
    if (file.size > 5 * 1024 * 1024) {
      document.getElementById('err-task-attachment').textContent = 'Ukuran file maksimal 5MB.';
      valid = false;
    } else {
      const buffer = await readFileAsArrayBuffer(file);
      attachmentData = {
        name: file.name,
        type: file.type,
        size: file.size,
        data: buffer
      };
    }
  }

  if (!valid) return;

  const taskData = {
    id: id || generateId('tsk'),
    userId: state.currentUser.id,
    projectId: state.activeProjectId,
    title,
    description,
    deadline,
    status,
    attachment: attachmentData
  };

  await dbAction(STORE_TASKS, 'readwrite', (store) => store.put(taskData));
  await loadUserData();
  closeModal('modal-task');
  renderDashboard();
  renderProjects();
  renderKanbanTasks();
  showToast(id ? 'Tugas berhasil diperbarui!' : 'Tugas baru berhasil ditambahkan!');
}

window.editTask = function (taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;

  clearTaskErrors();
  document.getElementById('task-form').reset();
  document.getElementById('task-id').value = task.id;
  document.getElementById('task-title').value = task.title;
  document.getElementById('task-desc').value = task.description;
  document.getElementById('task-deadline').value = task.deadline;
  document.getElementById('task-status').value = task.status;

  const attInfo = document.getElementById('existing-attachment-info');
  if (task.attachment) {
    attInfo.textContent = `Lampiran saat ini: ${task.attachment.name} (unggah baru untuk mengganti)`;
    attInfo.classList.remove('hidden');
  } else {
    attInfo.classList.add('hidden');
  }

  document.getElementById('modal-task-title').textContent = 'Edit Tugas';
  openModal('modal-task');
};

window.confirmDeleteTask = function (taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;

  document.getElementById('confirm-title').textContent = 'Hapus Tugas?';
  document.getElementById('confirm-message').textContent = `Apakah Anda yakin ingin menghapus tugas "${task.title}"?`;

  state.confirmCallback = async () => {
    await dbAction(STORE_TASKS, 'readwrite', (store) => store.delete(taskId));
    await loadUserData();
    renderDashboard();
    renderProjects();
    renderKanbanTasks();
    showToast('Tugas berhasil dihapus.');
  };

  openModal('modal-confirm');
};

window.downloadAttachment = function (taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task || !task.attachment) return;

  const blob = new Blob([task.attachment.data], { type: task.attachment.type || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = task.attachment.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

window.changeTaskStatus = async function (taskId, newStatus) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task || task.status === newStatus) return;

  task.status = newStatus;
  await dbAction(STORE_TASKS, 'readwrite', (store) => store.put(task));
  await loadUserData();
  renderDashboard();
  renderProjects();
  renderKanbanTasks();
  showToast(`Status tugas dipindah ke "${newStatus}"`);
};

/* ==================== 9. HTML5 DRAG AND DROP ==================== */
function bindDragAndDrop() {
  const cards = document.querySelectorAll('.task-card');
  const dropzones = document.querySelectorAll('.kanban-dropzone');

  cards.forEach((card) => {
    card.addEventListener('dragstart', (e) => {
      card.classList.add('dragging');
      e.dataTransfer.setData('text/plain', card.dataset.taskId);
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
    });
  });

  dropzones.forEach((zone) => {
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });

    zone.addEventListener('dragleave', () => {
      zone.classList.remove('drag-over');
    });

    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const taskId = e.dataTransfer.getData('text/plain');
      const targetStatus = zone.dataset.status;
      if (taskId && targetStatus) {
        await window.changeTaskStatus(taskId, targetStatus);
      }
    });
  });
}

/* ==================== 10. EXTRA FEATURE: EXPORT JSON BACKUP ==================== */
function exportBackupJSON() {
  const backup = {
    exportedAt: new Date().toISOString(),
    user: state.currentUser,
    projects: state.projects,
    tasks: state.tasks.map(({ attachment, ...rest }) => ({
      ...rest,
      hasAttachment: Boolean(attachment),
      attachmentName: attachment ? attachment.name : null
    }))
  };

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `TaskFlow_Backup_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Data proyek & tugas berhasil diunduh (JSON).');
}

/* ==================== 11. NAVIGATION & INITIALIZATION ==================== */
function switchPage(pageName) {
  document.querySelectorAll('.nav-link').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.page === pageName);
  });
  document.getElementById('page-dashboard').classList.toggle('hidden', pageName !== 'dashboard');
  document.getElementById('page-projects').classList.toggle('hidden', pageName !== 'projects');
}

async function bootApp() {
  if (!checkAuthGuard()) return;
  await loadUserData();
  renderDashboard();
  renderProjects();
  switchPage('dashboard');
}

document.addEventListener('DOMContentLoaded', async () => {
  // Init Theme
  applyTheme(localStorage.getItem(LS_THEME) || 'light');

  // Init DB
  await initDB();

  // Auth Tabs
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');

  tabLogin.addEventListener('click', () => {
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
    document.getElementById('auth-subtitle').textContent = 'Masuk untuk mengelola proyek dan tugas Anda';
  });

  tabRegister.addEventListener('click', () => {
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    registerForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
    document.getElementById('auth-subtitle').textContent = 'Buat akun baru untuk mulai mencatat tugas';
  });

  loginForm.addEventListener('submit', handleLogin);
  registerForm.addEventListener('submit', handleRegister);
  document.getElementById('btn-logout').addEventListener('click', handleLogout);

  // Theme Toggles
  document.getElementById('theme-toggle-auth').addEventListener('click', toggleTheme);
  document.getElementById('theme-toggle-app').addEventListener('click', toggleTheme);

  // Navigation
  document.querySelectorAll('.nav-link').forEach((btn) => {
    btn.addEventListener('click', () => switchPage(btn.dataset.page));
  });

  // Project & Task Modals
  document.getElementById('btn-add-project').addEventListener('click', openNewProjectModal);
  document.getElementById('btn-quick-project').addEventListener('click', () => {
    switchPage('projects');
    openNewProjectModal();
  });
  document.getElementById('project-form').addEventListener('submit', handleProjectSubmit);

  document.getElementById('btn-add-task').addEventListener('click', openNewTaskModal);
  document.getElementById('task-form').addEventListener('submit', handleTaskSubmit);

  document.getElementById('btn-close-workspace').addEventListener('click', () => {
    state.activeProjectId = null;
    document.getElementById('task-workspace').classList.add('hidden');
    renderProjects();
  });

  // Filters & Search
  document.getElementById('task-search').addEventListener('input', renderKanbanTasks);
  document.getElementById('task-filter-status').addEventListener('change', renderKanbanTasks);
  document.getElementById('task-filter-deadline').addEventListener('change', renderKanbanTasks);

  // Modal Close Buttons
  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });

  // Confirmation Action
  document.getElementById('btn-confirm-yes').addEventListener('click', async () => {
    if (state.confirmCallback) {
      await state.confirmCallback();
      state.confirmCallback = null;
    }
    closeModal('modal-confirm');
  });

  // Export JSON
  document.getElementById('btn-export').addEventListener('click', exportBackupJSON);

  // Start App
  await bootApp();
});