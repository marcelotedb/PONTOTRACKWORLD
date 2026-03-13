class ReportsManager {
  
  async generateReport(format, filters) {
    const { employeeId, startDate, endDate } = filters;
    let allRecords = await window.ptDB.getAll('records');
    let allEmployees = await window.ptDB.getAll('employees');
    
    let filtered = [...allRecords];
    if (employeeId && employeeId !== 'all') {
      filtered = filtered.filter(r => r.employeeId === employeeId);
    }
    if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      filtered = filtered.filter(r => new Date(r.timestamp) >= start);
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      filtered = filtered.filter(r => new Date(r.timestamp) <= end);
    }
    
    filtered.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    if (format === 'view') {
      return this._renderReport(filtered, allEmployees);
    } else if (format === 'excel') {
      return this._exportExcel(filtered, allEmployees);
    } else if (format === 'pdf') {
      return this._exportPDF(filtered, allEmployees);
    }
  }

  _renderReport(records, employees) {
    if (records.length === 0) return `<div class="empty-state"><i class="fas fa-search"></i><h3>Nenhum registro</h3></div>`;

    const summary = this._processData(records, employees);
    let html = `<div class="report-summary"><div class="report-summary-grid">`;
    
    let totalWorked = 0;
    let totalEmployees = Object.keys(summary).length;
    Object.values(summary).forEach(s => totalWorked += s.totalWorked);

    html += `
      <div><div class="report-summary-value">${totalEmployees}</div><div class="report-summary-label">EQUIPE</div></div>
      <div><div class="report-summary-value">${this._formatMinutes(totalWorked)}</div><div class="report-summary-label">TOTAL HORAS</div></div>
    </div></div><div class="records-list">`;

    records.forEach(r => {
      const emp = employees.find(e => e.id === r.employeeId) || { name: 'Desconhecido' };
      
      // Cores conforme o tipo
      let borderClass = 'border-entry'; 
      if (r.type === 'exit') borderClass = 'border-exit';
      if (r.type === 'break' || r.type === 'lunch' || r.type === 'break_end' || r.type === 'lunch_end') borderClass = 'border-break';

      const typeLabels = {
        entry: 'Entrada',
        exit: 'Saída',
        break: 'Pausa',
        break_end: 'Retorno',
        lunch: 'Almoço',
        lunch_end: 'Ret. Almoço'
      };

      const observationHtml = r.observation ? `<div class="record-obs"><i class="fas fa-comment-dots"></i> ${r.observation}</div>` : '';
      const locationHtml = r.lat ? `<div class="record-location-small"><i class="fas fa-map-marker-alt"></i> ${parseFloat(r.lat).toFixed(4)}, ${parseFloat(r.lng).toFixed(4)}</div>` : '';

      html += `
        <div class="record-item ${borderClass}" style="flex-wrap: wrap; cursor: pointer;" onclick="window.app.viewRecordDetails('records', '${r.id}')">
          <div style="display:flex; width: 100%; justify-content: space-between; align-items:center;">
            <div class="record-info">
              <div class="record-details">
                <h4 style="margin-bottom:4px;">${emp.name}</h4>
                <div style="font-size:12px; font-weight:600; color:var(--text-secondary);">
                  ${typeLabels[r.type] || r.type.toUpperCase()}
                </div>
                ${locationHtml}
              </div>
            </div>
            <div class="record-time" style="text-align:right;">
              <div class="time" style="font-size:15px;">${r.time}</div>
              <div class="date" style="font-size:11px;">${r.date}</div>
            </div>
          </div>
          ${observationHtml}
        </div>`;
    });

    return html + '</div>';
  }

  _processData(records, employees) {
    const data = {};
    records.forEach(r => {
      if (!data[r.employeeId]) {
        const emp = employees.find(e => e.id === r.employeeId) || { name: 'Desconhecido', role: '' };
        data[r.employeeId] = {
          info: emp,
          days: {},
          totalWorked: 0,
          totalOvertime: 0,
          totalOvertimeValue: 0,
          daysWorked: 0
        };
      }
      if (!data[r.employeeId].days[r.date]) data[r.employeeId].days[r.date] = [];
      data[r.employeeId].days[r.date].push(r);
    });

    const result = {};
    Object.entries(data).forEach(([empId, empData]) => {
      let accumulatedOvertimeMin = 0;

      const dayStats = Object.entries(empData.days).map(([date, dayRecs]) => {
        const stats = this._calculateDayStats(dayRecs, empData.info);
        empData.totalWorked += stats.worked;
        empData.daysWorked++;
        
        // Calcula o saldo contínuo (banco de horas)
        accumulatedOvertimeMin += stats.netOvertime;
        if (accumulatedOvertimeMin < 0) {
          accumulatedOvertimeMin = 0; // Não existe hora extra negativa acumulada
        }
        
        // Se as horas foram faltantes (negativas), zera as extras diárias para fins visuais no dia
        return {
          ...stats,
          overtime: stats.netOvertime > 0 ? stats.netOvertime : 0 // Para a tabela diária, só exibe as extras positivas
        };
      });

      // Se o saldo total do período for negativo, a empresa não "cobra", fica zerado
      empData.totalOvertime = Math.max(0, accumulatedOvertimeMin);
      
      // Calcula o valor financeiro do mês apenas com base no saldo final positivo
      empData.totalOvertimeValue = this._calculateMonthlyOvertimeValue(empData.totalOvertime, empData.info);

      result[empId] = { ...empData, processedDays: dayStats.sort((a,b) => this._parseDate(a.date) - this._parseDate(b.date)) };
    });
    return result;
  }

  _calculateDayStats(dayRecords, empInfo) {
    const sorted = [...dayRecords].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    let workedMin = 0;
    let entryTime = null;

    for (const r of sorted) {
      if (r.type === 'entry' || r.type === 'extra_entry') {
        if (!entryTime) entryTime = new Date(r.timestamp);
      } else if ((r.type === 'break' || r.type === 'lunch') && entryTime) {
        workedMin += Math.max(0, Math.floor((new Date(r.timestamp) - entryTime) / 60000));
        entryTime = null;
      } else if ((r.type === 'break_end' || r.type === 'lunch_end') && !entryTime) {
        entryTime = new Date(r.timestamp);
      } else if ((r.type === 'exit' || r.type === 'extra_exit') && entryTime) {
        workedMin += Math.max(0, Math.floor((new Date(r.timestamp) - entryTime) / 60000));
        entryTime = null;
      }
    }

    const entry = dayRecords.find(r => r.type === 'entry');
    const exit = dayRecords.find(r => r.type === 'exit');
    const lunchOut = dayRecords.find(r => r.type === 'lunch' || r.type === 'break');
    const lunchIn = dayRecords.find(r => r.type === 'lunch_end' || r.type === 'break_end');
    const extraEntry = dayRecords.find(r => r.type === 'extra_entry');
    const extraExit = dayRecords.find(r => r.type === 'extra_exit');

    const dateStr = dayRecords[0].date;
    const dateObj = this._parseDate(dateStr);
    const dayOfWeekStr = this._getWeekdayName(dateStr);
    const dayIndex = dateObj.getDay(); // 0=Domingo, 6=Sábado

    const empName = (empInfo?.name || '').toLowerCase();
    const isSpecialEmp = empName.includes('raimundo') || empName.includes('joao adelmo') || empName.includes('joão adelmo');
    
    let expectedMin = 8 * 60; // 8h default nos dias uteis
    
    if (isSpecialEmp) {
      if (dayIndex === 6 || dayIndex === 0) {
        expectedMin = 0;
      }
    } else {
      if (dayIndex === 0) { // Domingo
        expectedMin = 0;
      } else if (dayIndex === 6) { // Sábado: Regra das 4h
        expectedMin = 4 * 60;
      }
    }

    const netOvertime = workedMin - expectedMin;
    const overtimeMin = Math.max(0, netOvertime);

    let overtimeValue = 0;
    if (overtimeMin > 0) {
      overtimeValue = this._calculateHourlyRate(overtimeMin, dayIndex, isSpecialEmp, empInfo);
    }

    // Notas: inclui observações de todos os registros
    let notes = dayRecords.map(r => r.observation).filter(Boolean).join('; ');
    if (extraEntry) notes = `[Serviço Extra] ${notes}`;

    return {
      date: dateStr,
      dayOfWeek: dayOfWeekStr,
      entry: entry ? entry.time : (extraEntry ? `Extra: ${extraEntry.time}` : '--:--'),
      lunchOut: lunchOut ? lunchOut.time : '--:--',
      lunchIn: lunchIn ? lunchIn.time : '--:--',
      exit: exit ? exit.time : (extraExit ? `Extra: ${extraExit.time}` : '--:--'),
      worked: workedMin,
      overtime: overtimeMin,
      netOvertime: netOvertime,
      overtimeValue: overtimeValue,
      notes: notes
    };
  }

  _calculateHourlyRate(minutes, dayIndex, isSpecialEmp, empInfo) {
    if (minutes <= 0) return 0;
    const hours = minutes / 60;
    if (isSpecialEmp) {
      return hours * 50.00;
    } else {
      const salary = parseFloat(empInfo?.salary) || 1412.00;
      const baseHourValue = salary / 220;
      const multiplier = (dayIndex === 0) ? 2.0 : 1.5;
      return hours * (baseHourValue * multiplier);
    }
  }

  _calculateMonthlyOvertimeValue(totalOvertimeMin, empInfo) {
    if (totalOvertimeMin <= 0) return 0;
    const empName = (empInfo?.name || '').toLowerCase();
    const isSpecialEmp = empName.includes('raimundo') || empName.includes('joao adelmo') || empName.includes('joão adelmo');
    
    // Simplificando o cálculo mensal baseado numa média semanal (para ter um valor próximo caso os dias não estejam detalhados)
    // No cenário ideal, o desconto financeiro deveria rastrear exatamente o dia da falta para descontar o dia exato (Domingo vs Dia util)
    // Aqui usaremos O multiplicador de dia útil como base para o saldo restante:
    return this._calculateHourlyRate(totalOvertimeMin, 1, isSpecialEmp, empInfo);
  }

  _getWeekdayName(dateStr) {
    try {
      const [d, m, y] = dateStr.split('/');
      return new Date(y, m-1, d).toLocaleDateString('pt-BR', { weekday: 'long' });
    } catch { return ''; }
  }

  _parseDate(dateStr) {
    const [d, m, y] = dateStr.split('/');
    return new Date(y, m-1, d);
  }

  _formatMinutes(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  _exportExcel(records, employees) {
    if (typeof XLSX === 'undefined') return;
    const summary = this._processData(records, employees);
    const wb = XLSX.utils.book_new();

    Object.values(summary).forEach(emp => {
      const rows = emp.processedDays.map(d => ({
        'Data': d.date,
        'Dia da Semana': d.dayOfWeek,
        'Entrada': d.entry,
        'Almoço Saída': d.lunchOut,
        'Almoço Retorno': d.lunchIn,
        'Saída': d.exit,
        'Horas Trabalhadas': this._formatMinutes(d.worked),
        'Horas Extras': this._formatMinutes(d.overtime),
        'Valor Ext (R$)': d.overtimeValue > 0 ? `R$ ${d.overtimeValue.toFixed(2)}` : 'R$ 0.00',
        'Observações': d.notes
      }));

      // Add summary rows at the end
      rows.push({});
      rows.push({ 'Data': 'RESUMO DO PERÍODO' });
      rows.push({ 'Data': 'Dias Trabalhados', 'Dia da Semana': emp.daysWorked });
      rows.push({ 'Data': 'Total Horas', 'Dia da Semana': this._formatMinutes(emp.totalWorked) });
      rows.push({ 'Data': 'Total Extras', 'Dia da Semana': this._formatMinutes(emp.totalOvertime) });
      rows.push({ 'Data': 'Total Valor Extra', 'Dia da Semana': `R$ ${emp.totalOvertimeValue.toFixed(2)}` });
      rows.push({ 'Data': 'Média Diária', 'Dia da Semana': this._formatMinutes(emp.daysWorked ? Math.round(emp.totalWorked / emp.daysWorked) : 0) });

      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, emp.info.name.substring(0, 30));
    });

    XLSX.writeFile(wb, `pontotrack_relatorio_${Date.now()}.xlsx`);
  }

  _exportPDF(records, employees) {
    if (typeof jspdf === 'undefined' && typeof window.jspdf === 'undefined') return;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('l', 'mm', 'a4'); // Landscape
    const summary = this._processData(records, employees);

    Object.values(summary).forEach((emp, index) => {
      if (index > 0) doc.addPage();
      
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, 297, 20, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14);
      doc.text(`CARTÃO DE PONTO: ${emp.info.name.toUpperCase()}`, 10, 13);
      
      doc.setTextColor(50);
      doc.setFontSize(10);
      let y = 30;
      
      // Table Header
      const col = [10, 35, 65, 85, 105, 125, 145, 170, 195, 230];
      doc.setFont('helvetica', 'bold');
      const headers = ['Data', 'Dia', 'In', 'Break', 'Back', 'Out', 'Trib.', 'Extra', 'Valor Ext', 'Notas'];
      headers.forEach((h, i) => doc.text(h, col[i], y));
      
      doc.line(10, y + 2, 287, y + 2);
      y += 8;
      doc.setFont('helvetica', 'normal');

      emp.processedDays.forEach(d => {
        if (y > 180) { doc.addPage(); y = 20; }
        doc.text(d.date, col[0], y);
        doc.text(d.dayOfWeek.substring(0,3), col[1], y);
        doc.text(d.entry, col[2], y);
        doc.text(d.lunchOut, col[3], y);
        doc.text(d.lunchIn, col[4], y);
        doc.text(d.exit, col[5], y);
        doc.text(this._formatMinutes(d.worked), col[6], y);
        doc.text(this._formatMinutes(d.overtime), col[7], y);
        doc.text(d.overtimeValue > 0 ? `R$${d.overtimeValue.toFixed(2)}` : 'R$0.00', col[8], y);
        doc.text(d.notes.substring(0, 25), col[9], y);
        y += 7;
      });

      y += 10;
      doc.setFillColor(241, 245, 249);
      doc.rect(10, y, 277, 25, 'F');
      doc.setFont('helvetica', 'bold');
      doc.text(`Dias Trab: ${emp.daysWorked}`, 15, y + 10);
      doc.text(`Horas: ${this._formatMinutes(emp.totalWorked)}`, 60, y + 10);
      doc.text(`Extras: ${this._formatMinutes(emp.totalOvertime)}`, 105, y + 10);
      doc.text(`Valor Extra: R$ ${emp.totalOvertimeValue.toFixed(2)}`, 150, y + 10);
      doc.text(`Média Diária: ${this._formatMinutes(emp.daysWorked ? Math.round(emp.totalWorked / emp.daysWorked) : 0)}`, 220, y + 10);
    });

    doc.save(`pontotrack_relatorio_${Date.now()}.pdf`);
  }
}

window.reportsManager = new ReportsManager();
