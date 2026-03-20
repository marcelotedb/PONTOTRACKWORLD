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
      
      let borderClass = 'border-entry'; 
      if (r.type === 'exit') borderClass = 'border-exit';
      if (r.type === 'break' || r.type === 'lunch' || r.type === 'break_end' || r.type === 'lunch_end') borderClass = 'border-break';

      const typeLabels = {
        entry: 'Entrada', exit: 'Saída', break: 'Pausa',
        break_end: 'Retorno', lunch: 'Almoço', lunch_end: 'Ret. Almoço'
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
        data[r.employeeId] = { info: emp, days: {}, totalWorked: 0, totalOvertime: 0, totalOvertimeValue: 0, daysWorked: 0 };
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
        accumulatedOvertimeMin += stats.netOvertime;
        if (accumulatedOvertimeMin < 0) accumulatedOvertimeMin = 0;
        return { ...stats, overtime: stats.netOvertime > 0 ? stats.netOvertime : 0 };
      });
      empData.totalOvertime = Math.max(0, accumulatedOvertimeMin);
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
    const dayIndex = dateObj.getDay();

    const empName = (empInfo?.name || '').toLowerCase();
    const isSpecialEmp = empName.includes('raimundo') || empName.includes('joao adelmo') || empName.includes('joão adelmo');
    
    let expectedMin = 8 * 60;
    if (isSpecialEmp) {
      if (dayIndex === 6 || dayIndex === 0) expectedMin = 0;
    } else {
      if (dayIndex === 0) expectedMin = 0;
      else if (dayIndex === 6) expectedMin = 4 * 60;
    }

    const netOvertime = workedMin - expectedMin;
    const overtimeMin = Math.max(0, netOvertime);
    let overtimeValue = 0;
    if (overtimeMin > 0) overtimeValue = this._calculateHourlyRate(overtimeMin, dayIndex, isSpecialEmp, empInfo);

    let notes = dayRecords.map(r => r.observation).filter(Boolean).join('; ');
    if (extraEntry) notes = `[Serviço Extra] ${notes}`;

    return {
      date: dateStr, dayOfWeek: dayOfWeekStr,
      entry: entry ? entry.time : (extraEntry ? `Extra: ${extraEntry.time}` : '--:--'),
      lunchOut: lunchOut ? lunchOut.time : '--:--',
      lunchIn: lunchIn ? lunchIn.time : '--:--',
      exit: exit ? exit.time : (extraExit ? `Extra: ${extraExit.time}` : '--:--'),
      worked: workedMin, overtime: overtimeMin, netOvertime, overtimeValue, notes
    };
  }

  _calculateHourlyRate(minutes, dayIndex, isSpecialEmp, empInfo) {
    if (minutes <= 0) return 0;
    const hours = minutes / 60;
    if (isSpecialEmp) return hours * 50.00;
    const salary = parseFloat(empInfo?.salary) || 1412.00;
    const baseHourValue = salary / 220;
    const multiplier = (dayIndex === 0) ? 2.0 : 1.5;
    return hours * (baseHourValue * multiplier);
  }

  _calculateMonthlyOvertimeValue(totalOvertimeMin, empInfo) {
    if (totalOvertimeMin <= 0) return 0;
    const empName = (empInfo?.name || '').toLowerCase();
    const isSpecialEmp = empName.includes('raimundo') || empName.includes('joao adelmo') || empName.includes('joão adelmo');
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

  // ==================== EXCEL PROFISSIONAL ====================

  // Converte string "HH:MM" para valor numérico Excel (fração do dia)
  _timeToExcel(timeStr) {
    if (!timeStr || timeStr === '--:--' || timeStr.includes('Extra')) return null;
    const clean = timeStr.replace('Extra: ', '');
    const parts = clean.split(':');
    if (parts.length < 2) return null;
    const h = parseInt(parts[0]) || 0;
    const m = parseInt(parts[1]) || 0;
    return (h + m / 60) / 24;
  }

  _getBorder() {
    const thin = { style: 'thin', color: { rgb: 'CBD5E1' } };
    return { top: thin, bottom: thin, left: thin, right: thin };
  }

  _exportExcel(records, employees) {
    if (typeof XLSX === 'undefined') return;
    const summary = this._processData(records, employees);
    const wb = XLSX.utils.book_new();

    Object.values(summary).forEach(emp => {
      const ws = {};
      const merge = [];
      const colWidths = [
        { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 12 },
        { wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 16 },
        { wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 30 }
      ];

      const salary = parseFloat(emp.info?.salary) || 1412.00;
      const empName = (emp.info?.name || '').toLowerCase();
      const isSpecialEmp = empName.includes('raimundo') || empName.includes('joao adelmo') || empName.includes('joão adelmo');
      const brd = this._getBorder();

      let row = 0;

      // ── CABEÇALHO ──
      const hdrStyle = { font: { bold: true, sz: 16, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "0F172A" } }, alignment: { horizontal: "center", vertical: "center" } };
      const subStyle = { font: { bold: true, sz: 11, color: { rgb: "CBD5E1" } }, fill: { fgColor: { rgb: "0F172A" } }, alignment: { horizontal: "center", vertical: "center" } };

      ws[XLSX.utils.encode_cell({ r: row, c: 0 })] = { v: "PONTOTRACK - CARTÃO DE PONTO", t: 's', s: hdrStyle };
      merge.push({ s: { r: row, c: 0 }, e: { r: row, c: 11 } });
      row++;
      ws[XLSX.utils.encode_cell({ r: row, c: 0 })] = { v: "Sistema de Controle de Ponto Eletrônico", t: 's', s: subStyle };
      merge.push({ s: { r: row, c: 0 }, e: { r: row, c: 11 } });
      row += 2;

      // ── DADOS DO FUNCIONÁRIO ──
      const lblSt = { font: { bold: true, sz: 11, color: { rgb: "334155" } }, fill: { fgColor: { rgb: "F1F5F9" } }, alignment: { horizontal: "left" }, border: brd };
      const valSt = { font: { sz: 11, color: { rgb: "0F172A" } }, fill: { fgColor: { rgb: "F8FAFC" } }, alignment: { horizontal: "left" }, border: brd };

      const infoData = [
        ['Funcionário:', emp.info.name, 'ID / Matrícula:', emp.info.id],
        ['Cargo:', emp.info.role || 'Não informado', 'Departamento:', emp.info.dept || 'Operacional'],
        ['Salário Base:', 'R$ ' + salary.toFixed(2), 'Valor Hora (base):', 'R$ ' + (salary / 220).toFixed(2)],
      ];
      infoData.forEach(r => {
        ws[XLSX.utils.encode_cell({ r: row, c: 0 })] = { v: r[0], t: 's', s: lblSt };
        ws[XLSX.utils.encode_cell({ r: row, c: 1 })] = { v: r[1], t: 's', s: valSt };
        merge.push({ s: { r: row, c: 1 }, e: { r: row, c: 4 } });
        ws[XLSX.utils.encode_cell({ r: row, c: 5 })] = { v: r[2], t: 's', s: lblSt };
        ws[XLSX.utils.encode_cell({ r: row, c: 6 })] = { v: r[3], t: 's', s: valSt };
        merge.push({ s: { r: row, c: 6 }, e: { r: row, c: 8 } });
        row++;
      });
      row++;

      // ── CABEÇALHO DA TABELA ──
      const thSt = { font: { bold: true, sz: 11, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "1E40AF" } }, alignment: { horizontal: "center", vertical: "center", wrapText: true }, border: brd };
      const headers = ['Data', 'Dia', 'Entrada', 'Saída Almoço', 'Ret. Almoço', 'Saída', 'Jornada Esperada', 'Horas Trabalhadas', 'Horas Extras', 'Saldo', 'Valor Extra (R$)', 'Observações'];
      headers.forEach((h, c) => {
        ws[XLSX.utils.encode_cell({ r: row, c })] = { v: h, t: 's', s: thSt };
      });
      row++;

      // ── DADOS DIÁRIOS COM FÓRMULAS ──
      const dataStartRow = row;

      emp.processedDays.forEach((d, idx) => {
        const bg = idx % 2 === 0 ? "FFFFFF" : "F1F5F9";
        const cSt = { font: { sz: 10, color: { rgb: "1E293B" } }, fill: { fgColor: { rgb: bg } }, alignment: { horizontal: "center" }, border: brd };
        const tmSt = { font: { sz: 10, color: { rgb: "1E293B" } }, fill: { fgColor: { rgb: bg } }, alignment: { horizontal: "center" }, border: brd, z: 'h:mm' };
        const drSt = { font: { sz: 10, color: { rgb: "1E293B" } }, fill: { fgColor: { rgb: bg } }, alignment: { horizontal: "center" }, border: brd, z: '[h]:mm' };
        const mSt = { font: { sz: 10, color: { rgb: "1E293B" } }, fill: { fgColor: { rgb: bg } }, alignment: { horizontal: "right" }, border: brd, z: 'R$ #,##0.00' };
        const nSt = { font: { sz: 9, color: { rgb: "64748B" } }, fill: { fgColor: { rgb: bg } }, alignment: { horizontal: "left", wrapText: true }, border: brd };

        const dateObj = this._parseDate(d.date);
        const dayIdx = dateObj.getDay();
        let expectedH = 8;
        if (isSpecialEmp) { if (dayIdx === 0 || dayIdx === 6) expectedH = 0; }
        else { if (dayIdx === 0) expectedH = 0; else if (dayIdx === 6) expectedH = 4; }

        const R = row + 1; // Excel 1-indexed

        // A=Data, B=Dia (texto)
        ws[XLSX.utils.encode_cell({ r: row, c: 0 })] = { v: d.date, t: 's', s: cSt };
        ws[XLSX.utils.encode_cell({ r: row, c: 1 })] = { v: d.dayOfWeek, t: 's', s: cSt };

        // C=Entrada (valor tempo Excel real, formato h:mm)
        const eVal = this._timeToExcel(d.entry);
        ws[XLSX.utils.encode_cell({ r: row, c: 2 })] = eVal !== null
          ? { v: eVal, t: 'n', s: tmSt } : { v: '', t: 's', s: cSt };

        // D=Saída Almoço
        const loVal = this._timeToExcel(d.lunchOut);
        ws[XLSX.utils.encode_cell({ r: row, c: 3 })] = loVal !== null
          ? { v: loVal, t: 'n', s: tmSt } : { v: '', t: 's', s: cSt };

        // E=Retorno Almoço
        const liVal = this._timeToExcel(d.lunchIn);
        ws[XLSX.utils.encode_cell({ r: row, c: 4 })] = liVal !== null
          ? { v: liVal, t: 'n', s: tmSt } : { v: '', t: 's', s: cSt };

        // F=Saída
        const xVal = this._timeToExcel(d.exit);
        ws[XLSX.utils.encode_cell({ r: row, c: 5 })] = xVal !== null
          ? { v: xVal, t: 'n', s: tmSt } : { v: '', t: 's', s: cSt };

        // G=Jornada Esperada (duração: 8h = 8/24 formatada [h]:mm)
        ws[XLSX.utils.encode_cell({ r: row, c: 6 })] = { v: expectedH / 24, t: 'n', s: drSt };

        // H=Horas Trabalhadas = FÓRMULA AUTOMÁTICA
        // =SE(E(ÉNÚMERO(C);ÉNÚMERO(F));SE(E(ÉNÚMERO(D);ÉNÚMERO(E));(F-C)-(E-D);F-C);0)
        const fH = `IF(AND(ISNUMBER(C${R}),ISNUMBER(F${R})),IF(AND(ISNUMBER(D${R}),ISNUMBER(E${R})),(F${R}-C${R})-(E${R}-D${R}),F${R}-C${R}),0)`;
        ws[XLSX.utils.encode_cell({ r: row, c: 7 })] = { f: fH, t: 'n', s: drSt };

        // I=Horas Extras: =SE(H-G>0; H-G; 0)
        ws[XLSX.utils.encode_cell({ r: row, c: 8 })] = { f: `IF(H${R}-G${R}>0,H${R}-G${R},0)`, t: 'n', s: drSt };

        // J=Saldo: =H-G
        ws[XLSX.utils.encode_cell({ r: row, c: 9 })] = { f: `H${R}-G${R}`, t: 'n', s: drSt };

        // K=Valor Extra (R$): =I*24*taxaHora (converte fração do dia para horas * taxa)
        const mult = (dayIdx === 0) ? 2.0 : 1.5;
        const rate = isSpecialEmp ? 50.00 : (salary / 220);
        ws[XLSX.utils.encode_cell({ r: row, c: 10 })] = { f: `I${R}*24*${(rate * mult).toFixed(4)}`, t: 'n', s: mSt };

        // L=Observações
        ws[XLSX.utils.encode_cell({ r: row, c: 11 })] = { v: d.notes || '', t: 's', s: nSt };

        row++;
      });

      const first = dataStartRow + 1;
      const last = row;
      row++;

      // ── RESUMO COM FÓRMULAS ──
      const sLbl = { font: { bold: true, sz: 11, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "0F172A" } }, alignment: { horizontal: "right" }, border: brd };
      const sTm = { font: { bold: true, sz: 12, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "1E40AF" } }, alignment: { horizontal: "center" }, border: brd, z: '[h]:mm' };
      const sCnt = { font: { bold: true, sz: 12, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "1E40AF" } }, alignment: { horizontal: "center" }, border: brd };
      const sMon = { font: { bold: true, sz: 12, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "15803D" } }, alignment: { horizontal: "center" }, border: brd, z: 'R$ #,##0.00' };

      // Titulo
      ws[XLSX.utils.encode_cell({ r: row, c: 0 })] = { v: "RESUMO DO PERÍODO", t: 's', s: { font: { bold: true, sz: 13, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "0F172A" } }, alignment: { horizontal: "center" } } };
      merge.push({ s: { r: row, c: 0 }, e: { r: row, c: 11 } });
      row++;

      const summaryRows = [
        { label: "Dias Trabalhados:", formula: `COUNTA(A${first}:A${last})`, style: sCnt },
        { label: "Total Jornada Esperada:", formula: `SUM(G${first}:G${last})`, style: sTm },
        { label: "Total Horas Trabalhadas:", formula: `SUM(H${first}:H${last})`, style: sTm },
        { label: "Total Horas Extras:", formula: `SUM(I${first}:I${last})`, style: sTm },
        { label: "Saldo / Banco de Horas:", formula: `SUM(J${first}:J${last})`, style: sTm },
        { label: "Valor Total Horas Extras:", formula: `SUM(K${first}:K${last})`, style: sMon },
        { label: "Média por Dia:", formula: `IFERROR(SUM(H${first}:H${last})/COUNTA(A${first}:A${last}),0)`, style: sTm },
      ];

      summaryRows.forEach(sr => {
        ws[XLSX.utils.encode_cell({ r: row, c: 0 })] = { v: sr.label, t: 's', s: sLbl };
        merge.push({ s: { r: row, c: 0 }, e: { r: row, c: 5 } });
        ws[XLSX.utils.encode_cell({ r: row, c: 6 })] = { f: sr.formula, t: 'n', s: sr.style };
        merge.push({ s: { r: row, c: 6 }, e: { r: row, c: 8 } });
        row++;
      });

      row++;

      // ── LEGENDA ──
      const lgSt = { font: { italic: true, sz: 9, color: { rgb: "94A3B8" } } };
      ws[XLSX.utils.encode_cell({ r: row, c: 0 })] = { v: "Instruções:", t: 's', s: { font: { bold: true, sz: 9, color: { rgb: "64748B" } } } };
      row++;

      const legendas = [
        "Todos os horários estão em formato HH:MM. Edite as células de Entrada (C), Saída Almoço (D), Ret. Almoço (E) e Saída (F).",
        "Ao alterar qualquer horário, Horas Trabalhadas (H), Extras (I), Saldo (J), Valor (K) e TODOS os totais recalculam automaticamente.",
        "Para alterar a jornada esperada de um dia, edite a coluna G (ex: para meio período, digite 4:00).",
        "Gerado por PontoTrack em " + new Date().toLocaleDateString('pt-BR') + " às " + new Date().toLocaleTimeString('pt-BR'),
      ];
      legendas.forEach(txt => {
        ws[XLSX.utils.encode_cell({ r: row, c: 0 })] = { v: "• " + txt, t: 's', s: lgSt };
        merge.push({ s: { r: row, c: 0 }, e: { r: row, c: 11 } });
        row++;
      });

      // ── PROPRIEDADES ──
      ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: row, c: 11 } });
      ws['!cols'] = colWidths;
      ws['!merges'] = merge;

      XLSX.utils.book_append_sheet(wb, ws, emp.info.name.substring(0, 30));
    });

    const dateStr = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
    XLSX.writeFile(wb, `PontoTrack_Relatorio_${dateStr}.xlsx`);
  }

  // ==================== PDF ====================

  _exportPDF(records, employees) {
    if (typeof jspdf === 'undefined' && typeof window.jspdf === 'undefined') return;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('l', 'mm', 'a4');
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
