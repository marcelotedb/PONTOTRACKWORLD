// ============================================================
// PontoTrack - Admin Edit Module (admin-edit.js)
// Funcionalidades para editores/admins alterarem registros
// ============================================================

class AdminEditManager {
    constructor(app) {
        this.app = app;
    }

    init() {
        console.log('[AdminEdit] Inicializado');
    }

    async openEditModal(collection, id) {
        const item = await window.ptDB.get(collection, id);
        if (!item) return;

        // Fechar modal de detalhes
        this.app.closeModal('detailsModal');

        // Reutilizar o modal de registro ou criar um novo para edição?
        // Vamos criar um modal simples de edição administrativa no index.html ou injetar via JS.
        // Por simplicidade e robustez, vamos injetar um modal de edição caso não exista.
        this._ensureEditModal();
        
        const modal = document.getElementById('adminEditRecordModal');
        const form = document.getElementById('adminEditRecordForm');
        
        // Preencher form
        form.dataset.collection = collection;
        form.dataset.id = id;
        
        document.getElementById('editRegType').value = item.type || 'entry';
        
        // Converter timestamp para local data e time (evitando problemas de fuso horário ISO)
        const ts = new Date(item.timestamp);
        const year = ts.getFullYear();
        const month = String(ts.getMonth() + 1).padStart(2, '0');
        const day = String(ts.getDate()).padStart(2, '0');
        const hours = String(ts.getHours()).padStart(2, '0');
        const minutes = String(ts.getMinutes()).padStart(2, '0');
        
        document.getElementById('editRegDate').value = `${year}-${month}-${day}`;
        document.getElementById('editRegTime').value = `${hours}:${minutes}`;
        document.getElementById('editRegObs').value = item.observation || '';
        
        modal.classList.add('active');
    }

    async saveEdit(e) {
        e.preventDefault();
        const form = e.target;
        const collection = form.dataset.collection;
        const id = form.dataset.id;
        
        const type = document.getElementById('editRegType').value;
        const dateStr = document.getElementById('editRegDate').value; // YYYY-MM-DD
        const timeStr = document.getElementById('editRegTime').value; // HH:MM
        const observation = document.getElementById('editRegObs').value;
        
        const newTimestamp = new Date(`${dateStr}T${timeStr}:00`);
        const formattedDate = newTimestamp.toLocaleDateString('pt-BR');
        const formattedTime = newTimestamp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

        try {
            const original = await window.ptDB.get(collection, id);
            const updated = {
                ...original,
                type,
                timestamp: newTimestamp.toISOString(),
                date: formattedDate,
                time: formattedTime,
                observation: observation + (observation.includes('(Editado por Admin)') ? '' : ' (Editado por Admin)'),
                updatedAt: new Date().toISOString()
            };

            await window.syncManager.save(collection, id, updated, 'update');
            this.app.showToast('Registro atualizado com sucesso!', 'success');
            this.app.closeModal('adminEditRecordModal');
            
            // Callback para atualizar UI
            if (this.app.onDataChange) {
                this.app.onDataChange(collection);
            }
        } catch (err) {
            console.error(err);
            this.app.showToast('Erro ao atualizar registro', 'error');
        }
    }

    async deleteRecord(collection, id) {
        if (!confirm('Tem certeza que deseja EXCLUIR este registro? Esta ação não pode ser desfeita.')) return;
        
        try {
            await window.syncManager.remove(collection, id);
            this.app.showToast('Registro excluído com sucesso', 'success');
            this.app.closeModal('detailsModal');
            
            if (this.app.onDataChange) {
                this.app.onDataChange(collection);
            }
        } catch (err) {
            console.error(err);
            this.app.showToast('Erro ao excluir registro', 'error');
        }
    }

    _ensureEditModal() {
        if (document.getElementById('adminEditRecordModal')) return;

        const modalHtml = `
            <div class="modal" id="adminEditRecordModal">
                <div class="modal-content" style="max-width:400px;">
                    <div class="modal-header">
                        <h2><i class="fas fa-edit"></i> Editar Registro</h2>
                        <button class="close-btn" onclick="app.closeModal('adminEditRecordModal')">&times;</button>
                    </div>
                    <div class="modal-body">
                        <form id="adminEditRecordForm">
                            <div class="form-group">
                                <label>Tipo de Registro</label>
                                <select id="editRegType" class="no-icon-input">
                                    <option value="entry">Entrada</option>
                                    <option value="break">Pausa</option>
                                    <option value="break_end">Retorno</option>
                                    <option value="lunch">Almoço</option>
                                    <option value="lunch_end">Ret. Almoço</option>
                                    <option value="exit">Saída</option>
                                    <option value="extra_entry">Serviço Extra</option>
                                    <option value="extra_exit">Fim Serviço Extra</option>
                                </select>
                            </div>
                            <div class="form-row">
                                <div class="form-group">
                                    <label>Data</label>
                                    <input type="date" id="editRegDate" class="no-icon-input" required>
                                </div>
                                <div class="form-group">
                                    <label>Hora</label>
                                    <input type="time" id="editRegTime" class="no-icon-input" required>
                                </div>
                            </div>
                            <div class="form-group">
                                <label>Observação Administrativa</label>
                                <textarea id="editRegObs" class="no-icon-input" rows="3" placeholder="Motivo da alteração..."></textarea>
                            </div>
                            <div style="display:flex; gap:10px; margin-top:15px;">
                                <button type="button" class="btn btn-secondary" onclick="app.closeModal('adminEditRecordModal')" style="flex:1;">Cancelar</button>
                                <button type="submit" class="btn btn-primary" style="flex:2;">Salvar Alterações</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        document.getElementById('adminEditRecordForm').onsubmit = (e) => this.saveEdit(e);
    }
}

window.adminEditManager = new AdminEditManager(window.app);
