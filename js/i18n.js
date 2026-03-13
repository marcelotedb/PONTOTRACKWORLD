// ============================================================
// PontoTrack - i18n (Internationalization)
// Português (padrão) + Espanhol
// ============================================================

const translations = {
  'pt-BR': {
    app_name: 'PontoTrack',
    app_subtitle: 'Registro de Ponto Inteligente',
    login: 'Entrar no Sistema',
    employee: 'Funcionário',
    admin: 'Administrador',
    employee_id: 'ID do Funcionário',
    password: 'Senha',
    admin_email: 'Email Administrativo',
    forgot_password: 'Esqueceu a senha?',
    
    entry: 'Entrada',
    exit: 'Saída',
    break_start: 'Pausa',
    break_end: 'Retorno',
    
    today_hours: 'Horas Hoje',
    week_hours: 'Esta Semana',
    month_hours: 'Este Mês',
    hour_bank: 'Banco de Horas',
    
    history: 'Histórico',
    vacation: 'Férias',
    settings: 'Config.',
    recent_records: 'Registros Recentes',
    view_all: 'Ver Todos',
    
    // Admin
    admin_panel: 'Painel Administrativo',
    dashboard: 'Dashboard',
    team: 'Equipe',
    reports: 'Relatórios',
    adjustments: 'Ajustes',
    obras: 'Obras',
    online_now: 'Online Agora',
    total_employees: 'Total Funcionários',
    today_total: 'Horas Hoje',
    delays_today: 'Atrasos Hoje',
    live_activity: 'Atividade ao Vivo',
    manage_team: 'Gerenciar Equipe',
    add: 'Adicionar',
    search_employee: 'Buscar funcionário...',
    
    // Reports
    employee_filter: 'Funcionário',
    all_employees: 'Todos os Funcionários',
    start_date: 'Data Início',
    end_date: 'Data Fim',
    export_excel: 'Exportar Excel',
    export_pdf: 'Exportar PDF',
    view_report: 'Visualizar',
    records: 'REGISTROS',
    total_hours: 'TOTAL HORAS',
    employees_label: 'FUNCIONÁRIOS',
    
    // Settings
    system_settings: 'Configurações do Sistema',
    daily_hours: 'Jornada Diária (horas)',
    delay_tolerance: 'Tolerância de Atraso (min)',
    start_time: 'Início do Expediente',
    end_time: 'Fim do Expediente',
    notifications: 'Notificações',
    all_notifications: 'Todas as notificações',
    important_only: 'Apenas importantes',
    disabled: 'Desativadas',
    require_gps: 'Obrigar geolocalização no registro',
    require_photo: 'Exigir foto no registro',
    save_settings: 'Salvar Configurações',
    danger_zone: 'Zona de Perigo',
    clear_all: 'Limpar Todos os Dados',
    
    // Messages
    welcome: 'Bem-vindo',
    logout_confirm: 'Deseja realmente sair?',
    offline_msg: 'Você está offline. Os dados serão sincronizados quando a conexão voltar.',
    connection_restored: 'Conexão restaurada!',
    synced: 'Sincronizado',
    syncing: 'Sincronizando...',
    offline: 'Offline',
    success: 'Sucesso!',
    error: 'Erro!',
    warning: 'Atenção!',
    info: 'Informação',
    confirm_photo: 'Tire uma foto para confirmar seu registro',
    skip_photo: 'Pular foto',
    retake: 'Tirar Outra',
    confirm: 'Confirmar',
    record_confirmed: 'Registro Confirmado!',
    record_success: 'Seu ponto foi registrado com sucesso.',
    done: 'Concluir',
    getting_location: 'Obtendo localização...',
    no_records: 'Nenhum registro encontrado',
    records_appear: 'Seus registros aparecerão aqui',
    loading: 'Carregando...',
    
    // Employee form
    new_employee: 'Novo Funcionário',
    edit_employee: 'Editar Funcionário',
    full_name: 'Nome Completo',
    registration_id: 'ID / Matrícula',
    email: 'Email',
    role: 'Cargo',
    department: 'Departamento',
    phone: 'Telefone',
    admission_date: 'Data de Admissão',
    status: 'Status',
    active: 'Ativo',
    inactive: 'Inativo',
    cancel: 'Cancelar',
    save: 'Salvar',
    
    // Delete
    confirm_delete: 'Confirmar Exclusão',
    delete_employee: 'Excluir Funcionário?',
    about_to_delete: 'Você está prestes a excluir:',
    delete_warning: 'Todos os registros deste funcionário também serão excluídos.',
    delete: 'Excluir',
    
    // Days
    monday: 'Segunda', tuesday: 'Terça', wednesday: 'Quarta',
    thursday: 'Quinta', friday: 'Sexta', saturday: 'Sábado', sunday: 'Domingo',
    
    // Home
    home: 'Início',
    profile: 'Perfil',

    // Obras
    manage_obras: 'Gerenciar Obras/Fazendas',
    new_obra: 'Nova Obra',
    obra_name: 'Nome da Obra/Fazenda',
    obra_address: 'Endereço/Localização',
    obra_radius: 'Raio de Tolerância (metros)',
    obra_employees: 'Funcionários Vinculados',
    obra_active: 'Obra ativa',
    
    // Clone
    same_as_yesterday: 'Mesmo de ontem',
  },

  'es': {
    app_name: 'PontoTrack',
    app_subtitle: 'Registro de Asistencia Inteligente',
    login: 'Iniciar Sesión',
    employee: 'Empleado',
    admin: 'Administrador',
    employee_id: 'ID del Empleado',
    password: 'Contraseña',
    admin_email: 'Email Administrativo',
    forgot_password: '¿Olvidó la contraseña?',
    
    entry: 'Entrada',
    exit: 'Salida',
    break_start: 'Pausa',
    break_end: 'Retorno',
    
    today_hours: 'Horas Hoy',
    week_hours: 'Esta Semana',
    month_hours: 'Este Mes',
    hour_bank: 'Banco de Horas',
    
    history: 'Historial',
    vacation: 'Vacaciones',
    settings: 'Config.',
    recent_records: 'Registros Recientes',
    view_all: 'Ver Todo',
    
    home: 'Inicio',
    profile: 'Perfil',
    loading: 'Cargando...',
    success: '¡Éxito!',
    error: '¡Error!',
    warning: '¡Atención!',
    info: 'Información',
    welcome: 'Bienvenido',
    getting_location: 'Obteniendo ubicación...',
    offline_msg: 'Estás sin conexión. Los datos se sincronizarán cuando vuelva la conexión.',
    
    // Obras
    manage_obras: 'Gestionar Obras/Fincas',
    same_as_yesterday: 'Igual que ayer',
  }
};

class I18n {
  constructor() {
    this.currentLang = localStorage.getItem('pontotrack_lang') || 'pt-BR';
  }

  t(key) {
    return translations[this.currentLang]?.[key] || translations['pt-BR']?.[key] || key;
  }

  setLanguage(lang) {
    if (translations[lang]) {
      this.currentLang = lang;
      localStorage.setItem('pontotrack_lang', lang);
      return true;
    }
    return false;
  }

  getAvailableLanguages() {
    return [
      { code: 'pt-BR', name: 'Português (BR)', flag: '🇧🇷' },
      { code: 'es', name: 'Español', flag: '🇪🇸' }
    ];
  }
}

window.i18n = new I18n();
