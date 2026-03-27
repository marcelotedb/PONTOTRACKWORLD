// ============================================================
// PontoTrack - Main Application (app.js)
// Módulo principal que orquestra todos os componentes
// ============================================================

class PontoTrackApp {
  constructor() {
    this.currentUser = null;
    this.workTimer = null;
    this.workStartTime = null;
    this.clockInterval = null;
    this.stream = null;
    this.currentRegistration = null;
    this.isOnBreak = false;
    this.employeeToDelete = null;
    this.editingEmployeeId = null;
    this.settings = {
      workHours: 8, tolerance: 10, startTime: '07:30',
      endTime: '17:30', geolocation: true, requirePhoto: false,
      notifications: 'all', syncOnWifiOnly: false
    };
    this.mapInitialized = false;
    this.sedeCoords = { lat: -6.4111, lng: -48.5361 }; // Sede: Rua 7 de Setembro, 390, Xambioá - TO
  }

  // ==================== INITIALIZATION ====================
  async init() {
    console.log('[App] Inicializando PontoTrack...');
    
    try {
      // Register Service Worker
      this._registerSW();

      // Wait for DB
      await window.ptDB.ready();

      // Load settings
      const savedSettings = await window.ptDB.getSetting('config');
      if (savedSettings) this.settings = { ...this.settings, ...savedSettings };

      // Init Firebase
      let firestore = null;
      try {
        const firebaseConfig = {
          apiKey: "AIzaSyCcvGD1bmtXvl6oh5Pc52pgbI3Ys55t3SU",
          authDomain: "pontotrack-9b76e.firebaseapp.com",
          projectId: "pontotrack-9b76e",
          storageBucket: "pontotrack-9b76e.firebasestorage.app",
          messagingSenderId: "1057340735425",
          appId: "1:1057340735425:web:3c4fe68caa09a9c0e5f940"
        };
        firebase.initializeApp(firebaseConfig);
        firestore = firebase.firestore();
        firestore.enablePersistence({ synchronizeTabs: true }).catch(() => { });
        console.log('[App] Firebase inicializado');
      } catch (e) {
        console.warn('[App] Firebase não disponível:', e.message);
      }

      // Init Sync
      await window.syncManager.init(firestore);

      // Inicia o AdminEditManager e vincula ao app
      if (window.adminEditManager) {
        window.adminEditManager.app = this;
        console.log('[App] AdminEditManager vinculado');
      }

      // Check saved session
      const savedSession = localStorage.getItem('pontotrack_session');
      if (savedSession) {
        try {
          this.currentUser = JSON.parse(savedSession);
          if (this.currentUser.type === 'admin') {
            await this._showAdminPanel();
          } else {
            await this._showEmployeeApp();
          }
        } catch (e) { 
          console.error('[App] Erro na sessão salva:', e);
          localStorage.removeItem('pontotrack_session'); 
        }
      }

    // Set default dates for reports and services
    const nowISO = new Date();
    const todayISO = nowISO.toISOString().split('T')[0];
    const currentMonth = nowISO.toISOString().substring(0, 7); // YYYY-MM
    
    const dateInputs = ['reportStartDate', 'reportEndDate'];
    dateInputs.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = todayISO;
    });

    if (document.getElementById('serviceAdminMonth')) {
      document.getElementById('serviceAdminMonth').value = currentMonth;
    }

    // Start clock
    this._startClock();
    
    // Start Notification Reminders
    this._startReminders();

    // Permissions
    window.notifManager?.requestPermission();

    } catch (error) {
      console.error('[App] Erro fatal na inicialização:', error);
    } finally {
      // GARANTE que a tela de loading suma mesmo se houver erro
      setTimeout(() => {
        const loading = document.getElementById('loadingScreen');
        if (loading) loading.classList.add('hidden');
        console.log('[App] Inicialização finalizada (Loading removido)');
      }, 1000);
    }
  }

  _registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js')
        .then(reg => console.log('[SW] Registrado:', reg.scope))
        .catch(err => console.warn('[SW] Falha:', err));
    }
  }

  // ==================== CLOCK ====================
  _startClock() {
    this._updateClock();
    this.clockInterval = setInterval(() => this._updateClock(), 1000);
  }

  _updateClock() {
    const now = new Date();
    const timeEl = document.getElementById('currentTime');
    const dateEl = document.getElementById('currentDate');

    if (timeEl) {
      timeEl.textContent = now.toLocaleTimeString('pt-BR', {
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    }
    if (dateEl) {
      dateEl.textContent = now.toLocaleDateString('pt-BR', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      });
    }

    if (this.workStartTime) this._updateWorkTimer();
  }

  _updateWorkTimer() {
    const now = new Date();
    const diff = now - this.workStartTime;
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);

    const timerEl = document.getElementById('timerDisplay');
    if (timerEl) {
      timerEl.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
  }

  // ==================== AUTH ====================
  switchLoginTab(type, element) {
    document.querySelectorAll('.login-tab').forEach(t => t.classList.remove('active'));
    element.classList.add('active');

    const empFields = document.getElementById('employeeFields');
    const admFields = document.getElementById('adminFields');
    const loginId = document.getElementById('loginId');
    const loginPw = document.getElementById('loginPassword');
    const admEmail = document.getElementById('adminEmail');
    const admPw = document.getElementById('adminPassword');

    if (type === 'employee') {
      empFields.style.display = 'block';
      admFields.style.display = 'none';
      loginId.required = true; loginPw.required = true;
      admEmail.removeAttribute('required'); admPw.removeAttribute('required');
      admEmail.value = ''; admPw.value = '';
    } else {
      empFields.style.display = 'none';
      admFields.style.display = 'block';
      loginId.removeAttribute('required'); loginPw.removeAttribute('required');
      admEmail.required = true; admPw.required = true;
      loginId.value = ''; loginPw.value = '';
    }
  }

  async handleLogin(e) {
    e.preventDefault();
    const btn = document.getElementById('loginBtn');
    btn.classList.add('btn-loading');
    btn.disabled = true;

    try {
      const activeTab = document.querySelector('.login-tab.active');
      const isAdmin = activeTab?.dataset.type === 'admin';

      if (isAdmin) {
        const email = document.getElementById('adminEmail').value.trim();
        const password = document.getElementById('adminPassword').value;

        if (email === 'admin' && password === 'admin123') {
          this.currentUser = { type: 'admin', name: 'Administrador', email, id: 'admin' };
          localStorage.setItem('pontotrack_session', JSON.stringify(this.currentUser));
          this._showAdminPanel();
          this.showToast(`Bem-vindo, Administrador!`, 'success');
        } else {
          throw new Error('Credenciais administrativas inválidas');
        }
      } else {
        const id = document.getElementById('loginId').value.trim();
        const password = document.getElementById('loginPassword').value;

        const employees = await window.ptDB.getAll('employees');
        const employee = employees.find(e => e.id === id && e.password === password);

        if (employee) {
          if (employee.status === 'inactive') throw new Error('Conta desativada. Contate o administrador.');
          this.currentUser = { ...employee, type: 'employee' };
          localStorage.setItem('pontotrack_session', JSON.stringify(this.currentUser));
          this._showEmployeeApp();
          this.showToast(`Bem-vindo, ${employee.name}!`, 'success');
        } else {
          throw new Error('ID ou senha incorretos');
        }
      }
    } catch (error) {
      this.showToast(error.message, 'error');
    } finally {
      btn.classList.remove('btn-loading');
      btn.disabled = false;
    }
  }

  logout() {
    if (!confirm('Deseja realmente sair?')) return;
    if (this.clockInterval) clearInterval(this.clockInterval);
    if (this.workTimer) clearInterval(this.workTimer);
    this._stopCamera();
    window.syncManager.destroy();
    window.geoManager.stopWatching();
    localStorage.removeItem('pontotrack_session');
    location.reload();
  }

  // ==================== SHOW/HIDE VIEWS ====================
  _showEmployeeApp() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('employeeApp').style.display = 'block';
    document.getElementById('adminPanel').style.display = 'none';

    document.getElementById('userName').textContent = this.currentUser.name;
    document.getElementById('userRole').textContent = this.currentUser.role || 'Funcionário';
    document.getElementById('userAvatar').textContent = this._getInitials(this.currentUser.name);

    // Inicializar na aba Home
    this.navigateTo('home');
    
    // Configurar mês padrão para serviços
    const monthInput = document.getElementById('employeeServiceMonth');
    if (monthInput) {
      monthInput.value = new Date().toISOString().substring(0, 7);
    }

    this._updateEmployeeStats();
    this._loadRecentRecords();
    this._getLocation();
    this._checkWorkStatus();
  }

  async _showAdminPanel() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('employeeApp').style.display = 'none';
    document.getElementById('adminPanel').style.display = 'block';

    await this._updateAdminDashboard();
    await this._renderEmployees();
    await this._loadEmployeesToSelect();
    await this._syncServicesFromFirebase(); // Resincronizar serviços do Firebase
    await this.loadAdminServices(); // Carregar serviços inicialmente
    this._loadSettingsUI();

    // Auto-refresh every 60s
    setInterval(async () => {
      if (this.currentUser?.type === 'admin') {
        await this._updateAdminDashboard();
        await this.loadAdminServices();
      }
    }, 60000);
  }

  // ==================== NAVIGATION ====================
  async navigateTo(view, element) {
    if (this.currentUser.type !== 'employee') return;

    // Reset UI
    document.getElementById('homeSection').style.display = 'none';
    document.getElementById('servicesSection').style.display = 'none';
    
    // Update active nav
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    if (element) {
      element.classList.add('active');
    } else {
      document.getElementById(`nav-${view}`)?.classList.add('active');
    }

    if (view === 'home') {
      document.getElementById('homeSection').style.display = 'block';
      this._updateEmployeeStats();
      this._loadRecentRecords();
    } else if (view === 'services') {
      document.getElementById('servicesSection').style.display = 'block';
      // Forçar re-sync do Firebase antes de renderizar
      await this._syncServicesFromFirebase();
      this._renderEmployeeServices();
    } else if (view === 'history') {
      this.viewFullHistory();
      // Keep home as base but show modal
      document.getElementById('homeSection').style.display = 'block';
    } else if (view === 'profile') {
      this.showToast('Perfil em desenvolvimento', 'info');
      document.getElementById('homeSection').style.display = 'block';
    }
  }

  async switchTab(tabId, element) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    element.classList.add('active');

    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`${tabId}Tab`).classList.add('active');

    if (tabId === 'servicesAdmin') {
      await this._syncServicesFromFirebase();
      this.loadAdminServices();
    }
  }

  // ==================== EMPLOYEE FEATURES ====================
  async _getLocation() {
    const position = await window.geoManager.getCurrentPosition();
    window.geoManager.updateLocationUI(position);
  }

  async _checkWorkStatus() {
    const today = new Date().toLocaleDateString('pt-BR');
    const records = await window.ptDB.getRecordsByEmployee(this.currentUser.id);
    const todayRecords = records
      .filter(r => r.date === today)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const last = todayRecords[todayRecords.length - 1]; // Status baseado na última ação

    const btnCheckin = document.getElementById('btnCheckin');
    const btnCheckout = document.getElementById('btnCheckout');
    const btnBreak = document.getElementById('btnBreak');
    const btnLunch = document.getElementById('btnLunch');
    const btnExtra = document.getElementById('btnExtra');
    const timerDisplay = document.getElementById('timerDisplay');

    // IMPROVEMENT 2: Disable/Hide button after first punch
    const entryRecord = todayRecords.find(r => r.type === 'entry');
    const exitRecord = todayRecords.find(r => r.type === 'exit');
    const lunchRecord = todayRecords.find(r => r.type === 'lunch');
    const lunchEndRecord = todayRecords.find(r => r.type === 'lunch_end');
    const breakRecord = todayRecords.find(r => r.type === 'break');
    const breakEndRecord = todayRecords.find(r => r.type === 'break_end');

    // Reset base display
    if (btnCheckin) btnCheckin.style.display = entryRecord ? 'none' : 'flex';
    if (btnCheckout) btnCheckout.style.display = exitRecord ? 'none' : 'flex';
    if (btnBreak) btnBreak.style.display = (breakRecord && breakEndRecord) ? 'none' : 'flex';
    if (btnLunch) btnLunch.style.display = (lunchRecord && lunchEndRecord) ? 'none' : 'flex';
    
    if (btnCheckin) btnCheckin.disabled = !!entryRecord;
    if (btnCheckout) btnCheckout.disabled = !entryRecord || !!exitRecord;
    if (timerDisplay) timerDisplay.classList.remove('active');

    // Extra button logic
    if (btnExtra) {
      if (exitRecord) {
        btnExtra.style.display = 'flex';
        if (last && last.type === 'extra_entry') {
          btnExtra.innerHTML = '<i class="fas fa-stop-circle"></i><span>Finalizar Extra</span>';
          btnExtra.style.backgroundColor = 'var(--danger)';
        } else {
          btnExtra.innerHTML = '<i class="fas fa-tools"></i><span>Serviço Extra</span>';
          btnExtra.style.backgroundColor = 'var(--warning)';
        }
      } else {
        btnExtra.style.display = 'none';
      }
    }

    if (!last) return;

    if (last.type === 'entry' || last.type === 'break_end' || last.type === 'lunch_end' || last.type === 'extra_entry') {
      const baseEntry = entryRecord || last; // Fallback to last if entryRecord not found (unlikely)
      this.workStartTime = new Date(baseEntry.timestamp);
      
      if (btnCheckin) btnCheckin.disabled = true;
      if (btnCheckout) btnCheckout.disabled = !!exitRecord;
      
      if (btnBreak && !breakEndRecord && last.type !== 'extra_entry') {
        btnBreak.style.display = 'flex';
        btnBreak.innerHTML = '<i class="fas fa-coffee"></i><span>Pausa</span>';
      }
      if (btnLunch && !lunchEndRecord && last.type !== 'extra_entry') {
        btnLunch.style.display = 'flex';
        btnLunch.innerHTML = '<i class="fas fa-utensils"></i><span>Almoço</span>';
      }
      
      if (timerDisplay) timerDisplay.classList.add('active');
      this.isOnBreak = false;
    } else if (last.type === 'break') {
      this.workStartTime = new Date(entryRecord.timestamp);
      if (btnCheckin) btnCheckin.disabled = true;
      if (btnCheckout) btnCheckout.disabled = !!exitRecord;
      if (btnBreak) {
        btnBreak.style.display = 'flex';
        btnBreak.innerHTML = '<i class="fas fa-play"></i><span>Retornar</span>';
      }
      if (btnLunch) btnLunch.style.display = 'none';
      if (timerDisplay) timerDisplay.classList.add('active');
      this.isOnBreak = true;
      this.currentBreakType = 'break';
    } else if (last.type === 'lunch') {
      this.workStartTime = new Date(entryRecord.timestamp);
      if (btnCheckin) btnCheckin.disabled = true;
      if (btnCheckout) btnCheckout.disabled = !!exitRecord;
      if (btnBreak) btnBreak.style.display = 'none';
      if (btnLunch) {
        btnLunch.style.display = 'flex';
        btnLunch.innerHTML = '<i class="fas fa-play"></i><span>Voltar</span>';
      }
      if (timerDisplay) timerDisplay.classList.add('active');
      this.isOnBreak = true;
      this.currentBreakType = 'lunch';
    } else if (last.type === 'exit' || last.type === 'extra_exit') {
      this.workStartTime = null;
      if (timerDisplay) {
        timerDisplay.textContent = '00:00:00';
        timerDisplay.classList.remove('active');
      }
      this.isOnBreak = false;
    }
  }

  _startReminders() {
    if (this.reminderInterval) clearInterval(this.reminderInterval);
    
    // Verify every minute
    this.reminderInterval = setInterval(async () => {
      if (!this.currentUser || this.currentUser.type !== 'employee') return;
      if (this.settings.notifications === 'none') return;
      
      const now = new Date();
      const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      
      // Obter configuração de tempo para não repetir a mesma notificação dentro do mesmo minuto
      if (this.lastReminderSent === timeStr) return;
      
      const isStart = timeStr === this.settings.startTime;
      const isEnd = timeStr === this.settings.endTime;
      
      if (isStart || isEnd) {
        this.lastReminderSent = timeStr;
        
        // Verifica se os registros do dia corrente já contemplam isso (para não enviar lembrete se já tiver batido ponto)
        const today = now.toLocaleDateString('pt-BR');
        const records = await window.ptDB.getRecordsByEmployee(this.currentUser.id);
        const todayRecords = records.filter(r => r.date === today);
        
        let shouldRemind = false;
        if (isStart && !todayRecords.some(r => r.type === 'entry')) {
           shouldRemind = true;
        } else if (isEnd && !todayRecords.some(r => r.type === 'exit')) {
           shouldRemind = true;
        }

        if (shouldRemind && window.notifManager) {
          window.notifManager.send(
            'Lembrete de Ponto - PontoTrack', 
            `Atenção! Está na hora do seu ponto de ${isStart ? 'Entrada' : 'Saída'} (${timeStr}). Por favor, registre.`,
            'info'
          );
          
          // Audio feedback if supported
          try {
            if (window.notifManager.alertAudio) {
               window.notifManager.alertAudio.play().catch(e => console.warn(e));
            } else {
               const audio = new Audio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg');
               audio.play().catch(e => console.warn(e));
            }
          } catch(e) {}
        }
      }
    }, 60000); // 1 minuto
  }


  async _updateEmployeeStats() {
    const t = new Date().toLocaleDateString('pt-BR');
    const records = await window.ptDB.getRecordsByEmployee(this.currentUser.id);
    const todayRecs = records.filter(r => r.date === t);

    document.getElementById('todayHours').textContent = this._formatHours(this._calcWorkMinutes(todayRecs));
    document.getElementById('weekHours').textContent = this._formatHours(this._calcPeriodMinutes(records, 7));
    
    // Calcula as horas do mês atual e o esperado até a data de hoje
    const actual = this._calcCurrentMonthMinutes(records);
    document.getElementById('monthHours').textContent = this._formatHours(actual);

    const expected = this._calcExpectedMonthMinutesUntilToday();
    const balance = actual - expected;
    const balEl = document.getElementById('balanceHours');
    balEl.textContent = (balance >= 0 ? '+' : '') + this._formatHours(Math.abs(balance));
    balEl.style.color = balance >= 0 ? 'var(--success)' : 'var(--danger)';
  }

  async _loadRecentRecords() {
    const records = await window.ptDB.getRecordsByEmployee(this.currentUser.id);
    records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    this._renderRecordsList(document.getElementById('recentRecordsList'), records.slice(0, 5));
  }

  _renderRecordsList(container, records) {
    if (!container) return;
    if (records.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-clipboard-list"></i>
          <h3>Nenhum registro ainda</h3>
          <p>Seus registros de ponto aparecerão aqui</p>
        </div>`;
      return;
    }

    const typeConfig = {
      entry: { icon: 'arrow-up', label: 'Entrada', cls: 'entry' },
      exit: { icon: 'arrow-down', label: 'Saída', cls: 'exit' },
      break: { icon: 'coffee', label: 'Pausa', cls: 'break' },
      break_end: { icon: 'play', label: 'Retorno', cls: 'break_end' },
      lunch: { icon: 'utensils', label: 'Almoço', cls: 'break' },
      lunch_end: { icon: 'play', label: 'Ret. Almoço', cls: 'break_end' },
      extra_entry: { icon: 'tools', label: 'Serviço Extra', cls: 'entry' },
      extra_exit: { icon: 'stop-circle', label: 'Fim Extra', cls: 'exit' }
    };

    container.innerHTML = records.map(r => {
      const cfg = typeConfig[r.type] || typeConfig.entry;
      const syncIcon = r.syncStatus === 'synced' ? 'synced' : 'pending';
      const obsHtml = r.observation ? `<div style="font-size:11px;color:var(--text-tertiary);margin-top:4px;"><i class="fas fa-comment-dots"></i> ${r.observation}</div>` : '';
      const isAdmin = this.currentUser?.type === 'admin';
      const actionButtons = isAdmin ? `
        <div class="record-actions" style="display:flex; gap:8px; margin-top:8px; border-top:1px solid var(--border); padding-top:8px;">
          <button class="btn btn-sm btn-primary" style="flex:1; padding:5px; font-size:11px;" onclick="event.stopPropagation(); window.adminEditManager.openEditModal('records', '${r.id}')">
            <i class="fas fa-edit"></i> Editar
          </button>
          <button class="btn btn-sm btn-danger" style="width:32px; padding:5px; font-size:11px;" onclick="event.stopPropagation(); window.adminEditManager.deleteRecord('records', '${r.id}')">
            <i class="fas fa-trash-alt"></i>
          </button>
        </div>` : '';

      return `
        <div class="record-item" style="flex-wrap: wrap; cursor: pointer;" onclick="app.viewRecordDetails('records', '${r.id}')">
          <div style="display:flex; width: 100%; justify-content: space-between;">
            <div class="record-info">
              <div class="record-type-icon ${cfg.cls}">
                <i class="fas fa-${cfg.icon}"></i>
              </div>
              <div class="record-details">
                <h4>${cfg.label} <span class="sync-badge ${syncIcon}"></span></h4>
                <p><i class="fas fa-map-marker-alt"></i> ${r.lat ? `${parseFloat(r.lat).toFixed(4)}, ${parseFloat(r.lng).toFixed(4)}` : 'Sem GPS'}</p>
              </div>
            </div>
            <div class="record-time">
              <div class="time">${r.time}</div>
              <div class="date">${r.date}</div>
            </div>
          </div>
          ${obsHtml}
          ${actionButtons}
        </div>`;
    }).join('');
  }

  // ==================== REGISTRATION ====================
  startRegistration(type) {
    this.currentRegistration = { type };

    const typeNames = { 
      entry: 'entrada', 
      exit: 'saída', 
      break: 'pausa', 
      break_end: 'retorno', 
      lunch: 'almoço', 
      lunch_end: 'retorno do almoço',
      extra_entry: 'início de serviço extra',
      extra_exit: 'fim de serviço extra'
    };
    document.getElementById('regTypeText').textContent = typeNames[type] || 'ponto';
    document.getElementById('registrationModal').classList.add('active');

    // Reset UI
    document.getElementById('registrationStep1').style.display = 'block';
    document.getElementById('registrationStep2').style.display = 'none';
    document.getElementById('capturedPhoto').style.display = 'none';
    if(document.getElementById('regObservation')) document.getElementById('regObservation').value = '';

    if (this.settings.requirePhoto) {
      document.getElementById('cameraContainer').style.display = 'block';
      document.getElementById('skipPhoto').checked = false;
      this._initCamera();
    } else {
      document.getElementById('cameraContainer').style.display = 'none';
      document.getElementById('skipPhoto').checked = true;
    }
  }

  toggleBreak() {
    this.startRegistration(this.isOnBreak ? 'break_end' : 'break');
  }

  toggleLunch() {
    this.startRegistration(this.isOnBreak ? 'lunch_end' : 'lunch');
  }

  async toggleExtraService() {
    const today = new Date().toLocaleDateString('pt-BR');
    const records = await window.ptDB.getRecordsByEmployee(this.currentUser.id);
    const todayRecords = records.filter(r => r.date === today).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const last = todayRecords[todayRecords.length - 1];

    if (last && last.type === 'extra_entry') {
      this.startRegistration('extra_exit');
    } else {
      this.startRegistration('extra_entry');
    }
  }

  async _initCamera() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 } },
        audio: false
      });
      document.getElementById('videoElement').srcObject = this.stream;
    } catch {
      document.getElementById('cameraContainer').style.display = 'none';
      document.getElementById('skipPhoto').checked = true;
    }
  }

  toggleCamera() {
    const skip = document.getElementById('skipPhoto').checked;
    document.getElementById('cameraContainer').style.display = skip ? 'none' : 'block';
    if (!skip && !this.stream) this._initCamera();
  }

  capturePhoto() {
    const video = document.getElementById('videoElement');
    const canvas = document.getElementById('canvasElement');
    const ctx = canvas.getContext('2d');

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    const imageData = canvas.toDataURL('image/jpeg', 0.5);
    document.getElementById('photoPreview').src = imageData;
    document.getElementById('cameraContainer').style.display = 'none';
    document.getElementById('capturedPhoto').style.display = 'block';

    this.currentRegistration.photo = imageData;
    this._stopCamera();
  }

  retakePhoto() {
    document.getElementById('cameraContainer').style.display = 'block';
    document.getElementById('capturedPhoto').style.display = 'none';
    this._initCamera();
  }

  _stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
  }

  async confirmRegistration() {
    const btnConfirm = document.querySelector('#registrationModal .btn-primary');
    if (this.isSavingRegistration) return; // Prevent double clicks
    this.isSavingRegistration = true;
    if (btnConfirm) btnConfirm.disabled = true;

    const locEl = document.getElementById('locationInfo');
    const now = new Date();
    const today = now.toLocaleDateString('pt-BR');

    // Get fresh location
    const position = await window.geoManager.getCurrentPosition();

    // IMPROVEMENT 1: Keep only the most recent record (no duplicates)
    // Check if a record of the same type already exists for today
    const existingRecords = await window.ptDB.getRecordsByEmployeeAndDate(this.currentUser.id, today);
    const duplicate = existingRecords.find(r => r.type === this.currentRegistration.type);

    const record = {
      id: duplicate ? duplicate.id : `rec_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      employeeId: this.currentUser.id,
      employeeName: this.currentUser.name,
      type: this.currentRegistration.type,
      timestamp: now.toISOString(),
      date: today,
      time: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      lat: position.lat || locEl?.dataset.lat || null,
      lng: position.lng || locEl?.dataset.lng || null,
      accuracy: position.accuracy || null,
      photo: this.currentRegistration.photo || null,
      syncStatus: navigator.onLine ? 'synced' : 'pending',
      observation: document.getElementById('regObservation')?.value.trim() || null,
      obraId: this.currentRegistration.obraId || null,
      createdAt: duplicate ? duplicate.createdAt : now.toISOString(),
      updatedAt: now.toISOString()
    };

    // Check proximity if obra is set
    if (record.lat && record.obraId) {
      const obra = await window.ptDB.get('obras', record.obraId);
      if (obra) {
        const check = window.geoManager.isWithinRadius(
          { lat: record.lat, lng: record.lng }, obra
        );
        if (!check.within) {
          this.showToast(`⚠️ Você está a ${check.distance}m da obra (limite: ${obra.radius}m)`, 'warning');
        }
        record.obraName = obra.name;
      }
    }

    // Save locally + sync
    await window.syncManager.save('records', record.id, record, duplicate ? 'update' : 'create');

    // Update UI
    document.getElementById('registrationStep1').style.display = 'none';
    document.getElementById('registrationStep2').style.display = 'block';

    // Update state and refresh UI
    await this._checkWorkStatus();
    await this._updateEmployeeStats();
    await this._loadRecentRecords();

    // Notification
    window.notifManager?.send(
      'PontoTrack',
      `${this.currentRegistration.type === 'entry' ? '⬆️ Entrada' :
        this.currentRegistration.type === 'exit' ? '⬇️ Saída' :
          this.currentRegistration.type === 'lunch' ? '🍔 Almoço' :
            this.currentRegistration.type === 'lunch_end' ? '▶️ Retorno' :
          this.currentRegistration.type === 'break' ? '☕ Pausa' : 
          this.currentRegistration.type === 'extra_entry' ? '🛠️ Serviço Extra' :
          this.currentRegistration.type === 'extra_exit' ? '🏁 Fim Extra' : '▶️ Retorno'} registrada às ${record.time}`
    );
    
    this.isSavingRegistration = false;
    if (btnConfirm) btnConfirm.disabled = false;
  }

  closeRegistrationModal() {
    this.isSavingRegistration = false;
    document.getElementById('registrationModal').classList.remove('active');
    this._stopCamera();
  }

  // Clone yesterday's record
  async cloneYesterday() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yDate = yesterday.toLocaleDateString('pt-BR');

    const records = await window.ptDB.getRecordsByEmployee(this.currentUser.id);
    const yRecords = records.filter(r => r.date === yDate && r.type === 'entry');

    if (yRecords.length > 0) {
      this.startRegistration('entry');
      this.showToast('Registro de entrada iniciado (mesmo horário de ontem)', 'info');
    } else {
      this.showToast('Não há registros de ontem para clonar', 'warning');
    }
  }

  // ==================== ADMIN DASHBOARD ====================
  async _updateAdminDashboard() {
    const now = new Date();
    const today = now.toLocaleDateString('pt-BR');
    const employees = await window.ptDB.getAll('employees');
    const records = await window.ptDB.getAll('records');
    const todayRecords = records.filter(r => r.date === today);

    // Online count
    const onlineCount = employees.filter(emp => {
      const empToday = todayRecords
        .filter(r => r.employeeId === emp.id)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      const last = empToday[0];
      return last && (last.type === 'entry' || last.type === 'break_end' || last.type === 'lunch_end');
    }).length;

    document.getElementById('activeNow').textContent = onlineCount;
    const pct = employees.length > 0 ? Math.round((onlineCount / employees.length) * 100) : 0;
    document.getElementById('activeTrend').textContent = pct + '% da equipe';

    document.getElementById('totalEmployees').textContent = employees.length;
    const activeCount = employees.filter(e => e.status === 'active').length;
    document.getElementById('newEmployees').textContent = activeCount + ' ativos';

    // Total hours today
    const empIds = [...new Set(todayRecords.map(r => r.employeeId))];
    let totalMin = 0;
    empIds.forEach(eid => {
      totalMin += this._calcWorkMinutes(todayRecords.filter(r => r.employeeId === eid));
    });
    document.getElementById('todayTotal').textContent = this._formatHours(totalMin);

    // Late count
    const [sH, sM] = this.settings.startTime.split(':').map(Number);
    const tol = this.settings.tolerance || 10;
    const lateCount = employees.filter(emp => {
      const entries = todayRecords.filter(r => r.employeeId === emp.id && r.type === 'entry');
      if (entries.length === 0) return false;
      const first = new Date(entries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))[0].timestamp);
      return (first.getHours() * 60 + first.getMinutes()) > (sH * 60 + sM + tol);
    }).length;
    document.getElementById('lateToday').textContent = lateCount;

    // Live activity - Combined Feed (Punches + Services)
    const services = await window.ptDB.getAll('servicos_campo');
    const combined = [
      ...records.map(r => ({ ...r, feedType: 'point' })),
      ...services.map(s => ({ ...s, feedType: 'service', type: 'service' }))
    ];

    // Filter by today first, then sort
    const todayCombined = combined.filter(item => item.date === today);
    const sortedCombined = todayCombined.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    this._updateLiveActivity(sortedCombined.slice(0, 20), employees);

    // Map
    if (!this.mapInitialized && document.getElementById('adminMap')) {
      try {
        window.geoManager.initMap('adminMap');
        this.mapInitialized = true;
      } catch { }
    }
    if (this.mapInitialized) {
      const obras = await window.ptDB.getAll('obras');
      window.geoManager.addRecordMarkers(todayRecords, employees);
      window.geoManager.addObraCircles(obras);
    }
  }

  _updateLiveActivity(sortedRecords, employees) {
    const list = document.getElementById('liveActivityList');
    if (!list) return;

    if (sortedRecords.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
            <i class="fas fa-satellite-dish"></i>
            <h3>Nenhuma atividade hoje</h3>
            <p>Os registros aparecerão aqui em tempo real</p>
        </div>`;
      return;
    }

    list.innerHTML = sortedRecords.map(r => {
      const emp = employees.find(e => e.id === r.employeeId) || { name: 'Desconhecido', role: '' };
      const isService = r.feedType === 'service';
      
      // Diferenciação visual por cor
      let colorClass = 'entry'; // Green (Entrada / Retornos)
      if (r.type === 'exit') colorClass = 'exit'; // Red (Saída)
      
      // Amarelo/Laranja para Almoço/Pausa (Início e Fim)
      if (r.type === 'break' || r.type === 'lunch' || r.type === 'break_end' || r.type === 'lunch_end') {
        colorClass = 'break'; 
      }
      
      // Azul para Serviços
      if (isService) colorClass = 'info';

      const typeLabels = { 
        entry: 'Entrada', 
        exit: 'Saída', 
        break: 'Pausa', 
        break_end: 'Retorno', 
        lunch: 'Almoço', 
        lunch_end: 'Ret. Almoço',
        service: 'Serviço Externo',
        extra_entry: 'Serviço Extra',
        extra_exit: 'Fim Serviço Extra'
      };

      const icons = {
        entry: 'arrow-up',
        exit: 'arrow-down',
        break: 'coffee',
        lunch: 'utensils',
        service: 'truck-field',
        extra_entry: 'tools',
        extra_exit: 'stop-circle'
      };
      const icon = icons[r.type] || (r.type.includes('end') ? 'play' : 'fingerprint');

      const locText = r.lat ? `<i class="fas fa-map-marker-alt"></i> ${parseFloat(r.lat).toFixed(4)}, ${parseFloat(r.lng).toFixed(4)}` : 'Localização indisponível';
      
      const collection = isService ? 'servicos_campo' : 'records';
      
      return `
        <div class="record-item live-item border-${colorClass}" style="cursor: pointer;" onclick="app.viewRecordDetails('${collection}', '${r.id}')">
          <div class="record-info">
            <div class="record-type-icon ${colorClass}">
              <i class="fas fa-${icon}"></i>
            </div>
            <div class="record-details">
              <h4>${emp.name}</h4>
              <p><strong>${typeLabels[r.type] || r.type}</strong> • ${r.time}</p>
              ${isService ? `<div style="font-size:11px; color:var(--text-secondary); margin: 4px 0;">${r.locationName} | ${r.description.substring(0, 40)}${r.description.length > 40 ? '...' : ''}</div>` : ''}
              <div class="record-location-small">${locText}</div>
              <div class="record-actions" style="display:flex; gap:8px; margin-top:8px; border-top:1px solid var(--border); padding-top:8px;">
                <button class="btn btn-sm btn-primary" style="flex:1; padding:5px; font-size:11px;" onclick="event.stopPropagation(); window.adminEditManager.openEditModal('${collection}', '${r.id}')">
                  <i class="fas fa-edit"></i> Editar
                </button>
                <button class="btn btn-sm btn-danger" style="width:32px; padding:5px; font-size:11px;" onclick="event.stopPropagation(); window.adminEditManager.deleteRecord('${collection}', '${r.id}')">
                  <i class="fas fa-trash-alt"></i>
                </button>
              </div>
            </div>
          </div>
          <div class="record-time">
            <span class="status-badge status-${colorClass}">${r.time}</span>
          </div>
        </div>`;
    }).join('');
  }

  // ==================== EMPLOYEE MANAGEMENT ====================
  async _renderEmployees() {
    const grid = document.getElementById('employeesGrid');
    if (!grid) return;

    const searchTerm = document.getElementById('searchEmployee')?.value.toLowerCase() || '';
    let employees = await window.ptDB.getAll('employees');
    const records = await window.ptDB.getAll('records');
    const today = new Date().toLocaleDateString('pt-BR');

    if (searchTerm) {
      employees = employees.filter(e =>
        e.name.toLowerCase().includes(searchTerm) ||
        e.id.toLowerCase().includes(searchTerm) ||
        (e.role || '').toLowerCase().includes(searchTerm)
      );
    }

    if (employees.length === 0) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><i class="fas fa-users"></i><h3>Nenhum funcionário encontrado</h3><p>Adicione funcionários para começar</p></div>`;
      return;
    }

    grid.innerHTML = employees.map(emp => {
      const empRecs = records.filter(r => r.employeeId === emp.id);
      const todayRecs = empRecs.filter(r => r.date === today);
      const todayMin = this._calcWorkMinutes(todayRecs);
      const lastRec = todayRecs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
      const isOnline = lastRec && (lastRec.type === 'entry' || lastRec.type === 'break_end' || lastRec.type === 'lunch_end');

      return `
        <div class="employee-card">
          <div class="employee-header">
            <div class="employee-status-dot ${isOnline ? 'online' : 'offline'}"></div>
            <div class="employee-main">
              <div class="employee-avatar-large">${this._getInitials(emp.name)}</div>
              <div class="employee-title">
                <h4>${emp.name}</h4>
                <p>${emp.role || 'Funcionário'}</p>
                <span style="font-size:11px;color:var(--text-tertiary);">ID: ${emp.id}</span>
              </div>
            </div>
          </div>
          <div class="employee-body">
            <div class="employee-stats-row">
              <div class="emp-stat-box">
                <div class="emp-stat-value">${this._formatHours(todayMin)}</div>
                <div class="emp-stat-label">Hoje</div>
              </div>
              <div class="emp-stat-box">
                <div class="emp-stat-value">${empRecs.length}</div>
                <div class="emp-stat-label">Registros</div>
              </div>
              <div class="emp-stat-box">
                <div class="emp-stat-value" style="font-size:13px;">${emp.status === 'active' ? '✅ Ativo' : '⛔ Inativo'}</div>
                <div class="emp-stat-label">Status</div>
              </div>
            </div>
            <div class="employee-actions">
              <button class="btn btn-sm btn-secondary" onclick="app.openEditEmployeeModal('${emp.id}')"><i class="fas fa-edit"></i> Editar</button>
              <button class="btn btn-sm btn-danger" onclick="app.openDeleteModal('${emp.id}')"><i class="fas fa-trash-alt"></i></button>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  searchEmployees() { this._renderEmployees(); }

  openAddEmployeeModal() {
    this.editingEmployeeId = null;
    document.getElementById('employeeModalTitle').innerHTML = '<i class="fas fa-user-plus"></i> Novo Funcionário';
    document.getElementById('employeeForm').reset();
    document.getElementById('editEmployeeId').value = '';
    document.getElementById('empId').disabled = false;
    document.getElementById('empPassword').required = true;
    document.getElementById('passwordLabel').textContent = '*';
    document.getElementById('empDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('empStatus').value = 'active';
    const salaryEl = document.getElementById('empSalary');
    if (salaryEl) salaryEl.value = '1412.00';
    document.getElementById('employeeModal').classList.add('active');
  }

  async openEditEmployeeModal(id) {
    const emp = await window.ptDB.get('employees', id);
    if (!emp) return;

    this.editingEmployeeId = id;
    document.getElementById('employeeModalTitle').innerHTML = '<i class="fas fa-user-edit"></i> Editar Funcionário';
    document.getElementById('editEmployeeId').value = id;
    document.getElementById('empName').value = emp.name;
    document.getElementById('empId').value = emp.id;
    document.getElementById('empId').disabled = true;
    document.getElementById('empEmail').value = emp.email || '';
    document.getElementById('empRole').value = emp.role || '';
    document.getElementById('empDept').value = emp.dept || 'Operacional';
    document.getElementById('empPhone').value = emp.phone || '';
    document.getElementById('empDate').value = emp.admissionDate || '';
    document.getElementById('empStatus').value = emp.status || 'active';
    
    const salaryEl = document.getElementById('empSalary');
    if (salaryEl) salaryEl.value = emp.salary || '1412.00';

    document.getElementById('empPassword').value = '';
    document.getElementById('empPassword').required = false;
    document.getElementById('passwordLabel').textContent = '(manter em branco)';
    document.getElementById('employeeModal').classList.add('active');
  }

  async saveEmployee(e) {
    e.preventDefault();

    const id = document.getElementById('empId').value.trim();
    const name = document.getElementById('empName').value.trim();
    const email = document.getElementById('empEmail').value.trim();
    const role = document.getElementById('empRole').value.trim();
    const dept = document.getElementById('empDept').value;
    const phone = document.getElementById('empPhone').value.trim();
    const admissionDate = document.getElementById('empDate').value;
    const status = document.getElementById('empStatus').value;
    const password = document.getElementById('empPassword').value;
    const salary = parseFloat(document.getElementById('empSalary')?.value) || 1412.00;

    if (!name || !id) { this.showToast('Preencha os campos obrigatórios', 'error'); return; }

    if (this.editingEmployeeId) {
      const existing = await window.ptDB.get('employees', this.editingEmployeeId);
      const updated = {
        ...existing, name, email, role, dept, phone, admissionDate, status, salary,
        updatedAt: new Date().toISOString()
      };
      if (password) updated.password = password;
      await window.syncManager.save('employees', this.editingEmployeeId, updated);
      this.showToast('Funcionário atualizado!', 'success');
    } else {
      const exists = await window.ptDB.get('employees', id);
      if (exists) { this.showToast('ID já existe!', 'error'); return; }
      if (!password || password.length < 4) { this.showToast('Defina uma senha (min. 4 caracteres)', 'error'); return; }

      const newEmp = {
        id, name, email, role, dept, phone, admissionDate, status, password, salary,
        createdAt: new Date().toISOString()
      };
      await window.syncManager.save('employees', id, newEmp, 'create');
      this.showToast('Funcionário cadastrado!', 'success');
    }

    this.closeModal('employeeModal');
    await this._renderEmployees();
    await this._loadEmployeesToSelect();
  }

  openDeleteModal(id) {
    window.ptDB.get('employees', id).then(emp => {
      if (!emp) return;
      this.employeeToDelete = id;
      document.getElementById('deleteEmployeeName').textContent = emp.name;
      document.getElementById('deleteModal').classList.add('active');
    });
  }

  async confirmDeleteEmployee() {
    if (!this.employeeToDelete) return;

    await window.syncManager.remove('employees', this.employeeToDelete);

    // Remove associated records
    const records = await window.ptDB.getRecordsByEmployee(this.employeeToDelete);
    for (const r of records) {
      await window.ptDB.delete('records', r.id);
    }

    this.closeModal('deleteModal');
    await this._renderEmployees();
    await this._loadEmployeesToSelect();
    await this._updateAdminDashboard();
    this.showToast('Funcionário excluído', 'success');
    this.employeeToDelete = null;
  }

  async _loadEmployeesToSelect() {
    const selects = [document.getElementById('reportEmployee'), document.getElementById('serviceAdminEmployee')];
    const employees = await window.ptDB.getAll('employees');
    
    selects.forEach(select => {
      if (!select) return;
      select.innerHTML = '<option value="all">Todos os Funcionários</option>' +
        employees.map(e => `<option value="${e.id}">${e.name} (${e.id})</option>`).join('');
    });
  }

  // ==================== REPORTS ====================
  async generateReport(format) {
    const filters = {
      employeeId: document.getElementById('reportEmployee').value,
      startDate: document.getElementById('reportStartDate').value,
      endDate: document.getElementById('reportEndDate').value
    };

    const result = await window.reportsManager.generateReport(format, filters);
    if (format === 'view') {
      document.getElementById('reportResults').innerHTML = result;
    }
  }

  // ==================== SETTINGS ====================
  _loadSettingsUI() {
    document.getElementById('settingWorkHours').value = this.settings.workHours;
    document.getElementById('settingTolerance').value = this.settings.tolerance;
    document.getElementById('settingStartTime').value = this.settings.startTime;
    document.getElementById('settingEndTime').value = this.settings.endTime;
    document.getElementById('settingNotifications').value = this.settings.notifications;
    document.getElementById('settingGeolocation').checked = this.settings.geolocation;
    document.getElementById('settingPhoto').checked = this.settings.requirePhoto;
  }

  async saveSettings() {
    this.settings = {
      workHours: parseFloat(document.getElementById('settingWorkHours').value),
      tolerance: parseInt(document.getElementById('settingTolerance').value),
      startTime: document.getElementById('settingStartTime').value,
      endTime: document.getElementById('settingEndTime').value,
      notifications: document.getElementById('settingNotifications').value,
      geolocation: document.getElementById('settingGeolocation').checked,
      requirePhoto: document.getElementById('settingPhoto').checked
    };

    await window.ptDB.setSetting('config', this.settings);
    await window.syncManager.save('settings', 'config', this.settings);
    this.showToast('Configurações salvas!', 'success');
  }

  async clearAllData() {
    if (!confirm('⚠️ TODOS os dados serão apagados permanentemente! Continuar?')) return;
    if (!confirm('Tem certeza ABSOLUTA? Esta ação NÃO pode ser desfeita.')) return;

    localStorage.clear();
    const stores = ['employees', 'records', 'obras', 'justificativas', 'settings', 'syncQueue'];
    for (const store of stores) {
      await window.ptDB.clear(store).catch(() => { });
    }
    location.reload();
  }

  // ==================== HISTORY ====================
  viewFullHistory() {
    document.getElementById('historyModal').classList.add('active');
    this.loadFullHistory();
  }

  async loadFullHistory() {
    const date = document.getElementById('fullHistoryDate').value;
    const type = document.getElementById('fullHistoryType').value;

    let records = await window.ptDB.getRecordsByEmployee(this.currentUser.id);

    if (date) {
      const filterDate = new Date(date + 'T12:00:00').toLocaleDateString('pt-BR');
      records = records.filter(r => r.date === filterDate);
    }
    if (type !== 'all') {
      records = records.filter(r => r.type === type);
    }

    records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    this._renderRecordsList(document.getElementById('fullHistoryList'), records);
  }

  // ==================== OBRAS ====================
  async openObrasTab() {
    document.getElementById('obrasModal')?.classList.add('active');
    await this._renderObras();
  }

  async _renderObras() {
    const container = document.getElementById('obrasList');
    if (!container) return;

    const obras = await window.ptDB.getAll('obras');

    if (obras.length === 0) {
      container.innerHTML = `<div class="empty-state"><i class="fas fa-hard-hat"></i><h3>Nenhuma obra cadastrada</h3></div>`;
      return;
    }

    const employees = await window.ptDB.getAll('employees');

    container.innerHTML = obras.map(o => `
      <div class="obra-card">
        <div class="obra-header">
          <div>
            <div class="obra-name">${o.name}</div>
            <div class="obra-location"><i class="fas fa-map-pin"></i> ${o.address || 'Sem endereço'}</div>
          </div>
          <span class="status-badge ${o.active ? 'status-active' : 'status-inactive'}">${o.active ? 'Ativa' : 'Inativa'}</span>
        </div>
        <div class="obra-meta">
          <div class="obra-meta-item"><i class="fas fa-bullseye"></i> ${o.radius || 500}m raio</div>
          <div class="obra-meta-item"><i class="fas fa-users"></i> ${(o.employees || []).length} funcionários</div>
        </div>
        <div style="margin-top:12px;display:flex;gap:8px;">
          <button class="btn btn-sm btn-secondary" onclick="app.editObra('${o.id}')"><i class="fas fa-edit"></i> Editar</button>
          <button class="btn btn-sm btn-danger" onclick="app.deleteObra('${o.id}')"><i class="fas fa-trash"></i></button>
        </div>
      </div>
    `).join('');
  }

  async saveObra(e) {
    e.preventDefault();
    const id = document.getElementById('obraId').value || `obra_${Date.now()}`;
    const obra = {
      id,
      name: document.getElementById('obraName').value.trim(),
      address: document.getElementById('obraAddress').value.trim(),
      lat: parseFloat(document.getElementById('obraLat').value) || null,
      lng: parseFloat(document.getElementById('obraLng').value) || null,
      radius: parseInt(document.getElementById('obraRadius').value) || 500,
      active: document.getElementById('obraActive').checked,
      createdAt: new Date().toISOString()
    };

    await window.syncManager.save('obras', id, obra, 'create');
    this.showToast('Obra salva!', 'success');
    this.closeModal('obraFormModal');
    await this._renderObras();
  }

  openAddObraModal() {
    document.getElementById('obraFormModal')?.classList.add('active');
    document.getElementById('obraForm')?.reset();
    document.getElementById('obraId').value = '';
    document.getElementById('obraActive').checked = true;
    document.getElementById('obraRadius').value = 500;
  }

  async getObraLocationForm() {
    const btn = document.querySelector('#obraFormModal .btn-secondary');
    if(btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Obtendo...';
    try {
      const position = await window.geoManager.getCurrentPosition();
      document.getElementById('obraLat').value = position.lat;
      document.getElementById('obraLng').value = position.lng;
      this.showToast('Localização inserida com sucesso!', 'success');
    } catch (e) {
      this.showToast('Não foi possível obter a localização. Ative o GPS.', 'error');
    } finally {
      if(btn) btn.innerHTML = '<i class="fas fa-map-marker-alt"></i> Pegar minha localização atual';
    }
  }

  async editObra(id) {
    const obra = await window.ptDB.get('obras', id);
    if (!obra) return;
    document.getElementById('obraFormModal')?.classList.add('active');
    document.getElementById('obraId').value = obra.id;
    document.getElementById('obraName').value = obra.name;
    document.getElementById('obraAddress').value = obra.address || '';
    document.getElementById('obraLat').value = obra.lat || '';
    document.getElementById('obraLng').value = obra.lng || '';
    document.getElementById('obraRadius').value = obra.radius || 500;
    document.getElementById('obraActive').checked = obra.active !== false;
  }

  async deleteObra(id) {
    if (!confirm('Excluir esta obra?')) return;
    await window.syncManager.remove('obras', id);
    await this._renderObras();
    this.showToast('Obra excluída', 'success');
  }

  // Os métodos switchTab e navigateTo foram consolidados no início da classe para evitar conflitos.

  refreshData() {
    if (this.currentUser?.type === 'employee') {
      this._updateEmployeeStats();
      this._loadRecentRecords();
      this._getLocation();
    } else {
      this._updateAdminDashboard();
      this._renderEmployees();
    }
    this.showToast('Dados atualizados!', 'success');
  }

  closeModal(modalId) {
    document.getElementById(modalId)?.classList.remove('active');
    this._stopCamera();
  }

  // ==================== DATA CHANGE CALLBACK ====================
  onDataChange(collection) {
    if (collection === 'employees' && this.currentUser?.type === 'admin') {
      this._renderEmployees();
      this._loadEmployeesToSelect();
    }
    if (collection === 'records') {
      if (this.currentUser?.type === 'employee') {
        this._updateEmployeeStats();
        this._loadRecentRecords();
      } else if (this.currentUser?.type === 'admin') {
        this._updateAdminDashboard();
      }
    }
    if (collection === 'servicos_campo') {
      if (this.currentUser?.type === 'employee') {
        this._renderEmployeeServices();
      } else if (this.currentUser?.type === 'admin') {
        this._updateAdminDashboard(); // Atualiza feed live
        this.loadAdminServices();    // Atualiza aba de serviços
      }
    }
  }

  // ==================== SYNC SERVICES HELPER ====================
  async _syncServicesFromFirebase() {
    try {
      if (!window.syncManager?.firebaseReady || !window.syncManager?.isOnline) return;
      
      const firestore = window.syncManager.firestore;
      if (!firestore) return;

      const svcSnap = await firestore.collection('servicos_campo')
        .orderBy('timestamp', 'desc')
        .limit(200)
        .get();
      
      const svcs = svcSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      if (svcs.length > 0) {
        await window.ptDB.bulkPut('servicos_campo', svcs);
        console.log(`[App] Re-sincronizados ${svcs.length} serviços do Firebase`);
      }
    } catch (err) {
      console.warn('[App] Erro ao re-sincronizar serviços:', err.message);
      // Continua com dados locais em caso de erro
    }
  }

  // ==================== SERVIÇOS EM CAMPO ====================
  openServiceModal() {
    const now = new Date();
    document.getElementById('svcDate').value = now.toISOString().split('T')[0];
    document.getElementById('svcTime').value = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('svcDescription').value = '';
    document.getElementById('svcLocationName').value = '';
    document.getElementById('svcLat').value = '';
    document.getElementById('svcLng').value = '';
    document.getElementById('svcLocationStatus').innerHTML = '<i class="fas fa-location-dot"></i> Coordenadas não capturadas';
    document.getElementById('serviceModal').classList.add('active');
  }

  async captureServiceLocation() {
    const status = document.getElementById('svcLocationStatus');
    status.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Capturando GPS...';
    
    try {
      const position = await window.geoManager.getCurrentPosition();
      if (position.error) throw new Error(position.error);

      document.getElementById('svcLat').value = position.lat;
      document.getElementById('svcLng').value = position.lng;
      status.innerHTML = `<i class="fas fa-check-circle" style="color:var(--success);"></i> Localização capturada: ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}`;
      this.showToast('Localização GPS capturada!', 'success');
    } catch (e) {
      status.innerHTML = `<i class="fas fa-times-circle" style="color:var(--danger);"></i> Erro: ${e.message}`;
      this.showToast('Erro ao capturar GPS', 'error');
    }
  }

  async saveServiceRecord(e) {
    e.preventDefault();
    if (this.isSavingService) return;
    this.isSavingService = true;
    
    const btn = e.target.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;

    try {
      const description = document.getElementById('svcDescription').value;
      const locationName = document.getElementById('svcLocationName').value;
      const date = document.getElementById('svcDate').value;
      const time = document.getElementById('svcTime').value;
      const lat = document.getElementById('svcLat').value;
      const lng = document.getElementById('svcLng').value;

      const record = {
        id: `svc_${Date.now()}`,
        employeeId: this.currentUser.id,
        employeeName: this.currentUser.name,
        description,
        locationName,
        date: new Date(date + 'T12:00:00').toLocaleDateString('pt-BR'),
        time,
        timestamp: new Date(`${date}T${time}`).toISOString(),
        lat: lat ? parseFloat(lat) : null,
        lng: lng ? parseFloat(lng) : null,
        createdAt: new Date().toISOString()
      };

      await window.syncManager.save('servicos_campo', record.id, record, 'create');
      this.showToast('Serviço registrado com sucesso!', 'success');
      this.closeModal('serviceModal');
      this._renderEmployeeServices();
    } catch (err) {
      this.showToast('Erro ao salvar: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      this.isSavingService = false;
    }
  }

  async _renderEmployeeServices() {
    const list = document.getElementById('employeeServicesList');
    if (!list) return;

    const monthInput = document.getElementById('employeeServiceMonth');
    const monthFilter = monthInput ? monthInput.value : null;

    const all = await window.ptDB.getAll('servicos_campo');
    let myServices = all.filter(s => s.employeeId === this.currentUser.id);

    if (monthFilter) {
      const [year, month] = monthFilter.split('-');
      myServices = myServices.filter(s => {
        const svcDate = new Date(s.timestamp);
        return svcDate.getFullYear() === parseInt(year) && (svcDate.getMonth() + 1) === parseInt(month);
      });
    }

    myServices.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (myServices.length === 0) {
      list.innerHTML = `<div class="empty-state"><i class="fas fa-map-location-dot"></i><h3>Nenhum serviço este mês</h3></div>`;
      return;
    }

    list.innerHTML = myServices.map(s => this._buildServiceCard(s)).join('');
  }

  async loadAdminServices() {
    const list = document.getElementById('adminServicesList');
    const empSelect = document.getElementById('serviceAdminEmployee');
    const monthInput = document.getElementById('serviceAdminMonth');
    
    if (!list || !empSelect || !monthInput) return;

    const employeeId = empSelect.value;
    const monthFilter = monthInput.value; // Formato YYYY-MM

    const all = await window.ptDB.getAll('servicos_campo');
    let filtered = all;

    if (employeeId !== 'all') filtered = filtered.filter(s => s.employeeId === employeeId);
    
    if (monthFilter) {
      const [year, month] = monthFilter.split('-');
      filtered = filtered.filter(s => {
        // Assume s.date é DD/MM/YYYY ou tenta pelo timestamp
        const svcDate = new Date(s.timestamp);
        return svcDate.getFullYear() === parseInt(year) && (svcDate.getMonth() + 1) === parseInt(month);
      });
    }

    filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (filtered.length === 0) {
      list.innerHTML = `<div class="empty-state"><h3>Nenhum registro encontrado</h3></div>`;
      return;
    }

    list.innerHTML = filtered.map(s => this._buildServiceCard(s, true)).join('');
  }

  _buildServiceCard(s, isAdmin = false) {
    let distHtml = '';
    let mapsLink = '';
    
    if (s.lat && s.lng) {
      const dist = GeoManager.calculateDistance(s.lat, s.lng, this.sedeCoords.lat, this.sedeCoords.lng);
      const km = (dist / 1000).toFixed(2);
      distHtml = `<div class="service-dist"><i class="fas fa-route"></i> ${km} km da sede</div>`;
      mapsLink = `<a href="https://www.google.com/maps/dir/${this.sedeCoords.lat},${this.sedeCoords.lng}/${s.lat},${s.lng}" target="_blank" class="btn btn-sm btn-secondary" style="margin-top:10px; width:100%;">
        <i class="fas fa-map"></i> Ver Rota no Maps
      </a>`;
    }

    return `
      <div class="record-item service-card" style="cursor: pointer;" onclick="app.viewRecordDetails('servicos_campo', '${s.id}')">
        <div class="service-header">
          <div class="service-main">
            <h4>${s.locationName}</h4>
            <p>${isAdmin ? `<strong>${s.employeeName}</strong> • ` : ''}${s.date} ${s.time}</p>
          </div>
          ${distHtml}
        </div>
        <div class="service-desc">${s.description}</div>
        ${mapsLink}
      </div>
    `;
  }

  // ==================== CALCULATIONS ====================
  _calcWorkMinutes(records) {
    let minutes = 0;
    const sorted = [...records].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    let entryTime = null;

    for (const r of sorted) {
      if (r.type === 'entry' || r.type === 'extra_entry') {
        entryTime = new Date(r.timestamp);
      } else if ((r.type === 'break' || r.type === 'lunch') && entryTime) {
        minutes += Math.max(0, Math.floor((new Date(r.timestamp) - entryTime) / 60000));
        entryTime = null;
      } else if (r.type === 'break_end' || r.type === 'lunch_end') {
        entryTime = new Date(r.timestamp);
      } else if ((r.type === 'exit' || r.type === 'extra_exit') && entryTime) {
        minutes += Math.max(0, Math.floor((new Date(r.timestamp) - entryTime) / 60000));
        entryTime = null;
      }
    }

    if (entryTime) {
      minutes += Math.max(0, Math.floor((new Date() - entryTime) / 60000));
    }

    return minutes;
  }

  _calcPeriodMinutes(records, days) {
    const cutoff = new Date();
    cutoff.setHours(0,0,0,0);
    cutoff.setDate(cutoff.getDate() - days);
    return this._calcWorkMinutes(records.filter(r => new Date(r.timestamp) >= cutoff));
  }

  _calcCurrentMonthMinutes(records) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    startOfMonth.setHours(0,0,0,0);
    return this._calcWorkMinutes(records.filter(r => new Date(r.timestamp) >= startOfMonth));
  }

  _calcExpectedMonthMinutesUntilToday() {
    let expected = 0;
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    
    for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
      const day = d.getDay();
      if (day >= 1 && day <= 5) expected += 8 * 60; // 8h Segunda a Sexta
      else if (day === 6) expected += 4 * 60; // 4h Sábado
    }
    return expected;
  }

  _formatHours(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h${m}m`;
  }

  _getInitials(name) {
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  }

  // ==================== DETAILS MODAL ====================
  async viewRecordDetails(collection, id) {
    const item = await window.ptDB.get(collection, id);
    if (!item) return;

    const modal = document.getElementById('detailsModal');
    const content = document.getElementById('detailsContent');
    modal.classList.add('active');

    const typeLabels = { 
      entry: 'Entrada', exit: 'Saída', break: 'Pausa', break_end: 'Retorno', 
      lunch: 'Almoço', lunch_end: 'Ret. Almoço', service: 'Serviço Externo',
      extra_entry: 'Serviço Extra', extra_exit: 'Fim Serviço Extra'
    };

    let detailsHtml = `
      <div style="margin-bottom:15px;">
        <h3 style="color:var(--primary-light); margin-bottom:5px;">${typeLabels[item.type] || 'Registro'}</h3>
        <p style="font-size:14px; color:var(--text-secondary);"><i class="fas fa-calendar"></i> ${item.date} às ${item.time}</p>
      </div>
      <div class="detail-info" style="background:var(--bg-secondary); padding:15px; border-radius:10px; border:1px solid var(--border); margin-bottom:15px;">
        <p style="margin-bottom:8px;"><strong>ID Funcionário:</strong> ${item.employeeId}</p>
        <p style="margin-bottom:8px;"><strong>Colaborador:</strong> ${item.employeeName}</p>
        ${item.locationName ? `<p style="margin-bottom:8px;"><strong>Local:</strong> ${item.locationName}</p>` : ''}
        ${item.description ? `<p style="margin-bottom:8px;"><strong>Descrição:</strong> ${item.description}</p>` : ''}
        ${item.observation ? `<p style="margin-bottom:8px;"><strong>Observação:</strong> ${item.observation}</p>` : ''}
        <p style="margin-bottom:0;"><strong>GPS:</strong> ${item.lat ? `${item.lat.toFixed(5)}, ${item.lng.toFixed(5)}` : 'Não disponível'}</p>
      </div>
    `;

    if (item.photo) {
      detailsHtml += `
        <div style="margin-top:15px;">
          <p style="font-size:12px; color:var(--text-tertiary); margin-bottom:5px;">Foto do Registro:</p>
          <img src="${item.photo}" style="width:100%; border-radius:10px; border:1px solid var(--border);">
        </div>
      `;
    }

    content.innerHTML = detailsHtml;

    // Configurar botões Administrativos se for admin
    const editBtn = document.getElementById('adminEditBtn');
    const delBtn = document.getElementById('adminDeleteBtn');
    
    if (this.currentUser?.type === 'admin') {
      if (editBtn) {
        editBtn.style.display = 'flex';
        editBtn.onclick = () => window.adminEditManager.openEditModal(collection, id);
      }
      if (delBtn) {
        delBtn.style.display = 'flex';
        delBtn.onclick = () => window.adminEditManager.deleteRecord(collection, id);
      }
    } else {
      if (editBtn) editBtn.style.display = 'none';
      if (delBtn) delBtn.style.display = 'none';
    }

    // Inicializar mini mapa
    setTimeout(() => {
      if (this.detailsMap) {
        this.detailsMap.remove();
        this.detailsMap = null;
      }

      if (item.lat && item.lng) {
        // Camadas para o mini mapa
        const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
        const googleSatellite = L.tileLayer('http://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
          subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
        });
        const googleHybrid = L.tileLayer('http://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
          subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
        });

        this.detailsMap = L.map('detailsMap', {
          layers: [googleHybrid], // Híbrido como padrão
          zoomControl: true
        }).setView([item.lat, item.lng], 16);

        const baseMaps = {
          "Híbrido": googleHybrid,
          "Satélite": googleSatellite,
          "Rua": osm
        };

        L.control.layers(baseMaps, null, { position: 'topright' }).addTo(this.detailsMap);
        L.marker([item.lat, item.lng]).addTo(this.detailsMap);
      } else {
        document.getElementById('detailsMap').innerHTML = `<div style="display:flex; align-items:center; justify-content:center; height:100%; color:var(--text-tertiary);"><i class="fas fa-map-slash" style="font-size:24px; margin-right:10px;"></i> Mapa não disponível</div>`;
      }
    }, 300);
  }

  // ==================== TOAST ====================
  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = { success: 'check-circle', error: 'exclamation-circle', warning: 'exclamation-triangle', info: 'info-circle' };
    const titles = { success: 'Sucesso!', error: 'Erro!', warning: 'Atenção!', info: 'Informação' };

    toast.innerHTML = `
      <div class="toast-icon"><i class="fas fa-${icons[type]}"></i></div>
      <div class="toast-content">
        <h4>${titles[type]}</h4>
        <p>${message}</p>
      </div>`;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // Stub functions
  requestTimeOff() { this.showToast('Funcionalidade em desenvolvimento', 'info'); }
  openSettings() { this.showToast('Funcionalidade em desenvolvimento', 'info'); }
  showForgotPassword() { this.showToast('Contate o administrador para redefinir sua senha', 'info'); }

  _stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
  }
}

// Initialize
const app = new PontoTrackApp();
window.app = app;

document.addEventListener('DOMContentLoaded', () => app.init());

// Close modals on backdrop click
window.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal')) {
    e.target.classList.remove('active');
    app._stopCamera();
  }
});
